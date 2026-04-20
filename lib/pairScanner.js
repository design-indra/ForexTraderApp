/**
 * lib/pairScanner.js — Auto Pair Scanner v2
 * Fix: scoring lebih distinctive, tidak stuck di 50
 */
import { getOHLCV } from './monex.js';
import {
  getLatestRSI, getLatestEMA, calculateMACD,
  calculateBollingerBands, calculateATR,
  calculateMomentumScore, detectMarketTrend,
} from './indicators.js';
import { isPairBlacklisted } from './riskManager.js';

export const SCAN_PAIRS = [
  'EUR_USD','GBP_USD','USD_JPY','AUD_USD','USD_CAD','USD_CHF','NZD_USD',
  'EUR_GBP','EUR_JPY','GBP_JPY','AUD_JPY','EUR_AUD','GBP_AUD','EUR_CHF',
  'XAU_USD',
];

const PRIORITY_PAIRS  = ['EUR_USD','GBP_USD','USD_JPY','XAU_USD','GBP_JPY'];
const TF_MAP = { '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D' };

// ── Score satu pair ────────────────────────────────────────────────────────────
async function scorePair(instrument, granularity = 'M5', credentials = {}) {
  try {
    if (isPairBlacklisted(instrument)) {
      return { instrument, score: 0, action: 'SKIP', reason: 'blacklisted' };
    }

    const candles = await getOHLCV(instrument, granularity, 80, credentials);
    if (!candles || candles.length < 30) {
      return { instrument, score: 0, action: 'SKIP', reason: 'no_data' };
    }

    const closes   = candles.map(c => c.close);
    const highs    = candles.map(c => c.high);
    const lows     = candles.map(c => c.low);
    const close    = closes[closes.length - 1];
    const prev1    = closes[closes.length - 2];
    const prev2    = closes[closes.length - 3];
    const prev5    = closes[closes.length - 6] || closes[0];

    // ── Kalkulasi indikator ────────────────────────────────────────────────
    const rsi14   = getLatestRSI(closes, 14);
    const rsi7    = getLatestRSI(closes, 7);
    const ema9    = getLatestEMA(closes, 9);
    const ema21   = getLatestEMA(closes, 21);
    const ema50   = getLatestEMA(closes, 50);
    const macd    = calculateMACD(closes);
    const bb      = calculateBollingerBands(closes);
    const atr     = calculateATR(candles);
    const trend   = detectMarketTrend(closes);
    const momentum= calculateMomentumScore(candles);

    const macdHist = macd?.latest?.histogram || 0;
    const macdLine = macd?.latest?.macd      || 0;
    const macdSig  = macd?.latest?.signal    || 0;
    const bbUpper  = bb?.latest?.upper;
    const bbLower  = bb?.latest?.lower;
    const bbMid    = bb?.latest?.middle;

    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // ── 1. RSI 14 ─────────────────────────────────────────────────────────
    if (rsi14 !== null) {
      if      (rsi14 < 25) { bullScore += 25; reasons.push('RSI sangat oversold'); }
      else if (rsi14 < 35) { bullScore += 18; reasons.push('RSI oversold'); }
      else if (rsi14 < 45) { bullScore += 8; }
      else if (rsi14 < 55) { /* netral */ }
      else if (rsi14 < 65) { bearScore += 8; }
      else if (rsi14 < 75) { bearScore += 18; reasons.push('RSI overbought'); }
      else                  { bearScore += 25; reasons.push('RSI sangat overbought'); }
    }

    // ── 2. RSI 7 (short-term momentum) ────────────────────────────────────
    if (rsi7 !== null) {
      if      (rsi7 < 20) { bullScore += 15; }
      else if (rsi7 < 35) { bullScore += 8; }
      else if (rsi7 > 80) { bearScore += 15; }
      else if (rsi7 > 65) { bearScore += 8; }
    }

    // ── 3. EMA alignment (paling penting) ─────────────────────────────────
    if (ema9 && ema21 && ema50) {
      if (ema9 > ema21 && ema21 > ema50) {
        bullScore += 22; reasons.push('EMA bullish alignment');
      } else if (ema9 < ema21 && ema21 < ema50) {
        bearScore += 22; reasons.push('EMA bearish alignment');
      } else if (ema9 > ema21) {
        bullScore += 10;
      } else if (ema9 < ema21) {
        bearScore += 10;
      }
    }
    if (ema9)  { if (close > ema9)  bullScore += 6; else bearScore += 6; }
    if (ema21) { if (close > ema21) bullScore += 4; else bearScore += 4; }

    // ── 4. MACD ────────────────────────────────────────────────────────────
    if (macdHist > 0) { bullScore += 12; }
    if (macdHist < 0) { bearScore += 12; }
    // MACD crossover (sangat kuat)
    if (macdLine > macdSig && macdHist > 0 && prev1 < prev2) {
      bullScore += 8; reasons.push('MACD bullish crossover');
    }
    if (macdLine < macdSig && macdHist < 0 && prev1 > prev2) {
      bearScore += 8; reasons.push('MACD bearish crossover');
    }

    // ── 5. Bollinger Bands ─────────────────────────────────────────────────
    if (bbUpper && bbLower && bbMid) {
      const bbRange = bbUpper - bbLower;
      if (bbRange > 0) {
        const bbPct = (close - bbLower) / bbRange; // 0=lower, 1=upper
        if      (bbPct < 0.1) { bullScore += 18; reasons.push('Harga di BB lower'); }
        else if (bbPct < 0.25) { bullScore += 10; }
        else if (bbPct < 0.4)  { bullScore += 4; }
        else if (bbPct > 0.9)  { bearScore += 18; reasons.push('Harga di BB upper'); }
        else if (bbPct > 0.75) { bearScore += 10; }
        else if (bbPct > 0.6)  { bearScore += 4; }
      }
    }

    // ── 6. Price action (candle 3 terakhir) ───────────────────────────────
    const recentMove = (close - prev5) / (atr || close * 0.001);
    if (recentMove > 1.5)  { bearScore += 10; } // overextended up
    if (recentMove < -1.5) { bullScore += 10; } // overextended down
    // 3 candle berturut ke atas/bawah
    if (close > prev1 && prev1 > prev2) { bullScore += 8; reasons.push('3 candle naik'); }
    if (close < prev1 && prev1 < prev2) { bearScore += 8; reasons.push('3 candle turun'); }

    // ── 7. Trend ───────────────────────────────────────────────────────────
    if      (trend === 'uptrend')   { bullScore += 15; reasons.push('Uptrend'); }
    else if (trend === 'downtrend') { bearScore += 15; reasons.push('Downtrend'); }

    // ── 8. Momentum score ─────────────────────────────────────────────────
    if (momentum?.score > 70) {
      if (momentum.direction === 'bullish') { bullScore += 12; reasons.push('Momentum kuat ↑'); }
      else                                  { bearScore += 12; reasons.push('Momentum kuat ↓'); }
    } else if (momentum?.score > 55) {
      if (momentum.direction === 'bullish') bullScore += 6;
      else                                  bearScore += 6;
    }

    // ── 9. ATR (volatilitas sehat) ─────────────────────────────────────────
    if (atr) {
      const isJPY   = instrument.includes('JPY');
      const isGold  = instrument === 'XAU_USD';
      const minAtr  = isGold ? 0.5 : isJPY ? 0.05 : 0.0003;
      const goodAtr = isGold ? 2.0 : isJPY ? 0.3  : 0.001;
      if (atr >= goodAtr) { bullScore += 5; bearScore += 5; } // volatilitas bagus
      else if (atr < minAtr) { bullScore -= 5; bearScore -= 5; } // terlalu sepi
    }

    // ── 10. Priority pair bonus ────────────────────────────────────────────
    if (PRIORITY_PAIRS.includes(instrument)) { bullScore += 5; bearScore += 5; }

    // ── Final scoring ──────────────────────────────────────────────────────
    const maxBull = Math.max(0, bullScore);
    const maxBear = Math.max(0, bearScore);
    const total   = maxBull + maxBear;

    // Normalisasi ke 0-100
    const normalizedBull = total > 0 ? Math.round((maxBull / total) * 100) : 50;
    const normalizedBear = total > 0 ? Math.round((maxBear / total) * 100) : 50;

    const action  = maxBull > maxBear ? 'BUY' : maxBear > maxBull ? 'SELL' : 'HOLD';
    const score   = Math.max(normalizedBull, normalizedBear);
    const delta   = Math.abs(maxBull - maxBear);

    // Minimum conviction: selisih raw harus >= 10 poin
    if (delta < 10 || (maxBull === 0 && maxBear === 0)) {
      return { instrument, score: 50, action:'HOLD', bullScore:maxBull, bearScore:maxBear, delta, reasons, candles, rsi14, ema9, ema21, atr, trend, momentum, close };
    }

    return {
      instrument, action, score, bullScore:maxBull, bearScore:maxBear, delta, reasons,
      candles, rsi14, rsi7, ema9, ema21, ema50, macdHist, atr, trend, momentum, close,
    };
  } catch (err) {
    return { instrument, score: 0, action:'SKIP', error: err.message };
  }
}

// ── Scan semua pair ────────────────────────────────────────────────────────────
export async function scanAllPairs(tf = '5m', credentials = {}, maxConcurrent = 5) {
  const granularity = TF_MAP[tf] || 'M5';
  const results     = [];

  for (let i = 0; i < SCAN_PAIRS.length; i += maxConcurrent) {
    const batch  = SCAN_PAIRS.slice(i, i + maxConcurrent);
    const batchR = await Promise.all(batch.map(p => scorePair(p, granularity, credentials)));
    results.push(...batchR);
  }

  // Sort: BUY/SELL dulu, score DESC, delta DESC
  const ranked = results
    .filter(r => r.action !== 'SKIP')
    .sort((a, b) => {
      const aIsActive = a.action !== 'HOLD';
      const bIsActive = b.action !== 'HOLD';
      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;
      // Sort by score DESC, tie-break by delta
      if (b.score !== a.score) return b.score - a.score;
      return (b.delta || 0) - (a.delta || 0);
    });

  const best = ranked.find(r => r.action !== 'HOLD' && r.score >= 55) || ranked[0] || null;

  return {
    best,
    ranked  : ranked.slice(0, 10),
    scannedCount: results.length,
    timestamp   : Date.now(),
  };
}

export async function scanTopPairs(tf = '5m', credentials = {}) {
  return scanAllPairs(tf, credentials, PRIORITY_PAIRS.length);
}

/**
 * lib/pairScanner.js — Auto Pair Scanner
 * Fix:
 *  - detectMarketTrend returns 'bullish'/'bearish'/'sideways' (bukan 'uptrend'/'downtrend')
 *  - calculateMomentumScore tidak punya field 'direction' — derive dari EMA
 *  - Scoring sekarang menggunakan skala konsisten 0-100
 */
import { getOHLCV } from './monex.js';
import {
  getLatestRSI, getLatestEMA, calculateMACD,
  calculateBollingerBands, calculateATR,
  calculateMomentumScore, detectMarketTrend,
  normalizeScore,
} from './indicators.js';
import { isPairBlacklisted } from './riskManager.js';

export const SCAN_PAIRS = [
  'EUR_USD','GBP_USD','USD_JPY','AUD_USD','USD_CAD','USD_CHF','NZD_USD',
  'EUR_GBP','EUR_JPY','GBP_JPY','AUD_JPY','EUR_AUD','GBP_AUD','EUR_CHF',
  'XAU_USD',
];

const PRIORITY_PAIRS = ['EUR_USD','GBP_USD','USD_JPY','XAU_USD','GBP_JPY','EUR_JPY'];
const TF_MAP = { '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D' };

async function scorePair(instrument, granularity='M5', credentials={}) {
  try {
    if (isPairBlacklisted(instrument))
      return { instrument, score:0, action:'SKIP', reason:'blacklisted' };

    const candles = await getOHLCV(instrument, granularity, 120, credentials);
    if (!candles || candles.length < 30)
      return { instrument, score:0, action:'SKIP', reason:'no_data' };

    const closes = candles.map(c=>c.close);
    const close  = closes[closes.length-1];
    const prev1  = closes[closes.length-2];
    const prev2  = closes[closes.length-3];
    const prev5  = closes[closes.length-6] || closes[0];

    const rsi14  = getLatestRSI(closes, 14);
    const rsi7   = getLatestRSI(closes, 7);
    const ema9   = getLatestEMA(closes, 9);
    const ema21  = getLatestEMA(closes, 21);
    const ema50  = getLatestEMA(closes, 50);
    const macd   = calculateMACD(closes);
    const bb     = calculateBollingerBands(closes);
    const atr    = calculateATR(candles);
    const trend  = detectMarketTrend(closes);  // returns 'bullish'/'bearish'/'sideways'
    const mom    = calculateMomentumScore(candles);

    const macdHist = macd?.latest?.histogram || 0;
    const macdLine = macd?.latest?.macd      || 0;
    const macdSig  = macd?.latest?.signal    || 0;
    const bbUpper  = bb?.latest?.upper;
    const bbLower  = bb?.latest?.lower;

    let bullScore=0, bearScore=0;
    const reasons=[];

    // 1. RSI 14
    if (rsi14 !== null) {
      if      (rsi14 < 25) { bullScore+=25; reasons.push('RSI sangat oversold'); }
      else if (rsi14 < 35) { bullScore+=18; reasons.push('RSI oversold'); }
      else if (rsi14 < 45) { bullScore+=8; }
      else if (rsi14 < 55) { /* netral */ }
      else if (rsi14 < 65) { bearScore+=8; }
      else if (rsi14 < 75) { bearScore+=18; reasons.push('RSI overbought'); }
      else                  { bearScore+=25; reasons.push('RSI sangat overbought'); }
    }

    // 2. RSI 7
    if (rsi7 !== null) {
      if      (rsi7 < 20) { bullScore+=15; }
      else if (rsi7 < 35) { bullScore+=8;  }
      else if (rsi7 > 80) { bearScore+=15; }
      else if (rsi7 > 65) { bearScore+=8;  }
    }

    // 3. EMA alignment
    if (ema9 && ema21 && ema50) {
      if (ema9>ema21 && ema21>ema50) { bullScore+=22; reasons.push('EMA bullish'); }
      else if (ema9<ema21 && ema21<ema50) { bearScore+=22; reasons.push('EMA bearish'); }
      else if (ema9>ema21) bullScore+=10;
      else bearScore+=10;
    }
    if (ema9)  { close>ema9  ? bullScore+=6 : bearScore+=6; }
    if (ema21) { close>ema21 ? bullScore+=4 : bearScore+=4; }

    // 4. MACD
    if (macdHist>0) bullScore+=12; else if (macdHist<0) bearScore+=12;
    if (macdLine>macdSig && macdHist>0 && prev1<prev2) { bullScore+=8; reasons.push('MACD bullish xover'); }
    if (macdLine<macdSig && macdHist<0 && prev1>prev2) { bearScore+=8; reasons.push('MACD bearish xover'); }

    // 5. Bollinger Bands
    if (bbUpper && bbLower) {
      const bbRange = bbUpper - bbLower;
      if (bbRange > 0) {
        const bbPct = (close - bbLower) / bbRange;
        if      (bbPct < 0.10) { bullScore+=18; reasons.push('BB lower band'); }
        else if (bbPct < 0.25) { bullScore+=10; }
        else if (bbPct < 0.40) { bullScore+=4; }
        else if (bbPct > 0.90) { bearScore+=18; reasons.push('BB upper band'); }
        else if (bbPct > 0.75) { bearScore+=10; }
        else if (bbPct > 0.60) { bearScore+=4; }
      }
    }

    // 6. Price action
    const recentMove = (close - prev5) / (atr || close * 0.001);
    if (recentMove >  1.5) bearScore+=10; // overextended up
    if (recentMove < -1.5) bullScore+=10; // overextended down
    if (close>prev1 && prev1>prev2) { bullScore+=8; reasons.push('3 candle naik'); }
    if (close<prev1 && prev1<prev2) { bearScore+=8; reasons.push('3 candle turun'); }

    // 7. Trend — FIX: cek 'bullish'/'bearish' bukan 'uptrend'/'downtrend'
    if      (trend==='bullish') { bullScore+=15; reasons.push('Trend bullish'); }
    else if (trend==='bearish') { bearScore+=15; reasons.push('Trend bearish'); }

    // 8. Momentum — FIX: derive direction dari EMA, bukan momentum.direction (tidak ada)
    if (mom?.score > 70) {
      const momDir = ema9 && ema21 ? (ema9>ema21?'bullish':'bearish') : 'neutral';
      if (momDir==='bullish') { bullScore+=12; reasons.push('Momentum kuat ↑'); }
      else                    { bearScore+=12; reasons.push('Momentum kuat ↓'); }
    } else if (mom?.score > 55) {
      const momDir = ema9 && ema21 ? (ema9>ema21?'bullish':'bearish') : 'neutral';
      if (momDir==='bullish') bullScore+=6; else bearScore+=6;
    }

    // 9. ATR volatilitas
    if (atr) {
      const isJPY  = instrument.includes('JPY');
      const isGold = instrument==='XAU_USD';
      const minAtr = isGold ? 0.5 : isJPY ? 0.05 : 0.0003;
      const goodAtr= isGold ? 2.0 : isJPY ? 0.3  : 0.001;
      if (atr >= goodAtr)   { bullScore+=5; bearScore+=5; }
      else if (atr < minAtr){ bullScore-=5; bearScore-=5; }
    }

    // 10. Priority pair bonus
    if (PRIORITY_PAIRS.includes(instrument)) { bullScore+=5; bearScore+=5; }

    // Normalisasi ke 0-100
    const maxBull = Math.max(0, bullScore);
    const maxBear = Math.max(0, bearScore);
    const total   = maxBull + maxBear;
    const delta   = Math.abs(maxBull - maxBear);

    if (delta < 10 || total === 0) {
      return { instrument, score:50, action:'HOLD', bullScore:maxBull, bearScore:maxBear, delta, reasons, candles, rsi14, ema9, ema21, atr, trend, momentum:mom, close };
    }

    const action = maxBull > maxBear ? 'BUY' : 'SELL';
    // Score = persentase dominansi arah yang menang (50-100)
    const score  = Math.round(50 + (delta / total) * 50);

    return {
      instrument, action, score, bullScore:maxBull, bearScore:maxBear, delta, reasons,
      candles, rsi14, rsi7, ema9, ema21, ema50, macdHist, atr, trend, momentum:mom, close,
      unifiedScore: normalizeScore(score, 'scanner', action),
    };
  } catch(err) {
    return { instrument, score:0, action:'SKIP', error:err.message };
  }
}

export async function scanAllPairs(tf='5m', credentials={}, maxConcurrent=5) {
  const granularity = TF_MAP[tf] || 'M5';
  const results = [];
  for (let i=0; i<SCAN_PAIRS.length; i+=maxConcurrent) {
    const batch  = SCAN_PAIRS.slice(i, i+maxConcurrent);
    const batchR = await Promise.all(batch.map(p=>scorePair(p, granularity, credentials)));
    results.push(...batchR);
  }

  const ranked = results
    .filter(r=>r.action!=='SKIP')
    .sort((a,b) => {
      const aActive = a.action!=='HOLD';
      const bActive = b.action!=='HOLD';
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      if (b.score !== a.score)   return b.score - a.score;
      return (b.delta||0) - (a.delta||0);
    });

  const best = ranked.find(r=>r.action!=='HOLD' && r.score>=62) || ranked[0] || null;

  return { best, ranked:ranked.slice(0,10), scannedCount:results.length, timestamp:Date.now() };
}

export async function scanTopPairs(tf='5m', credentials={}) {
  return scanAllPairs(tf, credentials, PRIORITY_PAIRS.length);
}

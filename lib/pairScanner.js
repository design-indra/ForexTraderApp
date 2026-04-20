/**
 * lib/pairScanner.js — Auto Pair Scanner
 *
 * Scan semua pair secara paralel, score sinyal tiap pair,
 * return pair terbaik dengan signal paling kuat.
 *
 * Digunakan saat config.autoPair = true
 */

import { getOHLCV } from './monex.js';
import {
  getLatestRSI, getLatestEMA, calculateMACD,
  calculateBollingerBands, calculateATR,
  calculateMomentumScore, detectMarketTrend,
} from './indicators.js';
import { isPairBlacklisted } from './riskManager.js';

// ── Semua pair yang discan ─────────────────────────────────────────────────────
export const SCAN_PAIRS = [
  // Major
  'EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD',
  'USD_CAD', 'USD_CHF', 'NZD_USD',
  // Cross
  'EUR_GBP', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY',
  'EUR_AUD', 'GBP_AUD', 'EUR_CHF',
  // Metals
  'XAU_USD',
];

// Pair yang diutamakan (spread kecil, likuid tinggi)
const PRIORITY_PAIRS = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'XAU_USD', 'GBP_JPY'];

const TF_MAP = {
  '1m':'M1','5m':'M5','15m':'M15','30m':'M30',
  '1h':'H1','4h':'H4','1d':'D',
};

// ── Score sinyal satu pair ─────────────────────────────────────────────────────
async function scorePair(instrument, granularity = 'M5', credentials = {}) {
  try {
    if (isPairBlacklisted(instrument)) {
      return { instrument, score: 0, action: 'SKIP', reason: 'blacklisted' };
    }

    const candles = await getOHLCV(instrument, granularity, 60, credentials);
    if (!candles || candles.length < 30) {
      return { instrument, score: 0, action: 'SKIP', reason: 'no_data' };
    }

    const closes   = candles.map(c => c.close);
    const rsi14    = getLatestRSI(closes, 14);
    const ema9     = getLatestEMA(closes, 9);
    const ema21    = getLatestEMA(closes, 21);
    const ema50    = getLatestEMA(closes, 50);
    const macd     = calculateMACD(closes);
    const bb       = calculateBollingerBands(closes);
    const atr      = calculateATR(candles);
    const trend    = detectMarketTrend(closes);
    const momentum = calculateMomentumScore(candles);
    const close    = closes[closes.length - 1];

    // ── Scoring logic ─────────────────────────────────────────────────────────
    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // RSI
    if (rsi14 !== null) {
      if (rsi14 < 35)       { bullScore += 20; reasons.push('RSI oversold'); }
      else if (rsi14 < 45)  { bullScore += 10; }
      if (rsi14 > 65)       { bearScore += 20; reasons.push('RSI overbought'); }
      else if (rsi14 > 55)  { bearScore += 10; }
    }

    // EMA alignment
    if (ema9 && ema21 && ema50) {
      if (ema9 > ema21 && ema21 > ema50) { bullScore += 20; reasons.push('EMA bullish'); }
      if (ema9 < ema21 && ema21 < ema50) { bearScore += 20; reasons.push('EMA bearish'); }
      if (close > ema9)  bullScore += 5;
      if (close < ema9)  bearScore += 5;
    }

    // MACD
    if (macd?.latest) {
      const hist = macd.latest.histogram;
      if (hist > 0)  { bullScore += 15; }
      if (hist < 0)  { bearScore += 15; }
      if (macd.latest.macd > macd.latest.signal) bullScore += 5;
      else                                        bearScore += 5;
    }

    // Bollinger Bands
    if (bb?.latest) {
      const { upper, lower, middle } = bb.latest;
      if (close <= lower)                           { bullScore += 15; reasons.push('BB oversold'); }
      else if (close >= upper)                      { bearScore += 15; reasons.push('BB overbought'); }
      if (close > middle) bullScore += 5;
      else                bearScore += 5;
    }

    // Trend confirmation
    if (trend === 'uptrend')    { bullScore += 15; reasons.push('Uptrend'); }
    if (trend === 'downtrend')  { bearScore += 15; reasons.push('Downtrend'); }

    // Momentum
    if (momentum?.score > 65) {
      if (momentum.direction === 'bullish') bullScore += 10;
      else                                  bearScore += 10;
    }

    // ATR — volatilitas cukup (tidak terlalu sepi)
    const minAtr = instrument.includes('JPY') ? 0.05 : 0.0003;
    const maxAtr = instrument.includes('JPY') ? 2.0  : 0.020;
    if (atr && (atr < minAtr || atr > maxAtr)) {
      // Volatilitas terlalu sepi atau terlalu liar — kurangi score
      bullScore -= 10;
      bearScore -= 10;
      reasons.push('ATR unfavorable');
    }

    // Priority pair bonus
    if (PRIORITY_PAIRS.includes(instrument)) {
      bullScore += 3;
      bearScore += 3;
    }

    const action = bullScore > bearScore ? 'BUY' : 'SELL';
    const score  = Math.max(bullScore, bearScore);
    const delta  = Math.abs(bullScore - bearScore);

    // Minimum conviction: selisih harus cukup besar
    if (delta < 15 || score < 30) {
      return { instrument, score, action: 'HOLD', bullScore, bearScore, delta, reasons, candles, rsi14, ema9, ema21, ema50, atr, trend, momentum };
    }

    return {
      instrument,
      action,
      score,
      bullScore,
      bearScore,
      delta,
      reasons,
      candles,
      rsi14, ema9, ema21, ema50,
      macdHist: macd?.latest?.histogram,
      atr,
      trend,
      momentum,
      close,
    };
  } catch (err) {
    return { instrument, score: 0, action: 'SKIP', error: err.message };
  }
}

// ── Scan semua pair & return ranking ─────────────────────────────────────────
export async function scanAllPairs(tf = '5m', credentials = {}, maxConcurrent = 5) {
  const granularity = TF_MAP[tf] || 'M5';
  const pairs       = [...SCAN_PAIRS];
  const results     = [];

  // Proses secara batch agar tidak overload API
  for (let i = 0; i < pairs.length; i += maxConcurrent) {
    const batch  = pairs.slice(i, i + maxConcurrent);
    const batchR = await Promise.all(
      batch.map(p => scorePair(p, granularity, credentials))
    );
    results.push(...batchR);
  }

  // Sort: action BUY/SELL dulu, lalu by score DESC
  const ranked = results
    .filter(r => r.action !== 'SKIP')
    .sort((a, b) => {
      if (a.action === 'HOLD' && b.action !== 'HOLD') return 1;
      if (b.action === 'HOLD' && a.action !== 'HOLD') return -1;
      return (b.score + (b.delta || 0)) - (a.score + (a.delta || 0));
    });

  const best = ranked.find(r => r.action !== 'HOLD') || ranked[0] || null;

  return {
    best,
    ranked: ranked.slice(0, 10),  // top 10
    scannedCount: results.length,
    timestamp: Date.now(),
  };
}

// ── Scan subset pair (lebih cepat, untuk update rutin) ────────────────────────
export async function scanTopPairs(tf = '5m', credentials = {}) {
  return scanAllPairs(tf, credentials, PRIORITY_PAIRS.length);
}

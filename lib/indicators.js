/**
 * lib/indicators.js — Forex Technical Indicators
 * Diadaptasi dari IndoTrader v4 untuk Forex
 *
 * Semua indikator sama persis, hanya unit harga yang berbeda (USD bukan IDR)
 */

// ─── RSI ──────────────────────────────────────────────────────────────────────
export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const rsi = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  rsi.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return rsi;
}
export function getLatestRSI(closes, period = 14) {
  const r = calculateRSI(closes, period);
  return r.length > 0 ? parseFloat(r[r.length - 1].toFixed(2)) : null;
}

// ─── EMA / SMA ────────────────────────────────────────────────────────────────
export function calculateEMA(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}
export function getLatestEMA(values, period) {
  const e = calculateEMA(values, period);
  return e.length > 0 ? e[e.length - 1] : null;
}
export function calculateSMA(values, period) {
  if (values.length < period) return [];
  return values
    .map((_, i) => i < period - 1 ? null : values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period)
    .filter(v => v !== null);
}

// ─── MACD ─────────────────────────────────────────────────────────────────────
export function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast  = calculateEMA(closes, fast);
  const emaSlow  = calculateEMA(closes, slow);
  const diff     = slow - fast;
  const macdLine = emaFast.slice(diff).map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signal);
  const sdiff    = macdLine.length - signalLine.length;
  const histogram = signalLine.map((v, i) => macdLine[i + sdiff] - v);
  const latest   = signalLine.length > 0 ? {
    macd:      macdLine[macdLine.length - 1],
    signal:    signalLine[signalLine.length - 1],
    histogram: histogram[histogram.length - 1],
  } : null;
  return { macdLine, signalLine, histogram, latest };
}

// ─── Bollinger Bands ──────────────────────────────────────────────────────────
export function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { bands: [], latest: null };
  const bands = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    bands.push({ upper: mean + stdDev * std, middle: mean, lower: mean - stdDev * std });
  }
  return { bands, latest: bands[bands.length - 1] || null };
}

// ─── ATR ──────────────────────────────────────────────────────────────────────
export function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low - candles[i].close)
  ));
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

// ─── Volume ───────────────────────────────────────────────────────────────────
export function detectVolumeSpike(volumes, multiplier = 1.5) {
  if (volumes.length < 20) return false;
  const avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  return volumes[volumes.length - 1] > avg * multiplier;
}

// ─── Market Trend ─────────────────────────────────────────────────────────────
export function detectMarketTrend(closes, period = 20) {
  if (closes.length < period) return 'sideways';
  const ema   = getLatestEMA(closes, period);
  const close = closes[closes.length - 1];
  const prev  = closes[closes.length - Math.floor(period / 2)];
  const slope = (close - prev) / prev * 100;
  if (close > ema && slope > 0.02)  return 'bullish';
  if (close < ema && slope < -0.02) return 'bearish';
  return 'sideways';
}

// ─── Stochastic RSI ───────────────────────────────────────────────────────────
export function calculateStochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
  const rsiValues = calculateRSI(closes, rsiPeriod);
  if (rsiValues.length < stochPeriod) return null;
  const recent  = rsiValues.slice(-stochPeriod);
  const minRSI  = Math.min(...recent);
  const maxRSI  = Math.max(...recent);
  const lastRSI = rsiValues[rsiValues.length - 1];
  if (maxRSI === minRSI) return 50;
  return parseFloat(((lastRSI - minRSI) / (maxRSI - minRSI) * 100).toFixed(2));
}

// ─── Support & Resistance ─────────────────────────────────────────────────────
export function detectSupportResistance(candles, lookback = 20, threshold = 0.001) {
  if (candles.length < lookback * 2) return {
    supports: [], resistances: [],
    nearSupport: false, nearResistance: false,
    closestSupport: null, closestResistance: null,
    distanceToSupport: 999, distanceToResistance: 999, srRatio: 0,
  };
  const recent = candles.slice(-lookback * 2);
  const supports = [], resistances = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    if (c.low < recent[i-1].low && c.low < recent[i-2].low &&
        c.low < recent[i+1].low && c.low < recent[i+2].low) {
      supports.push(c.low);
    }
    if (c.high > recent[i-1].high && c.high > recent[i-2].high &&
        c.high > recent[i+1].high && c.high > recent[i+2].high) {
      resistances.push(c.high);
    }
  }
  const close             = candles[candles.length - 1].close;
  const nearSupport       = supports.some(s => Math.abs(close - s) / s < threshold);
  const nearResistance    = resistances.some(r => Math.abs(close - r) / r < threshold);
  const closestSupport    = supports.filter(s => s < close).sort((a, b) => b - a)[0] || null;
  const closestResistance = resistances.filter(r => r > close).sort((a, b) => a - b)[0] || null;
  const distanceToSupport    = closestSupport    ? (close - closestSupport)    / close * 100 : 999;
  const distanceToResistance = closestResistance ? (closestResistance - close) / close * 100 : 999;
  const srRatio = distanceToResistance > 0 && distanceToSupport > 0
    ? distanceToResistance / distanceToSupport : 0;
  return {
    supports, resistances, nearSupport, nearResistance,
    closestSupport, closestResistance,
    distanceToSupport: parseFloat(distanceToSupport.toFixed(4)),
    distanceToResistance: parseFloat(distanceToResistance.toFixed(4)),
    srRatio: parseFloat(srRatio.toFixed(2)),
  };
}

// ─── Fibonacci Retracement ────────────────────────────────────────────────────
export function calculateFibonacci(candles, lookback = 50) {
  const slice = candles.slice(-Math.min(lookback, candles.length));
  const highs  = slice.map(c => c.high);
  const lows   = slice.map(c => c.low);
  const swingH = Math.max(...highs);
  const swingL = Math.min(...lows);
  const range  = swingH - swingL;
  if (range === 0) return null;
  const close    = candles[candles.length - 1].close;
  const position = (close - swingL) / range;
  const levels   = {
    0:     swingL,
    0.236: swingL + range * 0.236,
    0.382: swingL + range * 0.382,
    0.5:   swingL + range * 0.5,
    0.618: swingL + range * 0.618,
    0.786: swingL + range * 0.786,
    1:     swingH,
  };
  const inGoldenZone = position >= 0.5 && position <= 0.618;
  return { swingH, swingL, range, position: parseFloat(position.toFixed(3)), levels, inGoldenZone };
}

// ─── Momentum Score ───────────────────────────────────────────────────────────
export function calculateMomentumScore(candles) {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  let score = 50;
  const rsi = getLatestRSI(closes, 14);
  if (rsi !== null) {
    if (rsi > 50 && rsi < 70) score += 15;
    else if (rsi >= 40 && rsi <= 60) score += 5;
    else if (rsi < 30 || rsi > 70) score -= 5;
  }
  const ema9  = getLatestEMA(closes, 9);
  const ema21 = getLatestEMA(closes, 21);
  const ema50 = getLatestEMA(closes, 50);
  if (ema9 && ema21) {
    if (ema9 > ema21) score += 10;
    else score -= 5;
  }
  if (ema50 && closes[closes.length - 1] > ema50) score += 8;
  const macd = calculateMACD(closes);
  if (macd.latest) {
    if (macd.latest.histogram > 0) score += 10;
    else score -= 5;
    if (macd.latest.macd > macd.latest.signal) score += 5;
  }
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[volumes.length - 1];
  if (curVol > avgVol * 1.5) score += 7;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? 'A+' : score >= 70 ? 'A' : score >= 60 ? 'B' : score >= 50 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score: parseFloat(score.toFixed(1)), grade };
}

// ─── Divergence Detection ─────────────────────────────────────────────────────
export function detectDivergence(candles) {
  if (candles.length < 30) return { bullish: false, bearish: false, type: 'none' };
  const closes  = candles.map(c => c.close);
  const rsiVals = calculateRSI(closes, 14);
  if (rsiVals.length < 10) return { bullish: false, bearish: false, type: 'none' };
  const n = Math.min(closes.length, rsiVals.length);
  const recentCloses = closes.slice(-n);
  const recentRSI    = rsiVals.slice(-n);
  const l = recentCloses.length;
  const priceDown  = recentCloses[l - 1] < recentCloses[l - 10];
  const rsiUp      = recentRSI[l - 1]    > recentRSI[l - 10];
  const priceUp    = recentCloses[l - 1] > recentCloses[l - 10];
  const rsiDown    = recentRSI[l - 1]    < recentRSI[l - 10];
  const bullish    = priceDown && rsiUp;
  const bearish    = priceUp   && rsiDown;
  return { bullish, bearish, type: bullish ? 'bullish' : bearish ? 'bearish' : 'none' };
}

// ─── VWAP (approximation) ─────────────────────────────────────────────────────
export function calculateVWAP(candles) {
  if (candles.length < 10) return null;
  const slice = candles.slice(-Math.min(50, candles.length));
  let cumPV = 0, cumV = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * (c.volume || 1);
    cumV  += (c.volume || 1);
  }
  const vwap      = cumPV / cumV;
  const close     = candles[candles.length - 1].close;
  const belowVWAP = close < vwap;
  const aboveVWAP = close > vwap;
  const signal    = belowVWAP ? 'below_vwap' : 'above_vwap';
  return { vwap, close, belowVWAP, aboveVWAP, signal };
}

// ─── Trend Strength (ADX approximation) ───────────────────────────────────────
export function calculateTrendStrength(candles, period = 14) {
  if (candles.length < period * 2) return { adx: 25, trending: false, direction: 'sideways' };
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const trs = candles.slice(1).map((c, i) => Math.max(
    c.high - c.low,
    Math.abs(c.high - candles[i].close),
    Math.abs(c.low  - candles[i].close)
  ));
  const avgTR = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgTR === 0) return { adx: 0, trending: false, direction: 'sideways' };
  const plusDMs  = candles.slice(1).map((c, i) => Math.max(0, c.high - candles[i].high));
  const minusDMs = candles.slice(1).map((c, i) => Math.max(0, candles[i].low - c.low));
  const avgPlusDM  = plusDMs.slice(-period).reduce((a, b)  => a + b, 0) / period;
  const avgMinusDM = minusDMs.slice(-period).reduce((a, b) => a + b, 0) / period;
  const plusDI  = (avgPlusDM  / avgTR) * 100;
  const minusDI = (avgMinusDM / avgTR) * 100;
  const dx   = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
  const adx  = parseFloat(dx.toFixed(1));
  const trending  = adx > 20;
  const direction = plusDI > minusDI ? 'bullish' : 'bearish';
  return { adx, trending, direction, plusDI: parseFloat(plusDI.toFixed(1)), minusDI: parseFloat(minusDI.toFixed(1)) };
}

// ─── Higher Timeframe Bias ────────────────────────────────────────────────────
export function getHigherTFBias(candles) {
  if (candles.length < 50) return { bias: 'neutral', strength: 0 };
  const closes  = candles.map(c => c.close);
  const ema50   = getLatestEMA(closes, 50);
  const ema200  = getLatestEMA(closes, Math.min(200, closes.length - 1));
  const close   = closes[closes.length - 1];
  const rsi     = getLatestRSI(closes, 14);
  let score = 0;
  if (ema50  && close > ema50)  score += 2;
  if (ema50  && close < ema50)  score -= 2;
  if (ema200 && close > ema200) score += 3;
  if (ema200 && close < ema200) score -= 3;
  if (rsi !== null) {
    if (rsi > 50) score += 1;
    if (rsi < 50) score -= 1;
  }
  const bias = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
  return { bias, strength: Math.abs(score) };
}

// ─── Candle Pattern Detection ─────────────────────────────────────────────────
export function detectCandlePattern(candles) {
  if (candles.length < 3) return { pattern: 'none', direction: 'neutral' };
  const [prev2, prev1, curr] = candles.slice(-3);
  const bodyC  = Math.abs(curr.close  - curr.open);
  const bodyP1 = Math.abs(prev1.close - prev1.open);
  const rangeC = curr.high - curr.low;
  const upper  = curr.high - Math.max(curr.open, curr.close);
  const lower  = Math.min(curr.open, curr.close) - curr.low;

  // Doji
  if (bodyC < rangeC * 0.1) return { pattern: 'doji', direction: 'neutral' };

  // Hammer / Shooting Star
  if (lower > bodyC * 2 && upper < bodyC * 0.5) return { pattern: 'hammer', direction: 'bullish' };
  if (upper > bodyC * 2 && lower < bodyC * 0.5) return { pattern: 'shooting_star', direction: 'bearish' };

  // Engulfing
  if (curr.close > curr.open && prev1.close < prev1.open && curr.close > prev1.open && curr.open < prev1.close)
    return { pattern: 'bullish_engulfing', direction: 'bullish' };
  if (curr.close < curr.open && prev1.close > prev1.open && curr.close < prev1.open && curr.open > prev1.close)
    return { pattern: 'bearish_engulfing', direction: 'bearish' };

  // Morning / Evening Star
  if (prev2.close < prev2.open && bodyP1 < bodyC * 0.3 && curr.close > curr.open && curr.close > (prev2.open + prev2.close) / 2)
    return { pattern: 'morning_star', direction: 'bullish' };
  if (prev2.close > prev2.open && bodyP1 < bodyC * 0.3 && curr.close < curr.open && curr.close < (prev2.open + prev2.close) / 2)
    return { pattern: 'evening_star', direction: 'bearish' };

  // General direction
  return {
    pattern:   curr.close > curr.open ? 'bullish_candle' : 'bearish_candle',
    direction: curr.close > curr.open ? 'bullish' : 'bearish',
  };
}

// ─── Forex Session Filter ─────────────────────────────────────────────────────
/**
 * Sesi trading Forex aktif (volume tinggi = spread kecil = sinyal lebih akurat):
 * - Tokyo:    00:00-09:00 UTC  (untuk pair JPY)
 * - London:   07:00-16:00 UTC  (volume tertinggi)
 * - New York: 12:00-21:00 UTC
 * - Overlap London-NY: 12:00-16:00 UTC (waktu terbaik)
 */
export function isGoodForexSession(instrument = 'EUR_USD') {
  const now  = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcTime = utcH + utcM / 60;

  const isJPY = instrument.includes('JPY');
  const sessions = [];

  // Tokyo session
  const tokyoActive = utcTime >= 0 && utcTime < 9;
  if (tokyoActive) sessions.push('Tokyo');

  // London session
  const londonActive = utcTime >= 7 && utcTime < 16;
  if (londonActive) sessions.push('London');

  // New York session
  const nyActive = utcTime >= 12 && utcTime < 21;
  if (nyActive) sessions.push('New York');

  // Overlap (terbaik)
  const overlapActive = utcTime >= 12 && utcTime < 16;

  // Weekend (Sabtu 21:00 UTC - Minggu 21:00 UTC = market tutup)
  const day = now.getUTCDay();
  const isClosed = day === 6 || (day === 0 && utcTime < 21) || (day === 5 && utcTime >= 21);
  if (isClosed) return { isGood: false, sessions: [], sessionName: 'Market Tutup (Weekend)', overlapActive: false, utcH, utcM };

  // Sesi sepi: 21:00-00:00 UTC dan 03:00-07:00 UTC (kecuali JPY)
  const isQuiet = (utcTime >= 21 || utcTime < 3) || (utcTime >= 3 && utcTime < 7 && !isJPY && !tokyoActive);
  const isGood  = sessions.length > 0 && !isQuiet;
  const sessionName = overlapActive ? '🔥 London-NY Overlap' :
                      sessions.length > 0 ? `📊 ${sessions.join('+')}` : '😴 Sepi';

  return { isGood, sessions, sessionName, overlapActive, utcH, utcM };
}

// ─── Signal Score (multi-indicator) ──────────────────────────────────────────
export function computeSignalScore({ rsi, ema9, ema21, macd, close, bb, trend }) {
  let score = 50;
  if (rsi !== null) {
    if (rsi < 35) score += 20;
    else if (rsi < 45) score += 10;
    else if (rsi > 65) score -= 20;
    else if (rsi > 55) score -= 10;
  }
  if (ema9 && ema21) {
    if (ema9 > ema21) score += 15;
    else score -= 15;
  }
  if (macd) {
    if (macd.histogram > 0) score += 10;
    else score -= 10;
    if (macd.macd > macd.signal) score += 5;
    else score -= 5;
  }
  if (bb && close) {
    const pos = (close - bb.lower) / (bb.upper - bb.lower);
    if (pos < 0.2) score += 10;
    else if (pos > 0.8) score -= 10;
  }
  if (trend === 'bullish') score += 5;
  else if (trend === 'bearish') score -= 5;

  score = Math.max(0, Math.min(100, score));
  const action = score >= 65 ? 'BUY' : score <= 35 ? 'SELL' : 'HOLD';
  return { score: parseFloat(score.toFixed(1)), action };
}

// ─── Adaptive TP/SL (ATR-based, dalam price unit) ────────────────────────────
export function calculateAdaptiveTPSL(candles, close, direction = 'buy') {
  const atr = calculateATR(candles) || close * 0.001;
  const isBuy = direction === 'buy';

  // Forex TP/SL dalam ATR multiplier (lebih ketat dari crypto)
  const slMult = 1.5;
  const tpMult = 3.0; // R:R = 2:1

  const stopLoss   = isBuy ? close - atr * slMult : close + atr * slMult;
  const takeProfit = isBuy ? close + atr * tpMult : close - atr * tpMult;

  return {
    stopLoss:    parseFloat(stopLoss.toFixed(5)),
    takeProfit:  parseFloat(takeProfit.toFixed(5)),
    atr:         parseFloat(atr.toFixed(5)),
    slMult, tpMult,
    tpMultiplier: tpMult,
  };
}

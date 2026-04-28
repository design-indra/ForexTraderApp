/**
 * lib/tradingEngine.js — ForexTrader Engine v2
 *
 * Fix v2:
 *  - L1: SELL score pakai skala benar (15-25), filter SELL ditambah nearSupport
 *  - L2: Cooldown dipindah ke main cycle (tidak duplikat), SELL confidence ditambah
 *  - L3: SELL score formula diperbaiki (tidak flip), adjustedScore SELL diturunkan bukan dibalik
 *  - L4: ATR filter berlaku untuk SELL juga, SR ratio filter simetris
 *  - L5: Momentum filter berlaku simetris BUY/SELL
 *
 * Level:
 * L1 - Scalper      : RSI7 + EMA Ribbon (cepat)
 * L2 - Smart        : Market filter + confidence
 * L3 - AI Scoring   : Multi-indicator score
 * L4 - ML Adaptive  : Feature-based adaptive
 * L5 - Full Context : Semua filter + divergence
 */

import {
  getLatestRSI, getLatestEMA, calculateMACD, calculateBollingerBands,
  detectMarketTrend, computeSignalScore, calculateATR, detectCandlePattern,
  isGoodForexSession, calculateAdaptiveTPSL, getHigherTFBias,
  calculateStochRSI, detectSupportResistance, calculateFibonacci,
  calculateMomentumScore, detectDivergence, calculateVWAP, calculateTrendStrength,
  candleConfirmation, checkSpread, normalizeScore,
} from './indicators.js';

import {
  calculateLotSize, canOpenPosition, checkPositionExit, checkSignalReversal,
  updateTrailingStop, getRiskSettings, getActiveProfitMode,
  isPairBlacklisted, reportPairLoss, resetPairLoss, getBlacklistedPairs,
  checkDoubleConfirmation, resetDoubleConfirmation,
} from './riskManager.js';

import { PIP_VALUES } from './monex.js';

// ─── Per-User Bot State ───────────────────────────────────────────────────────
// Setiap user punya botState sendiri — tidak ada lagi global singleton.
// Key: userId (string UUID), Value: botState object
const userBotStates = new Map();

function makeDefaultState() {
  return {
    running: false, mode: 'demo', level: 1,
    instrument: 'EUR_USD', direction: 'both',
    signalMode: 'combined',
    consecutiveLosses: 0, consecutiveWins: 0, totalPnl: 0,
    isPaused: false, pauseReason: null,
    cooldownUntil: 0, lastSignal: null, lastActionTime: 0,
    sessionSkipLogged: false,
    logs: [],
    stats: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgPnlPips: 0, bestTrade: 0, worstTrade: 0 },
  };
}

function getState(userId) {
  if (!userBotStates.has(userId)) {
    userBotStates.set(userId, makeDefaultState());
  }
  return userBotStates.get(userId);
}

// Batas maksimal user aktif di memory (Railway free tier ~512MB)
// State lama (>4 jam tidak aktif) akan di-GC
const MAX_STATES = 200;
const STATE_TTL  = 4 * 60 * 60 * 1000; // 4 jam
const stateLastActive = new Map();

function touchState(userId) {
  stateLastActive.set(userId, Date.now());
  if (userBotStates.size > MAX_STATES) {
    // Hapus state paling lama tidak aktif
    let oldest = null, oldestTime = Infinity;
    for (const [uid, t] of stateLastActive) {
      if (t < oldestTime) { oldest = uid; oldestTime = t; }
    }
    if (oldest && oldest !== userId) {
      userBotStates.delete(oldest);
      stateLastActive.delete(oldest);
    }
  }
}

export const getBotState = (userId) => {
  touchState(userId);
  return getState(userId);
};
export const getLogs = (userId, n = 50) => getState(userId).logs.slice(0, n);

export function startBot(userId, cfg = {}) {
  touchState(userId);
  const s = getState(userId);
  s.running    = true;
  s.isPaused   = false;
  s.mode       = cfg.mode       || 'demo';
  s.level      = cfg.level      || 1;
  s.instrument = cfg.instrument || 'EUR_USD';
  s.direction  = cfg.direction  || 'both';
  s.signalMode = cfg.signalMode || 'combined';
  s.cooldownUntil  = 0;
  s.lastActionTime = 0;
  s.sessionSkipLogged = false;
  const modeLabel = s.signalMode === 'scanner' ? '🔍 Scanner Only' : s.signalMode === 'level' ? `📊 Level ${s.level} Only` : `🤝 Combined L${s.level}+Scanner`;
  addLog(userId, `🚀 ForexBot started — ${s.mode.toUpperCase()} | ${s.instrument} | ${modeLabel}`, 'system');
}

export function stopBot(userId) {
  const s = getState(userId);
  s.running = false;
  addLog(userId, '🛑 Bot stopped', 'system');
}

export function resumeBot(userId) {
  const s = getState(userId);
  s.isPaused = false; s.pauseReason = null; s.consecutiveLosses = 0;
  s.sessionSkipLogged = false;
  addLog(userId, '▶️ Bot resumed', 'system');
}

export function resetBotState(userId) {
  const s = getState(userId);
  const savedLogs = s.logs.slice(0, 5);
  const fresh = makeDefaultState();
  fresh.logs = savedLogs;
  userBotStates.set(userId, fresh);
}

function addLog(userId, msg, type = 'info') {
  const s = getState(userId);
  const entry = { id: Date.now() + Math.random(), time: new Date().toISOString(), message: msg, type };
  s.logs.unshift(entry);
  if (s.logs.length > 300) s.logs = s.logs.slice(0, 300);
  return entry;
}

// ─── Advanced Context ─────────────────────────────────────────────────────────
function getAdvancedContext(candles, instrument = '') {
  const closes = candles.map(c => c.close);
  const close  = closes[closes.length - 1];
  // SR threshold dinamis: XAU/XAG butuh threshold lebih besar (harga ~2320)
  const isMetals   = ['XAU_USD','XAG_USD','XAU/USD','XAG/USD'].includes(instrument || '');
  const srThresh   = isMetals ? 0.001 : 0.0005;
  const sr         = detectSupportResistance(candles, 20, srThresh);
  const fib        = calculateFibonacci(candles, Math.min(50, candles.length - 1));
  const momentum   = calculateMomentumScore(candles);
  const divergence = detectDivergence(candles);
  const vwap       = calculateVWAP(candles);
  const trendStr   = calculateTrendStrength(candles);

  const isBuyingLow = (
    (sr.nearSupport || sr.distanceToSupport < 0.1) &&
    (!sr.nearResistance) &&
    (vwap ? vwap.belowVWAP : true) &&
    (fib ? fib.position < 0.5 : true)
  );
  // FIX BUG 5: isSellingHigh dilonggarkan — kondisi sebelumnya terlalu ketat
  // distanceToResistance < 0.1 jarang terpenuhi, fib.position > 0.5 juga tidak selalu ada
  // Sekarang: nearResistance ATAU distanceToResistance < 0.3, VWAP opsional
  const isSellingHigh = (
    (sr.nearResistance || sr.distanceToResistance < 0.3) &&
    (!sr.nearSupport) &&
    (vwap ? vwap.aboveVWAP : true)
  );
  const goodRiskReward = sr.srRatio >= 1.5 || sr.distanceToResistance > sr.distanceToSupport * 2;

  return { sr, fib, momentum, divergence, vwap, trendStrength: trendStr, isBuyingLow, isSellingHigh, goodRiskReward, close };
}

// ─── Level 1: Scalper ─────────────────────────────────────────────────────────
// Tujuan: entry cepat berdasarkan RSI7 + EMA Ribbon
// Score BUY: 75-88 (zona BUY >= 72)
// Score SELL: 12-25 (zona SELL <= 28)
function level1Signal(candles, direction = 'both') {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const close   = closes[closes.length - 1];

  const rsi7  = getLatestRSI(closes, 7);
  const rsi14 = getLatestRSI(closes, 14);
  const ema5  = getLatestEMA(closes, 5);
  const ema9  = getLatestEMA(closes, 9);
  const ema21 = getLatestEMA(closes, 21);
  const stochRSI = calculateStochRSI(closes);
  const htfBias  = getHigherTFBias(candles);
  const candle   = detectCandlePattern(candles);
  const ctx      = getAdvancedContext(candles);

  const ribbonBull = ema5 > ema9 && ema9 > ema21 && close > ema9;
  const ribbonBear = ema5 < ema9 && ema9 < ema21 && close < ema9;

  const avgVol   = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;

  let action = 'HOLD', score = 50;
  const reasons = [];

  // ── BUY signals ──────────────────────────────────────────────────────────
  if (direction !== 'sell') {
    if (rsi7 < 28 && ribbonBull && htfBias.bias !== 'bearish' && ctx.isBuyingLow) {
      action = 'BUY'; score = 88; reasons.push(`RSI7 ${rsi7?.toFixed(0)} oversold + ribbon + dekat support`);
    } else if (stochRSI !== null && stochRSI < 15 && ema9 > ema21 && ctx.goodRiskReward) {
      action = 'BUY'; score = 85; reasons.push(`StochRSI ${stochRSI} extreme oversold`);
    } else if (ctx.divergence.bullish && htfBias.bias !== 'bearish') {
      action = 'BUY'; score = 82; reasons.push(`🔀 Bullish divergence`);
    } else if (ctx.fib && ctx.fib.inGoldenZone && candle.direction === 'bullish' && htfBias.bias !== 'bearish') {
      action = 'BUY'; score = 80; reasons.push(`Fib golden zone + ${candle.pattern}`);
    } else if (rsi14 < 35 && ema9 > ema21 && htfBias.bias !== 'bearish' && candle.direction === 'bullish') {
      action = 'BUY'; score = 75; reasons.push(`RSI14 oversold + ${candle.pattern}`);
    } else if (candle.pattern === 'morning_star' && htfBias.bias !== 'bearish' && ctx.isBuyingLow) {
      action = 'BUY'; score = 83; reasons.push(`Morning star + dekat support`);
    } else if (candle.pattern === 'bullish_engulfing' && ema9 > ema21 && htfBias.bias === 'bullish') {
      action = 'BUY'; score = 80; reasons.push(`Bullish engulfing + HTF bullish`);
    } else if (candle.pattern === 'hammer' && rsi14 < 45 && ctx.isBuyingLow) {
      action = 'BUY'; score = 76; reasons.push(`Hammer pattern + dekat support`);
    }
  }

  // ── SELL signals ──────────────────────────────────────────────────────────
  // FIX: score SELL sekarang konsisten di zona SELL (<= 28)
  // Semua score SELL pakai skala 12-25 (simetris dengan BUY 75-88)
  if (direction !== 'buy') {
    if (rsi7 > 72 && ribbonBear && htfBias.bias !== 'bullish' && ctx.isSellingHigh) {
      // FIX: tambah ctx.isSellingHigh agar simetris dengan BUY
      action = 'SELL'; score = 12; reasons.push(`RSI7 overbought + ribbon bear + dekat resistance`);
    } else if (stochRSI !== null && stochRSI > 85 && ema9 < ema21 && ctx.goodRiskReward) {
      // FIX: tambah StochRSI SELL simetris dengan BUY
      action = 'SELL'; score = 15; reasons.push(`StochRSI ${stochRSI} extreme overbought`);
    } else if (ctx.divergence.bearish && htfBias.bias !== 'bullish') {
      action = 'SELL'; score = 18; reasons.push(`🔀 Bearish divergence`);
    } else if (ctx.fib && ctx.fib.inGoldenZone && candle.direction === 'bearish' && htfBias.bias !== 'bullish') {
      // FIX: Fib golden zone untuk SELL (harga di atas 0.618 → resistance zone)
      action = 'SELL'; score = 20; reasons.push(`Fib resistance zone + ${candle.pattern}`);
    } else if (candle.pattern === 'evening_star' && htfBias.bias === 'bearish' && ctx.isSellingHigh) {
      action = 'SELL'; score = 17; reasons.push(`Evening star + dekat resistance`);
    } else if (candle.pattern === 'bearish_engulfing' && htfBias.bias === 'bearish') {
      action = 'SELL'; score = 20; reasons.push(`Bearish engulfing + HTF bearish`);
    } else if (candle.pattern === 'shooting_star' && rsi7 > 55 && ctx.isSellingHigh) {
      action = 'SELL'; score = 22; reasons.push(`Shooting star + dekat resistance`);
    } else if (rsi14 > 65 && ema9 < ema21 && htfBias.bias !== 'bullish' && candle.direction === 'bearish') {
      // FIX: tambah RSI14 overbought simetris dengan RSI14 oversold BUY
      action = 'SELL'; score = 25; reasons.push(`RSI14 overbought + ${candle.pattern}`);
    }
  }

  // ── Filters ───────────────────────────────────────────────────────────────
  if (candle.pattern === 'doji' && (action === 'BUY' || action === 'SELL')) {
    action = 'HOLD'; score = 50; reasons.push('Doji — pasar ragu, skip');
  }
  if ((action === 'BUY' || action === 'SELL') && ctx.momentum.score < 45) {
    action = 'HOLD'; score = 50; reasons.push(`Momentum rendah (${ctx.momentum.grade}) — skip`);
  }
  if (action === 'BUY' && !ctx.trendStrength.trending && !ctx.isBuyingLow) {
    action = 'HOLD'; score = 50; reasons.push('Market sideways + tidak dekat support — skip');
  }
  if (action === 'SELL' && !ctx.trendStrength.trending && !ctx.isSellingHigh) {
    // FIX: filter sideways simetris untuk SELL
    action = 'HOLD'; score = 50; reasons.push('Market sideways + tidak dekat resistance — skip');
  }
  if (action === 'BUY' && ctx.sr.nearResistance) {
    action = 'HOLD'; score = 50; reasons.push(`Harga dekat resistance — tunggu pullback`);
  }
  if (action === 'SELL' && ctx.sr.nearSupport) {
    // FIX: filter SELL dekat support simetris dengan BUY dekat resistance
    action = 'HOLD'; score = 50; reasons.push(`Harga dekat support — tunggu rebound`);
  }

  return {
    action, score, rsi: rsi7, rsi14, stochRSI, ema5, ema9, ema21,
    volRatio, ribbonBull, ribbonBear, candle, htfBias, reasons, context: ctx,
    signals: {
      rsi:      rsi7 < 30 ? 'oversold' : rsi7 > 70 ? 'overbought' : 'neutral',
      ema:      ribbonBull ? 'bullish' : ribbonBear ? 'bearish' : 'neutral',
      candle:   candle.pattern, htf: htfBias.bias,
      sr:       ctx.sr.nearSupport ? 'near_support' : ctx.sr.nearResistance ? 'near_resistance' : 'mid',
      momentum: ctx.momentum.grade, divergence: ctx.divergence.type,
    },
  };
}

// ─── Level 2: Smart Adaptive ──────────────────────────────────────────────────
// Tujuan: tambah market filter + confidence scoring di atas L1
// FIX: cooldown DIHAPUS dari sini (sudah ada di main cycle, tidak perlu duplikat)
// FIX: confidence scoring ditambah untuk SELL
function level2Signal(candles, direction = 'both') {
  const base   = level1Signal(candles, direction);
  const closes = candles.map(c => c.close);
  const trend  = detectMarketTrend(closes);
  const ctx    = base.context;

  // Filter trend berlawanan dengan HTF
  if (base.action === 'BUY' && trend === 'bearish' && base.htfBias?.bias === 'bearish')
    return { ...base, action: 'HOLD', score: 50, reason: 'bearish_filter', trend };
  if (base.action === 'SELL' && trend === 'bullish' && base.htfBias?.bias === 'bullish')
    return { ...base, action: 'HOLD', score: 50, reason: 'bullish_filter', trend };

  // Filter sideways — tidak ada trend yang jelas
  if (base.action === 'BUY' && !ctx.trendStrength.trending && !ctx.isBuyingLow)
    return { ...base, action: 'HOLD', score: 50, reason: 'adx_sideways_filter_buy', trend };
  if (base.action === 'SELL' && !ctx.trendStrength.trending && !ctx.isSellingHigh)
    // FIX: sideways filter untuk SELL simetris
    return { ...base, action: 'HOLD', score: 50, reason: 'adx_sideways_filter_sell', trend };

  // FIX MASALAH 6: VWAP filter diperbaiki — sebelumnya memblok BUY saat harga di atas VWAP
  // Padahal trend BUY kuat justru terjadi saat harga DI ATAS VWAP (momentum bullish)
  // Filter sekarang: hanya blok jika harga di SISI SALAH VWAP untuk entry reversal
  // BUY di bawah VWAP = entry melawan momentum → blok jika tidak dekat support
  // SELL di atas VWAP = entry melawan momentum → blok jika tidak dekat resistance
  if (base.action === 'BUY' && ctx.vwap && ctx.vwap.belowVWAP && !ctx.sr.nearSupport)
    return { ...base, action: 'HOLD', score: 50, reason: 'below_vwap_no_support_buy', trend };
  if (base.action === 'SELL' && ctx.vwap && ctx.vwap.aboveVWAP && !ctx.sr.nearResistance)
    return { ...base, action: 'HOLD', score: 50, reason: 'above_vwap_no_resistance_sell', trend };

  // Confidence scoring — simetris BUY dan SELL
  let confidence = 0;
  if (base.rsi !== null) {
    if (base.action === 'BUY'  && base.rsi < 38) confidence += 30;
    if (base.action === 'SELL' && base.rsi > 62) confidence += 30;
    if (base.stochRSI !== null && base.stochRSI < 30) confidence += (base.action === 'BUY'  ? 20 : 0);
    if (base.stochRSI !== null && base.stochRSI > 70) confidence += (base.action === 'SELL' ? 20 : 0);
  }
  if (base.ema9 && base.ema21) {
    const diff = Math.abs(base.ema9 - base.ema21) / base.ema21;
    confidence += Math.min(35, diff * 5000);
  }
  if (base.htfBias?.bias === (base.action === 'BUY' ? 'bullish' : 'bearish')) confidence += 15;
  if (base.candle?.direction === (base.action === 'BUY' ? 'bullish' : 'bearish'))   confidence += 10;
  if (ctx.isBuyingLow  && base.action === 'BUY')  confidence += 15;
  if (ctx.isSellingHigh && base.action === 'SELL') confidence += 15; // FIX: simetris
  if (ctx.divergence.bullish && base.action === 'BUY')  confidence += 20;
  if (ctx.divergence.bearish && base.action === 'SELL') confidence += 20; // FIX: simetris
  if (ctx.momentum.score >= 65) confidence += 10;

  if (base.action !== 'HOLD' && confidence < 55)
    return { ...base, action: 'HOLD', score: 50, reason: 'low_confidence', confidence, trend };

  return { ...base, trend, confidence };
}

// ─── Level 3: AI Scoring ──────────────────────────────────────────────────────
// Tujuan: multi-indicator score dengan adjustments
// FIX UTAMA: SELL score tidak lagi dibalik (100 - score)
// Score tetap pada skala 0-100: BUY >= 72, SELL <= 28, HOLD 28-72
function level3Signal(candles, direction = 'both') {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const rsi     = getLatestRSI(closes, 14);
  const ema9    = getLatestEMA(closes, 9);
  const ema21   = getLatestEMA(closes, 21);
  const macd    = calculateMACD(closes);
  const bb      = calculateBollingerBands(closes);
  const trend   = detectMarketTrend(closes);
  const close   = closes[closes.length - 1];
  const candle  = detectCandlePattern(candles);
  const htf     = getHigherTFBias(candles);
  const ctx     = getAdvancedContext(candles);
  const result  = computeSignalScore({ rsi, ema9, ema21, macd: macd.latest, close, bb: bb.latest, trend });

  let adjustedScore = result.score;

  // ── BUY adjustments (naikkan score mendekati 100) ─────────────────────────
  if (candle.direction === 'bullish' && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 10);
  if (htf.bias === 'bullish' && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 8);
  if (ctx.isBuyingLow && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 12);
  if (ctx.divergence.bullish && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 15);
  if (ctx.fib && ctx.fib.inGoldenZone && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 10);
  if (ctx.vwap && ctx.vwap.belowVWAP && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 7);
  if (ctx.momentum.score >= 70 && result.action === 'BUY')
    adjustedScore = Math.min(100, adjustedScore + 8);

  // ── SELL adjustments (turunkan score mendekati 0) ─────────────────────────
  // FIX: SELL tidak lagi pakai (100 - score + 10) yang membalik score
  // Sebaliknya: kurangi score agar tetap di zona SELL (<= 28)
  if (candle.direction === 'bearish' && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 10); // FIX: turunkan, bukan flip
  if (htf.bias === 'bearish' && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 8);  // FIX: simetris dengan BUY +8
  if (ctx.isSellingHigh && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 12); // FIX: simetris dengan isBuyingLow
  if (ctx.divergence.bearish && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 15); // sudah benar, dipertahankan
  if (ctx.fib && ctx.fib.position > 0.786 && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 10); // FIX: resistance Fib untuk SELL
  if (ctx.vwap && ctx.vwap.aboveVWAP && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 7);  // FIX: simetris belowVWAP BUY
  if (ctx.momentum.score >= 70 && result.action === 'SELL')
    adjustedScore = Math.max(0, adjustedScore - 8);  // FIX: simetris

  // ── Filters (berlaku untuk kedua arah) ───────────────────────────────────
  if (candle.pattern === 'doji') adjustedScore = 50; // ragu-ragu → netral
  if (ctx.sr.nearResistance && result.action === 'BUY')  adjustedScore -= 15;
  if (ctx.sr.nearSupport    && result.action === 'SELL') adjustedScore += 15; // FIX: simetris (naik ke HOLD)
  if (!ctx.trendStrength.trending) {
    if (result.action === 'BUY'  && !ctx.isBuyingLow)   adjustedScore = Math.max(50, adjustedScore - 10);
    if (result.action === 'SELL' && !ctx.isSellingHigh)  adjustedScore = Math.min(50, adjustedScore + 10); // FIX
  }
  if (ctx.momentum.score < 40) {
    if (result.action === 'BUY')  adjustedScore -= 10;
    if (result.action === 'SELL') adjustedScore += 10; // FIX: simetris
  }

  // Clamp
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  let action = 'HOLD';
  if (adjustedScore >= 72 && direction !== 'sell') action = 'BUY';
  if (adjustedScore <= 28 && direction !== 'buy')  action = 'SELL';

  return { ...result, action, score: adjustedScore, rsi, ema9, ema21, macd: macd.latest, trend, bb: bb.latest, candle, htf, context: ctx };
}

// ─── Level 4: Adaptive ML-like ────────────────────────────────────────────────
// Tujuan: filter tambahan ATR volatilitas dan S/R ratio
// FIX: filter ATR dan SR berlaku simetris untuk SELL
function level4Signal(candles, direction = 'both') {
  const base   = level3Signal(candles, direction);
  const closes = candles.map(c => c.close);
  const ctx    = base.context;

  // Sinyal sangat kuat dari L3 — langsung lolos
  if (base.action !== 'HOLD' && base.score > 82) {
    return { ...base, source: 'L4_strong_l3' };
  }

  // ATR volatilitas filter — berlaku untuk BUY dan SELL
  const atr    = calculateATR(candles);
  const close  = closes[closes.length - 1];
  const atrPct = atr ? (atr / close) * 100 : 0;

  if (atrPct > 0.5 && base.action !== 'HOLD') {
    // Volatilitas tinggi — butuh score lebih kuat
    const minScore = base.action === 'BUY' ? 78 : 22; // FIX: threshold simetris untuk SELL
    if (base.action === 'BUY'  && base.score < minScore)
      return { ...base, action: 'HOLD', score: 50, reason: 'high_volatility_filter_buy', atrPct };
    if (base.action === 'SELL' && base.score > minScore)
      // FIX: SELL score harus < 22 saat volatilitas tinggi
      return { ...base, action: 'HOLD', score: 50, reason: 'high_volatility_filter_sell', atrPct };
  }

  // FIX BUG 4: srRatio filter diperbaiki agar tidak blok SELL
  // srRatio = distanceToResistance / distanceToSupport
  // BUY ideal: resistance jauh, support dekat → srRatio besar (>1.2)
  // SELL ideal: support jauh, resistance dekat → srRatio kecil (<0.8)
  // Filter lama: srRatio < 1.2 blok semua termasuk SELL yang valid
  if (ctx.sr.srRatio > 0 && base.action !== 'HOLD') {
    if (base.action === 'BUY'  && ctx.sr.srRatio < 1.2)
      return { ...base, action: 'HOLD', score: 50, reason: 'poor_sr_ratio_buy', srRatio: ctx.sr.srRatio };
    if (base.action === 'SELL' && ctx.sr.srRatio > 5.0)
      // SELL diblok hanya jika support sangat jauh (srRatio > 5 = support 5x lebih jauh dari resistance)
      return { ...base, action: 'HOLD', score: 50, reason: 'poor_sr_ratio_sell', srRatio: ctx.sr.srRatio };
  }

  return { ...base, source: 'L4_filtered', atrPct };
}

// ─── Level 5: Full Context ────────────────────────────────────────────────────
// Tujuan: semua filter aktif, paling ketat
// FIX: momentum filter simetris untuk SELL, ADX lebih fleksibel
function level5Signal(candles, direction = 'both', openPositions = []) {
  const base = level4Signal(candles, direction);
  const ctx  = base.context;

  if (base.action === 'HOLD') return { ...base, source: 'L5_hold_propagated' };

  // Tidak boleh ada posisi berlawanan (no hedging)
  const hasOppositePos = openPositions.some(p =>
    (base.action === 'BUY'  && p.direction === 'sell') ||
    (base.action === 'SELL' && p.direction === 'buy')
  );
  if (hasOppositePos) return { ...base, action: 'HOLD', score: 50, reason: 'opposite_position_open' };

  // ADX trend filter — harus ada trend yang jelas
  // FIX: kecuali harga dekat S/R yang kuat (isBuyingLow / isSellingHigh)
  if (!ctx.trendStrength.trending) {
    if (base.action === 'BUY'  && !ctx.isBuyingLow)
      return { ...base, action: 'HOLD', score: 50, reason: 'adx_no_trend_l5_buy', adx: ctx.trendStrength.adx };
    if (base.action === 'SELL' && !ctx.isSellingHigh)
      // FIX: simetris — SELL tanpa trend harus dekat resistance
      return { ...base, action: 'HOLD', score: 50, reason: 'adx_no_trend_l5_sell', adx: ctx.trendStrength.adx };
  }

  // Momentum filter — minimal Grade C (score >= 50)
  // FIX: sebelumnya < 55 yang terlalu ketat, turun ke 50 agar lebih realistis
  if (ctx.momentum.score < 50) {
    return { ...base, action: 'HOLD', score: 50, reason: `momentum_too_low_l5_${ctx.momentum.grade}` };
  }

  // Score filter L5 — paling ketat
  // BUY harus >= 75, SELL harus <= 25
  if (base.action === 'BUY'  && base.score < 75)
    return { ...base, action: 'HOLD', score: 50, reason: 'score_too_low_l5_buy' };
  if (base.action === 'SELL' && base.score > 25)
    // FIX: filter score untuk SELL di L5
    return { ...base, action: 'HOLD', score: 50, reason: 'score_too_high_l5_sell' };

  return { ...base, source: 'L5_all_clear' };
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
export async function runCycle(userId, candles, currentState = {}) {
  const s = getState(userId);
  if (!s.running) return { action: 'HOLD', reason: 'bot_stopped' };

  const { balance = 10000, openPositions = [], startBalance, targetBalance, scanSignal } = currentState;
  const riskCfg    = getRiskSettings();
  const instrument = currentState.instrument || s.instrument;
  const direction  = s.direction || 'both';

  // ── 1. Session Filter ──────────────────────────────────────────────────────
  const session = isGoodForexSession(instrument);
  const scanBypass = scanSignal && scanSignal.score >= 72 && scanSignal.action !== 'HOLD';

  if (!session.isGood && openPositions.length === 0 && !scanBypass) {
    if (!s.sessionSkipLogged) {
      addLog(userId, `🕐 ${session.sessionName} — Sesi sepi, bot standby`, 'info');
      s.sessionSkipLogged = true;
    }
    if (scanSignal && scanSignal.score >= 55) {
      s.lastSignal = {
        action: scanSignal.action, score: scanSignal.score, instrument,
        close: candles[candles.length - 1]?.close, time: Date.now(),
        session, fromScanner: true, sessionBlocked: true,
      };
    } else if (!s.lastSignal) {
      s.lastSignal = { action: 'HOLD', score: 0, reason: 'off_session', session, instrument, close: candles[candles.length-1]?.close, time: Date.now() };
    }
    return { action: 'HOLD', reason: 'off_session', session };
  }
  if (session.isGood || scanBypass) {
    s.sessionSkipLogged = false;
    if (scanBypass && !session.isGood) {
      addLog(userId, `⚡ Session bypass — Scanner score ${scanSignal.score} kuat, lanjut analisa`, 'system');
    }
  }

  // ── 2. Pair Blacklist ──────────────────────────────────────────────────────
  if (isPairBlacklisted(instrument) && openPositions.length === 0) {
    addLog(userId, `🚫 ${instrument} skip (blacklist aktif)`, 'warning');
    return { action: 'HOLD', reason: 'pair_blacklisted' };
  }

  // ── 3. Auto-pause ──────────────────────────────────────────────────────────
  if (s.consecutiveLosses >= riskCfg.maxConsecutiveLosses) {
    if (!s.isPaused) {
      s.isPaused = true;
      s.pauseReason = 'consecutive_losses';
      addLog(userId, `⚠️ Auto-pause: ${riskCfg.maxConsecutiveLosses} losses berturut`, 'warning');
    }
    return { action: 'HOLD', reason: 'auto_paused' };
  }

  if (candles.length < 30) return { action: 'HOLD', reason: 'insufficient_data' };

  const close = candles[candles.length - 1].close;
  const pip   = PIP_VALUES[instrument] || 0.0001;

  // ── 4. Get signal ──────────────────────────────────────────────────────────
  let signal;
  try {
    switch (s.level) {
      case 1: signal = level1Signal(candles, direction); break;
      case 2: signal = level2Signal(candles, direction); break;
      case 3: signal = level3Signal(candles, direction); break;
      case 4: signal = level4Signal(candles, direction); break;
      case 5: signal = level5Signal(candles, direction, openPositions); break;
      default: signal = level1Signal(candles, direction);
    }
  } catch (err) {
    addLog(userId, `❌ Signal error: ${err.message}`, 'error');
    signal = { action: 'HOLD', score: 50 };
  }

  // ── Merge scanSignal + level signal berdasarkan signalMode ──────────────────
  // Mode A: 'scanner'  — sinyal murni dari pair scanner, level diabaikan
  // Mode B: 'level'    — sinyal murni dari level 1-5, scanner diabaikan
  // Mode C: 'combined' — scanner + level harus setuju (perilaku default)
  const signalMode = s.signalMode || 'combined';

  if (signalMode === 'scanner') {
    // ── MODE A: Scanner Only ──────────────────────────────────────────────────
    if (scanSignal && scanSignal.action && scanSignal.action !== 'HOLD' && scanSignal.score >= 70) {
      signal = {
        action:      scanSignal.action,
        score:       scanSignal.score,
        reasons:     scanSignal.reasons || [],
        fromScanner: true,
        scannerOnly: true,
      };
      addLog(userId, `🔍 [Scanner Only] ${scanSignal.action} — Score ${scanSignal.score}`, 'system');
    } else if (scanSignal && scanSignal.action !== 'HOLD') {
      signal = { action: 'HOLD', score: 50, reason: 'scanner_score_too_low', scanScore: scanSignal?.score };
      addLog(userId, `⏳ [Scanner Only] Score ${scanSignal?.score} < 70, tunggu sinyal lebih kuat`, 'info');
    } else {
      signal = { action: 'HOLD', score: 50, reason: 'no_scanner_signal' };
    }

  } else if (signalMode === 'level') {
    // ── MODE B: Level Only ────────────────────────────────────────────────────
    // signal sudah dihitung dari switch(botState.level) di atas
    // Scanner diabaikan sepenuhnya
    if (signal.action !== 'HOLD') {
      addLog(userId, `📊 [Level ${s.level} Only] ${signal.action} — Score ${signal.score}`, 'system');
    }

  } else {
    // ── MODE C: Combined (default) ────────────────────────────────────────────
    if (scanSignal && scanSignal.action && scanSignal.action !== 'HOLD') {
      const scanScore   = scanSignal.score || 50;
      const levelAction = signal.action;

      if (levelAction === scanSignal.action) {
        // ✅ AGREEMENT
        let levelConviction = 0;
        if (signal.action === 'BUY')  levelConviction = Math.max(0, Math.round((signal.score - 50) * 2));
        if (signal.action === 'SELL') levelConviction = Math.max(0, Math.round((50 - signal.score) * 2));

        const combined = Math.round(scanScore * 0.60 + levelConviction * 0.40);
        signal = {
          ...signal,
          action:           scanSignal.action,
          score:            Math.min(100, Math.max(55, combined)),
          boostedByScan:    true,
          scannerAgreement: true,
        };
        addLog(userId, `✅ Sinkron: Scanner ${scanSignal.action} (${scanScore}) + Level ${levelAction} → Score ${signal.score}`, 'system');

      } else if (levelAction === 'HOLD') {
        signal = { ...signal, action: 'HOLD', score: 50, reason: 'waiting_level_confirmation', scanPending: scanSignal.action, scanScore };
        addLog(userId, `⏳ Scanner ${scanSignal.action} (${scanScore}) — Level belum konfirmasi, menunggu...`, 'info');

      } else {
        // ❌ KONFLIK — cek apakah scanner sangat yakin (>=85) → bypass konflik
        if (scanScore >= 85) {
          signal = {
            ...signal,
            action:        scanSignal.action,
            score:         Math.round(scanScore * 0.85),
            reason:        'scanner_override_conflict',
            scannerForced: true,
            scanScore,
          };
          addLog(userId, `⚡ Scanner ${scanSignal.action} (${scanScore}≥85) override konflik vs Level ${levelAction}`, 'warning');
        } else {
          signal = {
            ...signal,
            action:      'HOLD',
            score:       50,
            reason:      'scanner_level_conflict',
            scanAction:  scanSignal.action,
            levelAction: levelAction,
            scanScore,
          };
          addLog(userId, `🚫 KONFLIK: Scanner ${scanSignal.action} (${scanScore}) vs Level ${levelAction} → HOLD`, 'warning');
        }
      }
    }
  }

  // ── 5. Check exits ─────────────────────────────────────────────────────────
  const exitDecisions = [];
  for (const pos of openPositions) {
    if (pos.instrument !== instrument) continue;
    const updated   = updateTrailingStop(pos, close);
    const exitCheck = checkPositionExit(updated, close);

    if (exitCheck.shouldPartial && s.partialTpEnabled !== false) {
      exitDecisions.push({ position: pos, reason: 'partial_tp1', isPartial: true, partialPct: 50, pnlPips: exitCheck.pnlPips, pnlUSD: exitCheck.pnlUSD });
      addLog(userId, `💰 PARTIAL TP — ${instrument} @ ${close.toFixed(5)} | +${exitCheck.pnlPips?.toFixed(1)}p | +$${Math.abs(exitCheck.pnlUSD || 0).toFixed(2)}`, 'profit');
      continue;
    }
    if (exitCheck.shouldBreakeven && s.breakevenEnabled !== false) {
      exitDecisions.push({ position: pos, reason: 'breakeven_set', isBreakeven: true, newStopLoss: exitCheck.newStopLoss });
      addLog(userId, `🔒 BREAKEVEN — ${instrument} SL digeser ke entry`, 'system');
      continue;
    }
    if (exitCheck.shouldClose) {
      exitDecisions.push({ position: pos, reason: exitCheck.reason, pnlPips: exitCheck.pnlPips, pnlUSD: exitCheck.pnlUSD });
      const emoji = exitCheck.pnlUSD >= 0 ? '✅' : '❌';
      const tag   = exitCheck.reason === 'time_exit' ? '⏰ TIME EXIT' : exitCheck.reason.toUpperCase().replace(/_/g, ' ');
      addLog(userId, `${emoji} ${tag} | ${exitCheck.pnlUSD >= 0 ? '+' : ''}$${Math.abs(exitCheck.pnlUSD || 0).toFixed(2)} | ${exitCheck.pnlPips >= 0 ? '+' : ''}${(exitCheck.pnlPips || 0).toFixed(1)}p`, exitCheck.pnlUSD >= 0 ? 'profit' : 'loss');
      continue;
    }
    if (s.smartExitEnabled !== false && signal) {
      const rev = checkSignalReversal(pos, close, signal);
      if (rev.shouldExit) {
        exitDecisions.push({ position: pos, reason: rev.reason, pnlPips: rev.pnlPips, pnlUSD: rev.pnlUSD });
        addLog(userId, `🧠 SMART EXIT — sinyal berbalik | ${rev.pnlUSD >= 0 ? '+' : ''}$${Math.abs(rev.pnlUSD || 0).toFixed(2)}`, rev.pnlUSD >= 0 ? 'profit' : 'loss');
      }
    }
  }

  // ── 6. Entry decision ──────────────────────────────────────────────────────
  let entryDecision = null;
  const { allowed } = canOpenPosition(openPositions.length, s.consecutiveLosses, s.isPaused);
  const cooldownMs  = (s.cooldownSeconds || 60) * 1000;

  // Double confirmation
  const isAutoPairMode = !!scanSignal;
  if (!isAutoPairMode && s._lastConfirmInstrument && s._lastConfirmInstrument !== instrument) {
    resetDoubleConfirmation();
  }
  s._lastConfirmInstrument = instrument;

  const scannerHighConviction = signal.scannerAgreement && signal.score >= 75;
  const signalConfirmed = scannerHighConviction ? true : checkDoubleConfirmation(signal.action);

  if (!signalConfirmed && signal.action !== 'HOLD') {
    addLog(userId, `⏳ Menunggu konfirmasi ke-2 — ${signal.action} ${instrument} (score ${signal.score?.toFixed(0)})`, 'info');
  }

  // ── A. Candle Confirmation ────────────────────────────────────────────────
  const candleN   = s.level >= 5 ? 3 : 2;
  const candleChk = (signal.action === 'BUY' || signal.action === 'SELL')
    ? candleConfirmation(candles, signal.action, candleN)
    : { confirmed: true, bullCount: 0, bearCount: 0, details: 'skipped_hold' };

  if (!candleChk.confirmed && (signal.action === 'BUY' || signal.action === 'SELL')) {
    addLog(userId, `🕯️ Candle belum konfirmasi — ${signal.action} butuh ${candleN} candle searah (${candleChk.details})`, 'info');
  }

  // ── B. Spread Filter ──────────────────────────────────────────────────────
  const ticker    = currentState.ticker || null;
  const spreadChk = checkSpread(instrument, ticker?.bid || null, ticker?.ask || null, candles);

  if (!spreadChk.ok && (signal.action === 'BUY' || signal.action === 'SELL')) {
    addLog(userId, `📊 Spread terlalu lebar — ${instrument} ~${spreadChk.spreadPips}pips (max ${spreadChk.maxPips}pips), skip entry`, 'warning');
  }

  // ── C. Unified Score ──────────────────────────────────────────────────────
  const unifiedScore = normalizeScore(signal.score, 'level', signal.action);

  // Update lastSignal
  s.lastSignal = {
    ...signal, unifiedScore, instrument, close, time: Date.now(), session,
    candleConfirmation: candleChk, spreadOk: spreadChk.ok, spreadPips: spreadChk.spreadPips,
  };

  // Log state entry gate
  if (signal.action === 'BUY' || signal.action === 'SELL') {
    if (!allowed) addLog(userId, `🚫 Entry blocked — ${!s.isPaused ? `max pos (${openPositions.length})` : 'bot paused'}`, 'warning');
    if (openPositions.length > 0) addLog(userId, `📊 Entry skip — ada ${openPositions.length} posisi terbuka`, 'info');
  }

  // ── Entry Gate: semua harus PASS ─────────────────────────────────────────
  const entryGatePassed = allowed
    && (signal.action === 'BUY' || signal.action === 'SELL')
    && openPositions.length === 0
    && signalConfirmed
    && candleChk.confirmed
    && spreadChk.ok;

  if (entryGatePassed) {
    // ── Cooldown check (hanya di sini, tidak di L2) ───────────────────────
    if (Date.now() - s.lastActionTime < cooldownMs) {
      const remaining = Math.round((cooldownMs - (Date.now() - s.lastActionTime)) / 1000);
      addLog(userId, `⏱️ Cooldown aktif — tunggu ${remaining}s`, 'info');
    } else {
      const signalGrade = signal.context?.momentum?.grade || 'C';
      const slPips      = s.stopLossPips || 20;
      const sizing      = calculateLotSize(balance, slPips, instrument,
        {
          consecutiveLosses: s.consecutiveLosses,
          consecutiveWins:   s.consecutiveWins,
          startBalance:      currentState.startBalance || balance, // untuk Compound Mode
        },
        signalGrade,
      );

      if (sizing.lots <= 0) {
        addLog(userId, `⚠️ Saldo tidak cukup ($${balance.toFixed(2)})`, 'warning');
      } else {
        const isBuy    = signal.action === 'BUY';
        const adaptive = calculateAdaptiveTPSL(candles, close, isBuy ? 'buy' : 'sell');
        const ctx      = signal.context || getAdvancedContext(candles, instrument);

        let finalTP = adaptive.takeProfit;
        let finalSL = adaptive.stopLoss;

        // S/R adjustment
        if (isBuy) {
          if (ctx.sr.closestResistance && ctx.sr.closestResistance > close && ctx.sr.closestResistance < finalTP)
            finalTP = ctx.sr.closestResistance - pip * 2;
          if (ctx.sr.closestSupport && ctx.sr.closestSupport < close && ctx.sr.closestSupport > finalSL)
            finalSL = ctx.sr.closestSupport - pip * 2;
        } else {
          if (ctx.sr.closestSupport && ctx.sr.closestSupport < close && ctx.sr.closestSupport > finalTP)
            finalTP = ctx.sr.closestSupport + pip * 2;
          if (ctx.sr.closestResistance && ctx.sr.closestResistance > close && ctx.sr.closestResistance < finalSL)
            finalSL = ctx.sr.closestResistance + pip * 2;
        }

        // Sanity check: jangan flip ke sisi salah
        if (isBuy)  { if (finalSL >= close) finalSL = adaptive.stopLoss; if (finalTP <= close) finalTP = adaptive.takeProfit; }
        else        { if (finalSL <= close) finalSL = adaptive.stopLoss; if (finalTP >= close) finalTP = adaptive.takeProfit; }

        // Minimum distance
        const minSlDist = pip * (s.minSlPips || 10);
        const minTpDist = pip * (s.minTpPips || 15);
        if (isBuy) {
          if ((close - finalSL) < minSlDist) finalSL = close - pip * Math.max(s.stopLossPips || 20, 10);
          if ((finalTP - close) < minTpDist) finalTP = close + pip * Math.max(s.takeProfitPips || 40, 15);
        } else {
          if ((finalSL - close) < minSlDist) finalSL = close + pip * Math.max(s.stopLossPips || 20, 10);
          if ((close - finalTP) < minTpDist) finalTP = close - pip * Math.max(s.takeProfitPips || 40, 15);
        }

        // R:R check setelah adjustment
        const rrCheck = isBuy
          ? (finalTP - close) / Math.max(close - finalSL, pip)
          : (close - finalTP) / Math.max(finalSL - close, pip);
        if (rrCheck < 1.0) {
          finalSL = adaptive.stopLoss; finalTP = adaptive.takeProfit;
          if (isBuy) {
            if ((close - finalSL) < minSlDist) finalSL = close - pip * (s.stopLossPips || 20);
            if ((finalTP - close) < minTpDist) finalTP = close + pip * (s.takeProfitPips || 40);
          } else {
            if ((finalSL - close) < minSlDist) finalSL = close + pip * (s.stopLossPips || 20);
            if ((close - finalTP) < minTpDist) finalTP = close - pip * (s.takeProfitPips || 40);
          }
        }

        const rrNum = isBuy ? (finalTP - close) : (close - finalTP);
        const rrDen = isBuy ? (close - finalSL) : (finalSL - close);
        const rr    = rrDen > 0 ? rrNum / rrDen : 0;

        const activeMode = getActiveProfitMode();
        const minRR = activeMode === 'ultra_light'  ? 1.8 :
                      activeMode === 'ultra_profit' ? 1.0 :
                      activeMode === 'max_profit'   ? 1.5 : 1.2;

        // Max Profit Mode: paksa pakai ATR adaptive SL/TP (ignore manual pips)
        // ATR dynamic otomatis menyesuaikan volatilitas — lebih akurat dari fixed pips
        if (activeMode === 'max_profit') {
          const atrAdaptive = calculateAdaptiveTPSL(candles, close, isBuy ? 'buy' : 'sell');
          // Hanya override jika adaptive memberikan R:R lebih baik
          const atrRR = isBuy
            ? (atrAdaptive.takeProfit - close) / Math.max(close - atrAdaptive.stopLoss, pip)
            : (close - atrAdaptive.takeProfit) / Math.max(atrAdaptive.stopLoss - close, pip);
          if (atrRR >= 1.5) {
            finalTP = atrAdaptive.takeProfit;
            finalSL = atrAdaptive.stopLoss;
            addLog(userId, `📊 [Max Profit] ATR adaptive SL/TP — R:R ${atrRR.toFixed(2)}x`, 'system');
          }
        }

        if (!isFinite(rr) || rr < minRR) {
          addLog(userId, `⚡ Skip entry — R:R ${isFinite(rr) ? rr.toFixed(2) : '∞'}x < min ${minRR}x`, 'warning');
        } else {
          const slPipsActual = Math.abs(close - finalSL) / pip;
          const tpPipsActual = Math.abs(finalTP - close) / pip;

          // FIX candleTag: tampilkan count yang sesuai dengan arah sinyal
          const candleCount = isBuy ? candleChk.bullCount : candleChk.bearCount;

          entryDecision = {
            action: signal.action, direction: isBuy ? 'buy' : 'sell',
            instrument, price: close, lots: sizing.lots,
            stopLoss:    parseFloat(finalSL.toFixed(5)),
            takeProfit:  parseFloat(finalTP.toFixed(5)),
            trailingStop: isBuy ? close - pip * (s.trailingStopPips || 10) : close + pip * (s.trailingStopPips || 10),
            slPips:      parseFloat(slPipsActual.toFixed(1)),
            tpPips:      parseFloat(tpPipsActual.toFixed(1)),
            riskUSD:     sizing.riskAmount,
            riskPercent: sizing.riskPercent,
            commissionEstimate: sizing.commissionEstimate || 0,
            riskReward:  parseFloat(rr.toFixed(2)),
            score:       signal.score,
            unifiedScore,
            level:       s.level,
            openTime:    Date.now(),
            tp1Triggered: false,
            breakevenSet: false,
            session:     session.sessionName,
            nearSupport: ctx.sr.nearSupport,
            isBuyingLow: ctx.isBuyingLow,
            momentumGrade: ctx.momentum?.grade || 'N/A',
            divergence:  ctx.divergence.type,
            scannerAgreement: signal.scannerAgreement || false,
            candleConfirmed:  candleChk.confirmed,
            spreadPips:       spreadChk.spreadPips,
          };

          const dir       = isBuy ? '📈 BUY' : '📉 SELL';
          const agreeTag  = signal.scannerAgreement ? ' 🤝sync' : '';
          const bypassTag = scanBypass ? ' ⚡bypass' : '';
          const candleTag = `🕯️${candleCount}/${candleN}`;
          const spreadTag = spreadChk.spreadPips > 0 ? ` spread:${spreadChk.spreadPips}p` : '';

          addLog(userId,
            `${dir} ${instrument} @ ${close.toFixed(5)} | ${sizing.lots}lots | ` +
            `SL:${slPipsActual.toFixed(0)}p TP:${tpPipsActual.toFixed(0)}p | R:R ${rr.toFixed(1)} | ` +
            `Score ${signal.score?.toFixed(0)} | Grade ${signalGrade} | ${candleTag}${spreadTag} | ${session.sessionName}${bypassTag}${agreeTag}`,
            isBuy ? 'buy' : 'sell',
          );

          s.lastActionTime = Date.now();
          s.cooldownUntil  = Date.now() + cooldownMs;
        }
      }
    }
  }

  return {
    action: signal.action, signal, entry: entryDecision, exits: exitDecisions,
    close, level: s.level, mode: s.mode, instrument,
    session, timestamp: Date.now(),
    gates: {
      signalConfirmed,
      candleConfirmed: candleChk.confirmed,
      spreadOk:        spreadChk.ok,
      spreadPips:      spreadChk.spreadPips,
      unifiedScore,
    },
  };
}

// ─── Record trade result ───────────────────────────────────────────────────────
export function recordTradeResult(userId, pnlUSD, pnlPips, instrument = '') {
  const s = getState(userId);
  s.totalPnl += pnlUSD;
  s.stats.totalTrades++;

  if (pnlUSD > 0) {
    s.stats.wins++;
    s.consecutiveLosses = 0;
    s.consecutiveWins++;
    s.stats.bestTrade = Math.max(s.stats.bestTrade, pnlUSD);
    if (instrument) resetPairLoss(instrument);
  } else {
    s.stats.losses++;
    s.consecutiveWins   = 0;
    s.consecutiveLosses++;
    s.stats.worstTrade = Math.min(s.stats.worstTrade, pnlUSD);
    if (instrument) {
      const bl = reportPairLoss(instrument);
      if (bl) addLog(userId, `🚫 ${instrument} di-blacklist 1 jam`, 'warning');
    }
    if (s.consecutiveLosses >= 3) addLog(userId, '⚠️ 3 losses berturut — auto-pause aktif', 'warning');
  }

  s.stats.winRate    = (s.stats.wins / s.stats.totalTrades) * 100;
  const n = s.stats.totalTrades;
  s.stats.avgPnlPips = parseFloat(
    ((s.stats.avgPnlPips * (n - 1) + pnlPips) / n).toFixed(1)
  );
}

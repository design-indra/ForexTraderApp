/**
 * lib/tradingEngine.js — ForexTrader Engine v1
 * Diadaptasi dari IndoTrader v4
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
} from './indicators.js';

import {
  calculateLotSize, canOpenPosition, checkPositionExit, checkSignalReversal,
  updateTrailingStop, getRiskSettings, getActiveProfitMode,
  isPairBlacklisted, reportPairLoss, resetPairLoss, getBlacklistedPairs,
  checkDoubleConfirmation,
} from './riskManager.js';

import { PIP_VALUES } from './monex.js';

// ─── Bot State ────────────────────────────────────────────────────────────────
let botState = {
  running: false, mode: 'demo', level: 1,
  instrument: 'EUR_USD', direction: 'both', // both | buy | sell
  consecutiveLosses: 0, consecutiveWins: 0, totalPnl: 0,
  isPaused: false, pauseReason: null,
  cooldownUntil: 0, lastSignal: null, lastActionTime: 0,
  sessionSkipLogged: false,
  logs: [],
  stats: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgPnlPips: 0, bestTrade: 0, worstTrade: 0 },
};

export const getBotState = () => botState;
export const getLogs     = (n = 50) => botState.logs.slice(0, n);

export function startBot(cfg = {}) {
  botState.running    = true;
  botState.isPaused   = false;
  botState.mode       = cfg.mode       || 'demo';
  botState.level      = cfg.level      || 1;
  botState.instrument = cfg.instrument || 'EUR_USD';
  botState.direction  = cfg.direction  || 'both';
  botState.cooldownUntil  = 0;
  botState.lastActionTime = 0;
  botState.sessionSkipLogged = false;
  addLog(`🚀 ForexBot L${botState.level} started — ${botState.mode.toUpperCase()} | ${botState.instrument} | ${botState.direction}`, 'system');
}

export function stopBot()   { botState.running = false; addLog('🛑 Bot stopped', 'system'); }
export function resumeBot() {
  botState.isPaused = false; botState.pauseReason = null; botState.consecutiveLosses = 0;
  botState.sessionSkipLogged = false;
  addLog('▶️ Bot resumed', 'system');
}

export function resetBotState() {
  const savedLogs = botState.logs.slice(0, 5);
  botState = {
    ...botState, running: false, consecutiveLosses: 0, consecutiveWins: 0, totalPnl: 0,
    isPaused: false, pauseReason: null, cooldownUntil: 0, lastSignal: null, lastActionTime: 0,
    sessionSkipLogged: false, logs: savedLogs,
    stats: { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgPnlPips: 0, bestTrade: 0, worstTrade: 0 },
  };
}

function addLog(msg, type = 'info') {
  const entry = { id: Date.now() + Math.random(), time: new Date().toISOString(), message: msg, type };
  botState.logs.unshift(entry);
  if (botState.logs.length > 300) botState.logs = botState.logs.slice(0, 300);
  return entry;
}

// ─── Advanced Context (sama persis dengan IndoTrader, unit beda) ──────────────
function getAdvancedContext(candles) {
  const closes = candles.map(c => c.close);
  const close  = closes[closes.length - 1];
  const sr         = detectSupportResistance(candles, 20, 0.0005); // forex: threshold lebih kecil
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
  const goodRiskReward = sr.srRatio >= 1.5 || sr.distanceToResistance > sr.distanceToSupport * 2;

  return { sr, fib, momentum, divergence, vwap, trendStrength: trendStr, isBuyingLow, goodRiskReward, close };
}

// ─── Level 1: Scalper ─────────────────────────────────────────────────────────
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

  // ── SELL signals (forex bisa SHORT) ──────────────────────────────────────
  if (direction !== 'buy') {
    if (rsi7 > 72 && ribbonBear && htfBias.bias !== 'bullish') {
      action = 'SELL'; score = 15; reasons.push(`RSI7 overbought + ribbon bear`);
    } else if (candle.pattern === 'bearish_engulfing' && htfBias.bias === 'bearish') {
      action = 'SELL'; score = 20; reasons.push(`Bearish engulfing + HTF bearish`);
    } else if (candle.pattern === 'shooting_star' && rsi7 > 55) {
      action = 'SELL'; score = 22; reasons.push(`Shooting star overbought`);
    } else if (candle.pattern === 'evening_star' && htfBias.bias === 'bearish') {
      action = 'SELL'; score = 18; reasons.push(`Evening star + HTF bearish`);
    } else if (ctx.divergence.bearish && htfBias.bias !== 'bullish') {
      action = 'SELL'; score = 25; reasons.push(`🔀 Bearish divergence`);
    }
  }

  // ── Filters (sama logika dengan IndoTrader) ───────────────────────────────
  if (candle.pattern === 'doji' && (action === 'BUY' || action === 'SELL')) {
    action = 'HOLD'; reasons.push('Doji — pasar ragu, skip');
  }
  if ((action === 'BUY' || action === 'SELL') && ctx.momentum.score < 45) {
    action = 'HOLD'; reasons.push(`Momentum rendah (${ctx.momentum.grade}) — skip`);
  }
  if (action === 'BUY' && !ctx.trendStrength.trending && !ctx.isBuyingLow) {
    action = 'HOLD'; reasons.push('Market sideways + tidak dekat support — skip');
  }
  if (action === 'BUY' && ctx.sr.nearResistance) {
    action = 'HOLD'; reasons.push(`Harga dekat resistance — tunggu pullback`);
  }

  return {
    action, score, rsi: rsi7, rsi14, stochRSI, ema5, ema9, ema21,
    volRatio, ribbonBull, ribbonBear, candle, htfBias, reasons, context: ctx,
    signals: {
      rsi:     rsi7 < 30 ? 'oversold' : rsi7 > 70 ? 'overbought' : 'neutral',
      ema:     ribbonBull ? 'bullish' : ribbonBear ? 'bearish' : 'neutral',
      candle:  candle.pattern, htf: htfBias.bias,
      sr:      ctx.sr.nearSupport ? 'near_support' : ctx.sr.nearResistance ? 'near_resistance' : 'mid',
      momentum: ctx.momentum.grade, divergence: ctx.divergence.type,
    },
  };
}

// ─── Level 2: Smart Adaptive ──────────────────────────────────────────────────
function level2Signal(candles, direction = 'both') {
  const base   = level1Signal(candles, direction);
  const closes = candles.map(c => c.close);
  const trend  = detectMarketTrend(closes);
  const now    = Date.now();
  const ctx    = base.context;

  if (botState.cooldownUntil > now) return { ...base, action: 'HOLD', reason: 'cooldown', trend };

  if (base.action === 'BUY' && trend === 'bearish' && base.htfBias?.bias === 'bearish')
    return { ...base, action: 'HOLD', reason: 'bearish_filter', trend };
  if (base.action === 'SELL' && trend === 'bullish' && base.htfBias?.bias === 'bullish')
    return { ...base, action: 'HOLD', reason: 'bullish_filter', trend };

  if (base.action === 'BUY' && !ctx.trendStrength.trending && !ctx.isBuyingLow)
    return { ...base, action: 'HOLD', reason: 'adx_sideways_filter', trend };

  if (base.action === 'BUY' && ctx.vwap && ctx.vwap.aboveVWAP && !ctx.sr.nearSupport)
    return { ...base, action: 'HOLD', reason: 'above_vwap_not_at_support', trend };

  let confidence = 0;
  if (base.rsi !== null) {
    if (base.action === 'BUY'  && base.rsi < 38) confidence += 30;
    if (base.action === 'SELL' && base.rsi > 62) confidence += 30;
    if (base.stochRSI !== null && (base.stochRSI < 30 || base.stochRSI > 70)) confidence += 20;
  }
  if (base.ema9 && base.ema21) {
    const diff = Math.abs(base.ema9 - base.ema21) / base.ema21;
    confidence += Math.min(35, diff * 5000);
  }
  if (base.htfBias?.bias === (base.action === 'BUY' ? 'bullish' : 'bearish')) confidence += 15;
  if (base.candle?.direction === (base.action === 'BUY' ? 'bullish' : 'bearish'))   confidence += 10;
  if (ctx.isBuyingLow && base.action === 'BUY') confidence += 15;
  if (ctx.divergence.bullish && base.action === 'BUY') confidence += 20;
  if (ctx.momentum.score >= 65) confidence += 10;

  if (base.action !== 'HOLD' && confidence < 55)
    return { ...base, action: 'HOLD', reason: 'low_confidence', confidence, trend };

  return { ...base, trend, confidence };
}

// ─── Level 3: AI Scoring ──────────────────────────────────────────────────────
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
  const avgVol  = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const candle  = detectCandlePattern(candles);
  const htf     = getHigherTFBias(candles);
  const ctx     = getAdvancedContext(candles);
  const result  = computeSignalScore({ rsi, ema9, ema21, macd: macd.latest, close, bb: bb.latest, trend });

  let adjustedScore = result.score;
  if (candle.direction === 'bullish' && result.action === 'BUY') adjustedScore = Math.min(100, adjustedScore + 10);
  if (candle.direction === 'bearish' && result.action === 'SELL') adjustedScore = Math.min(100, 100 - adjustedScore + 10);
  if (htf.bias === (result.action === 'BUY' ? 'bullish' : 'bearish')) adjustedScore = Math.min(100, adjustedScore + 8);
  if (ctx.isBuyingLow && result.action === 'BUY') adjustedScore = Math.min(100, adjustedScore + 12);
  if (ctx.divergence.bullish && result.action === 'BUY') adjustedScore = Math.min(100, adjustedScore + 15);
  if (ctx.divergence.bearish && result.action === 'SELL') adjustedScore = Math.max(0, adjustedScore - 15);
  if (ctx.fib && ctx.fib.inGoldenZone && result.action === 'BUY') adjustedScore = Math.min(100, adjustedScore + 10);
  if (ctx.vwap && ctx.vwap.belowVWAP && result.action === 'BUY') adjustedScore = Math.min(100, adjustedScore + 7);
  if (ctx.momentum.score >= 70) adjustedScore = Math.min(100, adjustedScore + 8);
  if (candle.pattern === 'doji') adjustedScore = 50;
  if (ctx.sr.nearResistance && result.action === 'BUY') adjustedScore -= 15;
  if (!ctx.trendStrength.trending && !ctx.isBuyingLow) adjustedScore = Math.max(50, adjustedScore - 10);
  if (ctx.momentum.score < 40 && result.action === 'BUY') adjustedScore -= 10;

  let action = 'HOLD';
  if (adjustedScore >= 72 && direction !== 'sell') action = 'BUY';
  if (adjustedScore <= 28 && direction !== 'buy')  action = 'SELL';

  return { ...result, action, score: adjustedScore, rsi, ema9, ema21, macd: macd.latest, trend, bb: bb.latest, candle, htf, context: ctx };
}

// ─── Level 4: Adaptive ML-like ────────────────────────────────────────────────
function level4Signal(candles, direction = 'both') {
  const base  = level3Signal(candles, direction);
  const closes = candles.map(c => c.close);
  const ctx   = base.context;

  // Kalau sinyal sudah sangat kuat dari L3, langsung pakai
  if (base.action !== 'HOLD' && base.score > 80) {
    return { ...base, source: 'L4_strong_l3' };
  }

  // Additional filter: cross-validation dengan ATR
  const atr   = calculateATR(candles);
  const close = closes[closes.length - 1];
  const atrPct = atr ? (atr / close) * 100 : 0;

  // Kalau volatilitas terlalu tinggi (ATR > 0.5% dari harga), tambahkan cautious filter
  if (atrPct > 0.5 && base.action !== 'HOLD') {
    // High volatility — butuh score lebih tinggi
    if (base.score < 78) return { ...base, action: 'HOLD', reason: 'high_volatility_filter', atrPct };
  }

  // Range-bound filter: kalau harga di antara S/R, lebih hati-hati
  if (ctx.sr.srRatio > 0 && ctx.sr.srRatio < 1.2 && base.action !== 'HOLD') {
    return { ...base, action: 'HOLD', reason: 'poor_sr_ratio', srRatio: ctx.sr.srRatio };
  }

  return { ...base, source: 'L4_filtered', atrPct };
}

// ─── Level 5: Full Context ─────────────────────────────────────────────────────
function level5Signal(candles, direction = 'both', openPositions = []) {
  const base   = level4Signal(candles, direction);
  const ctx    = base.context;
  const closes = candles.map(c => c.close);
  const close  = closes[closes.length - 1];

  // Semua filter aktif
  if (base.action === 'HOLD') return { ...base, source: 'L5_hold_propagated' };

  // Jika ada posisi berlawanan yang terbuka — skip
  const hasOppositePos = openPositions.some(p =>
    (base.action === 'BUY'  && p.direction === 'sell') ||
    (base.action === 'SELL' && p.direction === 'buy')
  );
  if (hasOppositePos) return { ...base, action: 'HOLD', reason: 'opposite_position_open' };

  // ADX filter paling ketat
  if (!ctx.trendStrength.trending) {
    return { ...base, action: 'HOLD', reason: 'adx_no_trend_l5', adx: ctx.trendStrength.adx };
  }

  // Momentum minimal Grade B
  if (ctx.momentum.score < 55) {
    return { ...base, action: 'HOLD', reason: `momentum_too_low_l5_${ctx.momentum.grade}` };
  }

  return { ...base, source: 'L5_all_clear' };
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
export async function runCycle(candles, currentState = {}) {
  if (!botState.running) return { action: 'HOLD', reason: 'bot_stopped' };

  const { balance = 10000, openPositions = [], startBalance, targetBalance, scanSignal } = currentState;
  const s = getRiskSettings();
  // Gunakan instrument dari currentState jika ada (autoPair scanner override)
  const instrument = currentState.instrument || botState.instrument;
  const direction  = botState.direction || 'both';

  // ── 1. Session Filter ──────────────────────────────────────────────────────
  const session = isGoodForexSession(instrument);

  // Bypass session filter jika scanSignal sangat kuat (score >= 72)
  // Ini memungkinkan trade di jam sepi jika ada opportunity kuat
  const scanBypass = scanSignal && scanSignal.score >= 72 && scanSignal.action !== 'HOLD';

  if (!session.isGood && openPositions.length === 0 && !scanBypass) {
    if (!botState.sessionSkipLogged) {
      addLog(`🕐 ${session.sessionName} — Sesi sepi, bot standby`, 'info');
      botState.sessionSkipLogged = true;
    }
    // Jangan overwrite lastSignal jika ada scanSignal yang kuat
    if (scanSignal && scanSignal.score >= 55) {
      botState.lastSignal = {
        action  : scanSignal.action,
        score   : scanSignal.score,
        instrument,
        close   : candles[candles.length - 1]?.close,
        time    : Date.now(),
        session,
        fromScanner  : true,
        sessionBlocked: true,
      };
    } else if (!botState.lastSignal) {
      botState.lastSignal = { action: 'HOLD', score: 0, reason: 'off_session', session, instrument, close: candles[candles.length-1]?.close, time: Date.now() };
    }
    return { action: 'HOLD', reason: 'off_session', session };
  }
  if (session.isGood || scanBypass) {
    botState.sessionSkipLogged = false;
    if (scanBypass && !session.isGood) {
      addLog(`⚡ Session bypass — Scanner score ${scanSignal.score} kuat, lanjut analisa`, 'system');
    }
  }

  // ── 2. Pair Blacklist ──────────────────────────────────────────────────────
  if (isPairBlacklisted(instrument) && openPositions.length === 0) {
    addLog(`🚫 ${instrument} skip (blacklist aktif)`, 'warning');
    return { action: 'HOLD', reason: 'pair_blacklisted' };
  }

  // ── 3. Auto-pause ──────────────────────────────────────────────────────────
  if (botState.consecutiveLosses >= s.maxConsecutiveLosses) {
    if (!botState.isPaused) { botState.isPaused = true; botState.pauseReason = 'consecutive_losses'; addLog(`⚠️ Auto-pause: ${s.maxConsecutiveLosses} losses berturut`, 'warning'); }
    return { action: 'HOLD', reason: 'auto_paused' };
  }

  if (candles.length < 30) return { action: 'HOLD', reason: 'insufficient_data' };

  const close = candles[candles.length - 1].close;
  const pip   = PIP_VALUES[instrument] || 0.0001;

  // ── 4. Get signal ──────────────────────────────────────────────────────────
  let signal;
  try {
    switch (botState.level) {
      case 1: signal = level1Signal(candles, direction); break;
      case 2: signal = level2Signal(candles, direction); break;
      case 3: signal = level3Signal(candles, direction); break;
      case 4: signal = level4Signal(candles, direction); break;
      case 5: signal = level5Signal(candles, direction, openPositions); break;
      default: signal = level1Signal(candles, direction);
    }
  } catch (err) { addLog(`❌ Signal error: ${err.message}`, 'error'); signal = { action: 'HOLD' }; }

  // ── Merge scanSignal dengan signal level ──────────────────────────────────
  // Scanner score: 50-100 (conviction, 50=minimum threshold, 90+=sangat kuat)
  // Level signal score: 0-100 directional (65+=BUY zone, 35-=SELL zone, 35-65=HOLD)
  //
  // Aturan merge di autoPair:
  //   1. Scanner adalah sumber arah (direction) utama
  //   2. Level signal memberikan konfirmasi dan fine-tune score
  //   3. Jika setuju → combined score; jika konflik → scanner menang dengan sedikit penalti
  if (scanSignal && scanSignal.action && scanSignal.action !== 'HOLD') {
    const scanScore  = scanSignal.score || 50;
    const levelAgrees = signal.action === scanSignal.action;
    // Konversi level signal ke conviction score (0-100 → 50-100 conviction)
    // BUY zone (65-100) → conviction 50-100
    // SELL zone (0-35) → conviction 50-100 (inverted)
    // HOLD zone (35-65) → conviction 0-49
    let levelConviction = 0;
    if (signal.action === 'BUY')  levelConviction = Math.max(0, Math.round((signal.score - 50) * 2));
    if (signal.action === 'SELL') levelConviction = Math.max(0, Math.round((50 - signal.score) * 2));

    if (levelAgrees) {
      // Scanner dan level setuju → combined score
      // 70% scanner + 30% level conviction
      const combined = Math.round(scanScore * 0.70 + levelConviction * 0.30);
      signal = {
        ...signal,
        action: scanSignal.action,
        score : Math.min(100, Math.max(50, combined)),
        boostedByScan:    true,
        scannerAgreement: true,
      };
    } else {
      // Level tidak setuju atau HOLD — scanner menang sebagai primary signal
      const originalLevelAction = signal.action; // simpan SEBELUM overwrite
      const penaltyScore = Math.max(55, scanScore - 3);
      const isLevelHold  = originalLevelAction === 'HOLD';
      signal = {
        ...signal,
        action:           scanSignal.action,
        score:            penaltyScore,
        overriddenByScan: true,
        levelConflict:    !isLevelHold, // konflik nyata hanya jika level punya arah beda
        levelHoldOverride: isLevelHold, // level HOLD, scanner override
        levelAction:      originalLevelAction,
      };
      // Log yang akurat
      if (isLevelHold) {
        addLog(`🔍 Scanner ${scanSignal.action} (${scanScore}) override Level HOLD → Entry score ${penaltyScore}`, 'system');
      } else {
        addLog(`⚠️ Konflik arah: Scanner ${scanSignal.action} (${scanScore}) vs Level ${originalLevelAction} → Scanner menang (${penaltyScore})`, 'warning');
      }
    }
  }

  botState.lastSignal = { ...signal, instrument, close, time: Date.now(), session };

  // ── 5. Check exits ─────────────────────────────────────────────────────────
  const exitDecisions = [];
  for (const pos of openPositions) {
    if (pos.instrument !== instrument) continue;
    const updated   = updateTrailingStop(pos, close);
    const exitCheck = checkPositionExit(updated, close);

    if (exitCheck.shouldPartial && s.partialTpEnabled !== false) {
      exitDecisions.push({ position: pos, reason: 'partial_tp1', isPartial: true, partialPct: 50, pnlPips: exitCheck.pnlPips, pnlUSD: exitCheck.pnlUSD });
      addLog(`💰 PARTIAL TP — ${instrument} @ ${close.toFixed(5)} | +${exitCheck.pnlPips?.toFixed(1)}p | +$${Math.abs(exitCheck.pnlUSD || 0).toFixed(2)}`, 'profit');
      continue;
    }
    if (exitCheck.shouldBreakeven && s.breakevenEnabled !== false) {
      exitDecisions.push({ position: pos, reason: 'breakeven_set', isBreakeven: true, newStopLoss: exitCheck.newStopLoss });
      addLog(`🔒 BREAKEVEN — ${instrument} SL digeser ke entry`, 'system');
      continue;
    }
    if (exitCheck.shouldClose) {
      exitDecisions.push({ position: pos, reason: exitCheck.reason, pnlPips: exitCheck.pnlPips, pnlUSD: exitCheck.pnlUSD });
      const emoji = exitCheck.pnlUSD >= 0 ? '✅' : '❌';
      const tag   = exitCheck.reason === 'time_exit' ? '⏰ TIME EXIT' : exitCheck.reason.toUpperCase().replace(/_/g, ' ');
      addLog(`${emoji} ${tag} | ${exitCheck.pnlUSD >= 0 ? '+' : ''}$${Math.abs(exitCheck.pnlUSD || 0).toFixed(2)} | ${exitCheck.pnlPips >= 0 ? '+' : ''}${(exitCheck.pnlPips || 0).toFixed(1)}p`, exitCheck.pnlUSD >= 0 ? 'profit' : 'loss');
      continue;
    }
    if (s.smartExitEnabled !== false && signal) {
      const rev = checkSignalReversal(pos, close, signal);
      if (rev.shouldExit) {
        exitDecisions.push({ position: pos, reason: rev.reason, pnlPips: rev.pnlPips, pnlUSD: rev.pnlUSD });
        addLog(`🧠 SMART EXIT — sinyal berbalik | ${rev.pnlUSD >= 0 ? '+' : ''}$${Math.abs(rev.pnlUSD || 0).toFixed(2)}`, rev.pnlUSD >= 0 ? 'profit' : 'loss');
      }
    }
  }

  // ── 6. Entry decision ──────────────────────────────────────────────────────
  let entryDecision = null;
  const { allowed } = canOpenPosition(openPositions.length, botState.consecutiveLosses, botState.isPaused);
  const cooldownMs  = (s.cooldownSeconds || 30) * 1000;

  // Double confirmation — hanya reset jika instrument berbeda DAN scanSignal null (manual pair)
  // Jika autoPair (scanSignal ada), jangan reset karena pair bisa ganti setiap 30s
  // Scanner sendiri sudah jadi konfirmasi via scannerHighConviction
  const isAutoPairMode = !!scanSignal;
  if (!isAutoPairMode && botState._lastConfirmInstrument && botState._lastConfirmInstrument !== instrument) {
    resetDoubleConfirmation();
  }
  botState._lastConfirmInstrument = instrument;

  // Scanner override dengan score tinggi = skip double confirm (scanner IS konfirmasi ke-2)
  // scannerHighConviction: bypass double confirm jika scanner ada conviction
  // Threshold 60 karena penalty -3: scanner 70 → score 67 → masih >= 60
  const scannerHighConviction = (signal.overriddenByScan || signal.boostedByScan || signal.scannerAgreement) && signal.score >= 60;
  const signalConfirmed = scannerHighConviction ? true : checkDoubleConfirmation(signal.action);

  if (!signalConfirmed && !scannerHighConviction) {
    addLog(`⏳ Menunggu konfirmasi ke-2 — ${signal.action} ${instrument} (score ${signal.score?.toFixed(0)})`, 'info');
  }

  // Log state entry gate
  if (signal.action === 'BUY' || signal.action === 'SELL') {
    if (!allowed) addLog(`🚫 Entry blocked — ${!botState.isPaused ? `max pos (${openPositions.length})` : 'bot paused'}`, 'warning');
    if (openPositions.length > 0) addLog(`📊 Entry skip — ada ${openPositions.length} posisi terbuka`, 'info');
  }

  if (allowed && (signal.action === 'BUY' || signal.action === 'SELL') && openPositions.length === 0 && signalConfirmed) {
    if (Date.now() - botState.lastActionTime < cooldownMs) {
      const remaining = Math.round((cooldownMs - (Date.now() - botState.lastActionTime)) / 1000);
      addLog(`⏱️ Cooldown aktif — tunggu ${remaining}s`, 'info');
    } else {
      const signalGrade = signal.context?.momentum?.grade || 'C';
      const slPips = s.stopLossPips || 30;
      const tpPips = s.takeProfitPips || 60;
      const sizing  = calculateLotSize(balance, slPips, instrument,
        { consecutiveLosses: botState.consecutiveLosses, consecutiveWins: botState.consecutiveWins },
        signalGrade,
      );

      if (sizing.lots <= 0) {
        addLog(`⚠️ Saldo tidak cukup ($${balance.toFixed(2)})`, 'warning');
      } else {
        const isBuy    = signal.action === 'BUY';
        const adaptive = calculateAdaptiveTPSL(candles, close, isBuy ? 'buy' : 'sell');
        const ctx      = signal.context || getAdvancedContext(candles);

        let finalTP = adaptive.takeProfit;
        let finalSL = adaptive.stopLoss;

        // S/R adjustment
        if (isBuy) {
          // BUY: jika ada resistance sebelum TP → turunkan TP
          if (ctx.sr.closestResistance && ctx.sr.closestResistance > close && ctx.sr.closestResistance < finalTP)
            finalTP = ctx.sr.closestResistance - pip * 2;
          // BUY: jika ada support di atas SL → naikkan SL ke support
          if (ctx.sr.closestSupport && ctx.sr.closestSupport < close && ctx.sr.closestSupport > finalSL)
            finalSL = ctx.sr.closestSupport - pip * 2;
        } else {
          // SELL: jika ada support sebelum TP (di bawah close) → naikkan TP
          if (ctx.sr.closestSupport && ctx.sr.closestSupport < close && ctx.sr.closestSupport > finalTP)
            finalTP = ctx.sr.closestSupport + pip * 2;
          // SELL: jika ada resistance di bawah SL (di atas close) → turunkan SL ke resistance
          if (ctx.sr.closestResistance && ctx.sr.closestResistance > close && ctx.sr.closestResistance < finalSL)
            finalSL = ctx.sr.closestResistance + pip * 2;
        }

        // ── Sanity check SL/TP ──────────────────────────────────────────────
        // 1. Pastikan tidak flip ke sisi yang salah
        if (isBuy) {
          if (finalSL >= close) finalSL = adaptive.stopLoss;
          if (finalTP <= close) finalTP = adaptive.takeProfit;
        } else {
          if (finalSL <= close) finalSL = adaptive.stopLoss;
          if (finalTP >= close) finalTP = adaptive.takeProfit;
        }

        // 2. Jarak minimal SL = 8 pips, TP = 16 pips
        const minSlDist = pip * 8;
        const minTpDist = pip * 16;
        if (isBuy) {
          if ((close - finalSL) < minSlDist) finalSL = close - pip * Math.max(s.stopLossPips || 30, 15);
          if ((finalTP - close) < minTpDist) finalTP = close + pip * Math.max(s.takeProfitPips || 60, 30);
        } else {
          if ((finalSL - close) < minSlDist) finalSL = close + pip * Math.max(s.stopLossPips || 30, 15);
          if ((close - finalTP) < minTpDist) finalTP = close - pip * Math.max(s.takeProfitPips || 60, 30);
        }

        // 3. Cek R:R setelah adjustment — jika < 1.0, reset ke adaptive original
        // S/R adjustment tidak boleh merusak R:R terlalu parah
        const rrCheck = isBuy
          ? (finalTP - close) / Math.max(close - finalSL, pip)
          : (close - finalTP) / Math.max(finalSL - close, pip);
        if (rrCheck < 1.0) {
          // S/R adjustment merusak R:R — gunakan adaptive SL/TP langsung
          finalSL = adaptive.stopLoss;
          finalTP = adaptive.takeProfit;
          // Pastikan minimal distance lagi setelah reset
          if (isBuy) {
            if ((close - finalSL) < minSlDist) finalSL = close - pip * (s.stopLossPips || 30);
            if ((finalTP - close) < minTpDist) finalTP = close + pip * (s.takeProfitPips || 60);
          } else {
            if ((finalSL - close) < minSlDist) finalSL = close + pip * (s.stopLossPips || 30);
            if ((close - finalTP) < minTpDist) finalTP = close - pip * (s.takeProfitPips || 60);
          }
        }

        // R:R check
        const rrNum = isBuy ? (finalTP - close) : (close - finalTP);
        const rrDen = isBuy ? (close - finalSL) : (finalSL - close);
        const rr    = rrDen > 0 ? rrNum / rrDen : 0;

        const activeMode = getActiveProfitMode();
        // minRR: fleksibel berdasarkan mode dan score
        // Normal mode: 1.0 (dari 1.1 sebelumnya agar lebih trade)
        // Scanner high conviction (score >= 80): 0.8 — scanner sudah strong filter
        const minRR = activeMode === 'ultra_light'              ? 1.8 :
                      activeMode === 'ultra_profit'             ? 0.9 :
                      scannerHighConviction && signal.score >= 80 ? 0.9 :
                      scannerHighConviction                     ? 1.0 : 1.0;

        if (!isFinite(rr) || rr < minRR) {
          addLog(`⚡ Skip entry — R:R ${isFinite(rr) ? rr.toFixed(2) : '∞'}x < min ${minRR}x | SL:${(isBuy ? close-finalSL : finalSL-close).toFixed(5)} TP:${(isBuy ? finalTP-close : close-finalTP).toFixed(5)}`, 'warning');
        } else {
          const slPipsActual = Math.abs(close - finalSL) / pip;
          const tpPipsActual = Math.abs(finalTP - close) / pip;

          entryDecision = {
            action:      signal.action,
            direction:   isBuy ? 'buy' : 'sell',
            instrument,
            price:       close,
            lots:        sizing.lots,
            stopLoss:    parseFloat(finalSL.toFixed(5)),
            takeProfit:  parseFloat(finalTP.toFixed(5)),
            trailingStop: isBuy ? close - pip * (s.trailingStopPips || 15) : close + pip * (s.trailingStopPips || 15),
            slPips:      parseFloat(slPipsActual.toFixed(1)),
            tpPips:      parseFloat(tpPipsActual.toFixed(1)),
            riskUSD:     sizing.riskAmount,
            riskPercent: sizing.riskPercent,
            riskReward:  parseFloat(rr.toFixed(2)),
            score:       signal.score,
            level:       botState.level,
            openTime:    Date.now(),
            tp1Triggered: false,
            breakevenSet: false,
            session:     session.sessionName,
            nearSupport: ctx.sr.nearSupport,
            isBuyingLow: ctx.isBuyingLow,
            momentumGrade: ctx.momentum?.grade || 'N/A',
            divergence:  ctx.divergence.type,
          };

          const dir = isBuy ? '📈 BUY' : '📉 SELL';
          const bypassTag = scanBypass ? ' ⚡bypass' : '';
          addLog(
            `${dir} ${instrument} @ ${close.toFixed(5)} | ${sizing.lots}lots | ` +
            `SL:${slPipsActual.toFixed(0)}p TP:${tpPipsActual.toFixed(0)}p | R:R ${rr.toFixed(1)} | ` +
            `Score ${signal.score?.toFixed(0)} | Grade ${signalGrade} | ${session.sessionName}${bypassTag}`,
            isBuy ? 'buy' : 'sell',
          );

          botState.lastActionTime = Date.now();
          botState.cooldownUntil  = Date.now() + cooldownMs;
        }
      }
    }
  }

  return {
    action: signal.action, signal, entry: entryDecision, exits: exitDecisions,
    close, level: botState.level, mode: botState.mode, instrument,
    session, timestamp: Date.now(),
  };
}

// ─── Record trade result ───────────────────────────────────────────────────────
export function recordTradeResult(pnlUSD, pnlPips, instrument = '') {
  botState.totalPnl += pnlUSD;
  botState.stats.totalTrades++;

  if (pnlUSD > 0) {
    botState.stats.wins++;
    botState.consecutiveLosses = 0;
    botState.consecutiveWins++;
    botState.stats.bestTrade   = Math.max(botState.stats.bestTrade, pnlUSD);
    if (instrument) resetPairLoss(instrument);
  } else {
    botState.stats.losses++;
    botState.consecutiveWins   = 0;
    botState.consecutiveLosses++;
    botState.stats.worstTrade  = Math.min(botState.stats.worstTrade, pnlUSD);
    if (instrument) {
      const bl = reportPairLoss(instrument);
      if (bl) addLog(`🚫 ${instrument} di-blacklist 1 jam`, 'warning');
    }
    if (botState.consecutiveLosses >= 3) addLog('⚠️ 3 losses berturut — auto-pause aktif', 'warning');
  }

  botState.stats.winRate  = (botState.stats.wins / botState.stats.totalTrades) * 100;
  botState.stats.avgPnlPips = pnlPips;
}

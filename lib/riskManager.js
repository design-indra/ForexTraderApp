/**
 * lib/riskManager.js — Forex Risk Management (MONEX Edition)
 *
 * Fitur baru vs versi sebelumnya:
 * - Win Multiplier (anti-martingale): lot naik saat win streak
 * - Compound Mode: lot dihitung dari saldo berjalan (bukan start balance)
 * - Breakeven+: SL geser ke entry + buffer profit kecil
 * - Double Confirmation: require 2 cycle sinyal sama sebelum entry
 * - Min R:R configurable per profit mode
 */

let runtimeSettings = {
  maxPositions         : parseInt(process.env.MAX_POSITIONS           || '1'),
  maxRiskPercent       : parseFloat(process.env.MAX_RISK_PERCENT      || '2'),
  stopLossPips         : parseFloat(process.env.STOP_LOSS_PIPS        || '30'),
  takeProfitPips       : parseFloat(process.env.TAKE_PROFIT_PIPS      || '60'),
  trailingStopPips     : parseFloat(process.env.TRAILING_STOP_PIPS    || '15'),
  maxConsecutiveLosses : parseInt(process.env.MAX_CONSECUTIVE_LOSSES  || '3'),
  defaultLotSize       : parseFloat(process.env.DEFAULT_LOT_SIZE      || '0.01'),
  maxLotSize           : parseFloat(process.env.MAX_LOT_SIZE           || '0.10'),
  cooldownSeconds      : 30,
  minAccountUSD        : 100,
  maxHoldMinutes       : 240,
  targetProfitUSD      : 500,

  // ── Profit Modes ────────────────────────────────────────────────────────────
  maxProfitMode   : false,
  ultraProfitMode : false,
  ultraLightMode  : false,

  // ── Exit Features ────────────────────────────────────────────────────────────
  partialTpEnabled    : true,
  breakevenEnabled    : true,
  breakevenPlusPips   : 3,      // geser SL ke entry + N pips (0 = tepat breakeven)
  smartExitEnabled    : true,
  timeExitEnabled     : true,

  // ── Win Multiplier (Anti-Martingale) ─────────────────────────────────────────
  // Lot dinaikkan saat win streak — kebalikan martingale, lebih aman
  winMultiplierEnabled : false,
  winMultiplierFactor  : 1.25,  // +25% per win streak (mis. 0.01 → 0.0125 → 0.0156)
  winMultiplierMaxFactor: 2.0,  // maksimum 2× lot dasar

  // ── Compound Mode ────────────────────────────────────────────────────────────
  // Lot dihitung dari saldo saat ini (bukan start balance) → profit compounding
  compoundEnabled : false,

  // ── Double Confirmation ──────────────────────────────────────────────────────
  // Masuk posisi hanya jika sinyal yang sama muncul 2 siklus berturut-turut
  doubleConfirmEnabled : false,
};

export function getRiskSettings()               { return { ...runtimeSettings }; }
export function updateRiskSettings(newSettings) {
  runtimeSettings = { ...runtimeSettings, ...newSettings };
  return runtimeSettings;
}

export function getActiveProfitMode() {
  if (runtimeSettings.ultraProfitMode) return 'ultra_profit';
  if (runtimeSettings.ultraLightMode)  return 'ultra_light';
  if (runtimeSettings.maxProfitMode)   return 'max_profit';
  return 'normal';
}

/**
 * Hitung lot size berdasarkan risk management forex standard
 * Formula: Lot = (Balance × Risk%) / (SL in pips × Pip Value per Lot)
 *
 * Pip value per micro lot (0.01):
 *   Non-JPY: $0.10/pip | JPY pairs: ~$0.0932/pip
 */
export function calculateLotSize(balance, slPips, instrument = 'EUR_USD', botState = {}, signalGrade = 'C') {
  const { consecutiveLosses = 0, consecutiveWins = 0 } = botState;
  const s    = runtimeSettings;
  const mode = getActiveProfitMode();

  if (balance < s.minAccountUSD) return { lots: 0, reason: 'balance_tidak_cukup' };

  // ── Risk percent logic ─────────────────────────────────────────────────────
  let riskPercent = s.maxRiskPercent;

  // Kurangi risk saat loss streak
  if (consecutiveLosses >= 3)       riskPercent = 0.5;
  else if (consecutiveLosses === 2) riskPercent = 1.0;
  else if (consecutiveLosses === 1) riskPercent = 1.5;

  // Mode modifier
  if (mode === 'ultra_profit') riskPercent = Math.min(riskPercent * 1.5, 5.0);
  if (mode === 'ultra_light')  riskPercent = Math.min(riskPercent * 0.5, 1.0);

  // Signal grade modifier
  const gradeMultiplier = { 'A+': 1.0, 'A': 0.9, 'B': 0.8, 'C': 0.7, 'D': 0.5, 'F': 0 };
  const gradeMult       = gradeMultiplier[signalGrade] || 0.7;

  const riskAmount = balance * (riskPercent / 100) * gradeMult;

  // Pip value per micro lot
  const pipValuePerMicroLot = instrument.includes('JPY') ? 0.0932 : 0.10;

  const slRisk  = slPips * pipValuePerMicroLot;
  if (slRisk <= 0) return { lots: 0.01, reason: 'default_micro' };

  const microLots  = riskAmount / slRisk;
  let   lots       = Math.max(0.01, parseFloat((Math.floor(microLots * 100) / 100).toFixed(2)));
  const maxLots    = s.maxLotSize || (mode === 'ultra_profit' ? 1.0 : 0.10);

  // ── Win Multiplier (anti-martingale) ──────────────────────────────────────
  if (s.winMultiplierEnabled && consecutiveWins >= 2) {
    const streakMult = Math.pow(s.winMultiplierFactor, consecutiveWins - 1);
    const cappedMult = Math.min(streakMult, s.winMultiplierMaxFactor || 2.0);
    lots = parseFloat((lots * cappedMult).toFixed(2));
  } else if (consecutiveWins >= 3) {
    // Streak bonus konservatif bahkan tanpa multiplier aktif
    riskPercent = Math.min(riskPercent + 0.3, 5.0);
  }

  const finalLots = Math.min(lots, maxLots);

  return {
    lots        : finalLots,
    riskAmount  : parseFloat(riskAmount.toFixed(2)),
    riskPercent : parseFloat(riskPercent.toFixed(2)),
    reason      : `${mode}_grade${signalGrade}_wins${consecutiveWins}`,
    gradeMult,
    winMultApplied: s.winMultiplierEnabled && consecutiveWins >= 2,
  };
}

export function canOpenPosition(openCount, consecutiveLosses, isPaused) {
  const s = runtimeSettings;
  if (isPaused)                                  return { allowed: false, reason: 'bot_paused' };
  if (openCount >= s.maxPositions)               return { allowed: false, reason: 'max_positions' };
  if (consecutiveLosses >= s.maxConsecutiveLosses) return { allowed: false, reason: 'consecutive_losses' };
  return { allowed: true };
}

const PIP_MAP = {
  'EUR_USD':0.0001,'GBP_USD':0.0001,'AUD_USD':0.0001,'NZD_USD':0.0001,
  'USD_CAD':0.0001,'USD_CHF':0.0001,'EUR_GBP':0.0001,'EUR_AUD':0.0001,
  'GBP_AUD':0.0001,'GBP_NZD':0.0001,'EUR_CHF':0.0001,
  'EUR_JPY':0.01,'GBP_JPY':0.01,'USD_JPY':0.01,'AUD_JPY':0.01,'CHF_JPY':0.01,
  'XAU_USD':0.01,'XAG_USD':0.001,
};
function getPip(instrument) { return PIP_MAP[instrument] || 0.0001; }

export function getStopLossPrice(entryPrice, direction, slPips, instrument) {
  const pip     = getPip(instrument);
  const slPrice = slPips * pip;
  return direction === 'buy'
    ? parseFloat((entryPrice - slPrice).toFixed(5))
    : parseFloat((entryPrice + slPrice).toFixed(5));
}

export function getTakeProfitPrice(entryPrice, direction, tpPips, instrument) {
  const pip     = getPip(instrument);
  const tpPrice = tpPips * pip;
  return direction === 'buy'
    ? parseFloat((entryPrice + tpPrice).toFixed(5))
    : parseFloat((entryPrice - tpPrice).toFixed(5));
}

export function checkPositionExit(position, currentPrice) {
  const s   = runtimeSettings;
  const pip = getPip(position.instrument);
  const dir = position.direction || 'buy';
  const isBuy = dir === 'buy';

  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;

  const pnlUSD = pnlPips * (position.lots || 0.01) * (pip === 0.01 ? 9.30 : 10.0) * 0.01;

  // SL hit
  if (isBuy  && currentPrice <= position.stopLoss) return { shouldClose: true, reason: 'stop_loss',   pnlPips, pnlUSD };
  if (!isBuy && currentPrice >= position.stopLoss) return { shouldClose: true, reason: 'stop_loss',   pnlPips, pnlUSD };
  // TP hit
  if (isBuy  && currentPrice >= position.takeProfit) return { shouldClose: true, reason: 'take_profit', pnlPips, pnlUSD };
  if (!isBuy && currentPrice <= position.takeProfit) return { shouldClose: true, reason: 'take_profit', pnlPips, pnlUSD };

  // Partial TP (50% dari target)
  const partialLevel = isBuy
    ? position.entryPrice + (position.takeProfit - position.entryPrice) * 0.5
    : position.entryPrice - (position.entryPrice - position.takeProfit) * 0.5;
  if (!position.tp1Triggered) {
    if ((isBuy && currentPrice >= partialLevel) || (!isBuy && currentPrice <= partialLevel)) {
      return { shouldPartial: true, partialPct: 50, pnlPips, pnlUSD };
    }
  }

  // Breakeven (+ optional buffer pip)
  const breakevenLevel = isBuy
    ? position.entryPrice + (position.takeProfit - position.entryPrice) * 0.3
    : position.entryPrice - (position.entryPrice - position.takeProfit) * 0.3;
  if (!position.breakevenSet) {
    if ((isBuy && currentPrice >= breakevenLevel) || (!isBuy && currentPrice <= breakevenLevel)) {
      const bufferPips = s.breakevenPlusPips || 0;
      const newSL = isBuy
        ? position.entryPrice + pip * bufferPips
        : position.entryPrice - pip * bufferPips;
      return { shouldBreakeven: true, newStopLoss: parseFloat(newSL.toFixed(5)), pnlPips, pnlUSD };
    }
  }

  // Time-based exit
  if (s.timeExitEnabled && position.openTime) {
    const holdMs = Date.now() - position.openTime;
    if (holdMs > s.maxHoldMinutes * 60 * 1000) {
      return { shouldClose: true, reason: 'time_exit', pnlPips, pnlUSD };
    }
  }

  return { shouldClose: false, pnlPips, pnlUSD };
}

export function updateTrailingStop(position, currentPrice) {
  if (!position.trailingStop) return position;
  const s   = runtimeSettings;
  const pip = getPip(position.instrument);
  const dir = position.direction || 'buy';
  const isBuy     = dir === 'buy';
  const trailDist = (s.trailingStopPips || 15) * pip;

  if (isBuy) {
    const newTrail = currentPrice - trailDist;
    if (newTrail > position.stopLoss) return { ...position, stopLoss: parseFloat(newTrail.toFixed(5)) };
  } else {
    const newTrail = currentPrice + trailDist;
    if (newTrail < position.stopLoss) return { ...position, stopLoss: parseFloat(newTrail.toFixed(5)) };
  }
  return position;
}

export function checkSignalReversal(position, currentPrice, signal) {
  const dir    = position.direction || 'buy';
  const isBuy  = dir === 'buy';
  const pip    = getPip(position.instrument);
  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;
  const pnlUSD = pnlPips * (position.lots || 0.01) * 0.10;

  if (isBuy  && signal.action === 'SELL' && signal.score < 30 && pnlPips > 5)
    return { shouldExit: true, reason: 'smart_signal_exit', pnlPips, pnlUSD };
  if (!isBuy && signal.action === 'BUY'  && signal.score > 70 && pnlPips > 5)
    return { shouldExit: true, reason: 'smart_signal_exit', pnlPips, pnlUSD };
  return { shouldExit: false, pnlPips, pnlUSD };
}

// Pair blacklist
const blacklistedPairs = new Map();
export function isPairBlacklisted(pair) { const b = blacklistedPairs.get(pair); return b ? Date.now() < b.until : false; }
export function reportPairLoss(pair) {
  const rec = blacklistedPairs.get(pair) || { losses: 0 };
  rec.losses++;
  if (rec.losses >= 2) { rec.until = Date.now() + 60 * 60 * 1000; blacklistedPairs.set(pair, rec); return true; }
  blacklistedPairs.set(pair, rec);
  return false;
}
export function resetPairLoss(pair)   { blacklistedPairs.delete(pair); }
export function getBlacklistedPairs() { return [...blacklistedPairs.entries()].filter(([,v])=>Date.now()<v.until).map(([pair,v])=>({pair,remainingMs:v.until-Date.now(),reason:'pair_loss_streak'})); }

// Double confirmation state
let _lastSignalAction = null;
let _lastSignalCount  = 0;
export function checkDoubleConfirmation(action) {
  const s = runtimeSettings;
  if (!s.doubleConfirmEnabled) return true; // langsung allow
  if (action === 'HOLD') { _lastSignalAction = null; _lastSignalCount = 0; return false; }
  if (action === _lastSignalAction) {
    _lastSignalCount++;
    if (_lastSignalCount >= 2) return true; // confirmed!
    return false;
  }
  _lastSignalAction = action;
  _lastSignalCount  = 1;
  return false;
}
export function resetDoubleConfirmation() { _lastSignalAction = null; _lastSignalCount = 0; }

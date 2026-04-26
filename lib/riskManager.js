/**
 * lib/riskManager.js — Risk Management
 * MIFX Ultra Low Account:
 *  - Komisi $10 per lot per sisi (round-trip $20/lot)
 *  - Spread float 0.2-0.3 pips (EUR/USD)
 *  - Leverage 1:100
 *  - No hedging, no scalping
 *  - Min TP harus cover komisi + spread
 */

let runtimeSettings = {
  maxPositions          : parseInt(process.env.MAX_POSITIONS          || '1'),
  maxRiskPercent        : parseFloat(process.env.MAX_RISK_PERCENT     || '2'),
  stopLossPips          : parseFloat(process.env.STOP_LOSS_PIPS       || '30'),
  takeProfitPips        : parseFloat(process.env.TAKE_PROFIT_PIPS     || '60'),
  trailingStopPips      : parseFloat(process.env.TRAILING_STOP_PIPS   || '15'),
  maxConsecutiveLosses  : parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3'),
  defaultLotSize        : parseFloat(process.env.DEFAULT_LOT_SIZE     || '0.01'),
  maxLotSize            : parseFloat(process.env.MAX_LOT_SIZE         || '0.10'),
  cooldownSeconds       : 300,      // FIX BUG 4: 60→300s (1 candle 5m) — cegah overtrading
  minAccountUSD         : 10,
  maxHoldMinutes        : 480,      // max 8 jam hold
  targetProfitUSD       : 500,
  maxProfitMode         : false,
  ultraProfitMode       : false,
  ultraLightMode        : false,
  partialTpEnabled      : true,
  breakevenEnabled      : true,
  breakevenPlusPips     : 5,        // breakeven setelah profit 5 pips (cover spread+komisi)
  smartExitEnabled      : true,
  timeExitEnabled       : true,
  winMultiplierEnabled  : false,
  winMultiplierFactor   : 1.25,
  winMultiplierMaxFactor: 2.0,
  compoundEnabled       : false,
  doubleConfirmEnabled  : false,

  // MIFX Ultra Low spesifik
  commissionPerLot      : 10,       // $10 per lot per sisi
  brokerType            : 'mifx_ultra_low',
  minTpPips             : 15,       // minimum TP 15 pips (cover komisi + spread + buffer)
  minSlPips             : 10,       // minimum SL 10 pips
};

export function getRiskSettings()               { return { ...runtimeSettings }; }
export function updateRiskSettings(newSettings) { runtimeSettings = { ...runtimeSettings, ...newSettings }; return runtimeSettings; }
export function getActiveProfitMode() {
  if (runtimeSettings.ultraProfitMode) return 'ultra_profit';
  if (runtimeSettings.ultraLightMode)  return 'ultra_light';
  if (runtimeSettings.maxProfitMode)   return 'max_profit';
  return 'normal';
}

// Pip map — konsisten dengan PIP_VALUES di monex.js
const PIP_MAP = {
  'EUR_USD':0.0001,'GBP_USD':0.0001,'AUD_USD':0.0001,'NZD_USD':0.0001,
  'USD_CAD':0.0001,'USD_CHF':0.0001,'EUR_GBP':0.0001,'EUR_AUD':0.0001,
  'GBP_AUD':0.0001,'GBP_NZD':0.0001,'EUR_CHF':0.0001,
  'EUR_JPY':0.01,  'GBP_JPY':0.01,  'USD_JPY':0.01,  'AUD_JPY':0.01,  'CHF_JPY':0.01,
  'XAU_USD':0.01,  // Gold: 1 pip = $0.01 (bukan 0.10)
  'XAG_USD':0.001, // Silver: 1 pip = $0.001
};
function getPip(instrument) { return PIP_MAP[instrument] || 0.0001; }

// Pip value per standard lot (1.0 lot)
// XAU: 100 oz × $0.01/pip = $1/pip/lot → micro (0.01) = $0.01/pip
// XAG: 5000 oz × $0.001/pip = $5/pip/lot → micro = $0.05/pip
// JPY: $9.30/pip/lot → micro = $0.093/pip
// Other: $10/pip/lot → micro = $0.10/pip
function getPipValuePerLot(instrument) {
  if (instrument.includes('JPY')) return 9.30;
  if (instrument === 'XAU_USD')   return 1.0;   // $1/pip/lot (bukan $100)
  if (instrument === 'XAG_USD')   return 5.0;   // $5/pip/lot
  return 10.0;
}

/**
 * Hitung total biaya trading MIFX untuk 1 round-trip (entry + exit)
 * Komisi: $10/lot × 2 sisi = $20/lot round-trip
 * Spread cost estimasi: spread_pips × pip_value × lots
 */
export function calculateTradingCost(lots, instrument, spreadPips = 0.5) {
  const commissionRoundTrip = runtimeSettings.commissionPerLot * 2 * lots;
  const spreadCost = spreadPips * getPipValuePerLot(instrument) * lots;
  const totalCost  = commissionRoundTrip + spreadCost;
  // Konversi total cost ke pips agar bisa dibandingkan dengan TP/SL
  const costInPips = totalCost / (getPipValuePerLot(instrument) * lots);
  return { commissionRoundTrip, spreadCost, totalCost, costInPips };
}

/**
 * Hitung lot size berdasarkan risk management MIFX
 * Sudah memperhitungkan komisi dalam kalkulasi risk
 */
export function calculateLotSize(balance, slPips, instrument='EUR_USD', botState={}, signalGrade='C') {
  const { consecutiveLosses=0, consecutiveWins=0 } = botState;
  const s    = runtimeSettings;
  const mode = getActiveProfitMode();

  if (balance < s.minAccountUSD) return { lots:0, reason:'balance_tidak_cukup' };

  let riskPercent = s.maxRiskPercent;
  if (consecutiveLosses >= 3)       riskPercent = 0.5;
  else if (consecutiveLosses === 2) riskPercent = 1.0;
  else if (consecutiveLosses === 1) riskPercent = 1.5;

  if (mode === 'ultra_profit') riskPercent = Math.min(riskPercent * 1.5, 5.0);
  if (mode === 'ultra_light')  riskPercent = Math.min(riskPercent * 0.5, 1.0);

  const gradeMultiplier = { 'A+':1.0,'A':0.9,'B':0.8,'C':0.7,'D':0.5,'F':0 };
  const gradeMult       = gradeMultiplier[signalGrade] || 0.7;
  const riskAmount      = balance * (riskPercent / 100) * gradeMult;

  const pipValuePerLot = getPipValuePerLot(instrument);
  const slRisk         = slPips * pipValuePerLot;
  if (slRisk <= 0) return { lots:0.01, reason:'default_micro' };

  let lotsNeeded = riskAmount / slRisk;
  let lots = Math.max(0.01, parseFloat((Math.floor(lotsNeeded * 100) / 100).toFixed(2)));

  const maxLots = s.maxLotSize || 0.10;

  if (s.winMultiplierEnabled && consecutiveWins >= 2) {
    const streakMult = Math.pow(s.winMultiplierFactor, consecutiveWins - 1);
    lots = Math.min(lots * Math.min(streakMult, s.winMultiplierMaxFactor), maxLots);
    lots = parseFloat(lots.toFixed(2));
  }

  lots = Math.min(lots, maxLots);

  // Cek apakah komisi tidak makan terlalu besar dari risk
  // Komisi round-trip = $20 × lots, jangan lebih dari 30% dari riskAmount
  const commissionCost = s.commissionPerLot * 2 * lots;
  if (commissionCost > riskAmount * 0.3 && lots > 0.01) {
    lots = 0.01; // turunkan ke minimum jika komisi terlalu besar
  }

  const riskAmountActual = slRisk * lots;
  return {
    lots,
    riskAmount: parseFloat(riskAmountActual.toFixed(2)),
    riskPercent: parseFloat(((riskAmountActual / balance) * 100).toFixed(2)),
    commissionEstimate: parseFloat((s.commissionPerLot * 2 * lots).toFixed(2)),
  };
}

export function canOpenPosition(openCount, consecutiveLosses, isPaused) {
  const s = runtimeSettings;
  if (isPaused)                          return { allowed:false, reason:'bot_paused' };
  if (openCount >= s.maxPositions)       return { allowed:false, reason:'max_positions' };
  if (consecutiveLosses >= s.maxConsecutiveLosses) return { allowed:false, reason:'consecutive_losses' };
  return { allowed:true };
}

export function checkPositionExit(position, currentPrice) {
  const isBuy = position.direction === 'buy';
  const pip   = getPip(position.instrument);
  const s     = runtimeSettings;

  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;

  const pipVal = getPipValuePerLot(position.instrument);
  const pnlUSD = parseFloat((pnlPips * pipVal * (position.lots || 0.01)).toFixed(2));

  // SL check
  if (isBuy  && currentPrice <= position.stopLoss) return { shouldClose:true, reason:'stop_loss', pnlPips, pnlUSD };
  if (!isBuy && currentPrice >= position.stopLoss) return { shouldClose:true, reason:'stop_loss', pnlPips, pnlUSD };

  // TP check
  if (position.takeProfit) {
    if (isBuy  && currentPrice >= position.takeProfit) return { shouldClose:true, reason:'take_profit', pnlPips, pnlUSD };
    if (!isBuy && currentPrice <= position.takeProfit) return { shouldClose:true, reason:'take_profit', pnlPips, pnlUSD };
  }

  // FIX BUG 2: Urutan diperbaiki — Partial TP → Breakeven → Time Exit
  // Sebelumnya time exit diperiksa lebih dulu sehingga partial TP tidak sempat jalan

  // Partial TP — 50% di 40% jalan ke TP
  if (!position.tp1Triggered && position.takeProfit) {
    const tpDistance = Math.abs(position.takeProfit - position.entryPrice);
    const progress   = Math.abs(currentPrice - position.entryPrice) / tpDistance;
    if (progress >= 0.40 && pnlPips >= s.minTpPips) {
      return { shouldPartial:true, pnlPips, pnlUSD };
    }
  }

  // Breakeven — setelah profit >= breakevenPlusPips
  if (!position.breakevenSet && pnlPips >= s.breakevenPlusPips) {
    const newSL = isBuy
      ? position.entryPrice + pip * 2
      : position.entryPrice - pip * 2;
    return { shouldBreakeven:true, newStopLoss:newSL, pnlPips, pnlUSD };
  }

  // Time exit — max hold (diperiksa terakhir agar partial TP sempat jalan)
  if (s.timeExitEnabled && position.openTime) {
    const holdMin = (Date.now() - position.openTime) / 60000;
    if (holdMin >= s.maxHoldMinutes) return { shouldClose:true, reason:'time_exit', pnlPips, pnlUSD };
  }

  return { shouldClose:false, pnlPips, pnlUSD };
}

export function updateTrailingStop(position, currentPrice) {
  const s     = runtimeSettings;
  const pip   = getPip(position.instrument);
  const isBuy = position.direction === 'buy';
  const trail = pip * (s.trailingStopPips || 15);

  if (isBuy) {
    // FIX BUG 1: Trailing stop hanya aktif setelah harga profit minimal 1x trail dari entry
    // Mencegah SL diperketat sebelum harga bergerak menguntungkan
    const minProfitToActivate = position.entryPrice + trail;
    if (currentPrice < minProfitToActivate) return position;

    const newSL = currentPrice - trail;
    // Ratchet murni: SL hanya bergerak ke atas, tidak pernah ke bawah
    if (newSL > position.stopLoss) {
      return { ...position, trailingStop: newSL, stopLoss: newSL };
    }
  } else {
    // FIX BUG 1: SELL — aktif hanya setelah harga turun minimal 1x trail dari entry
    const minProfitToActivate = position.entryPrice - trail;
    if (currentPrice > minProfitToActivate) return position;

    const newSL = currentPrice + trail;
    // Ratchet murni: SL hanya bergerak ke bawah, tidak pernah ke atas
    if (newSL < position.stopLoss) {
      return { ...position, trailingStop: newSL, stopLoss: newSL };
    }
  }
  return position;
}

export function checkSignalReversal(position, currentPrice, signal) {
  const isBuy   = position.direction === 'buy';
  const pip     = getPip(position.instrument);
  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;
  const pnlUSD = parseFloat((pnlPips * getPipValuePerLot(position.instrument) * (position.lots || 0.01)).toFixed(2));

  // Smart exit: posisi minimal 15 menit, profit minimal 10 pips
  const ageMinutes = position.openTime ? (Date.now() - position.openTime) / 60000 : 0;
  if (ageMinutes < 15) return { shouldExit:false, pnlPips, pnlUSD };

  if (isBuy  && signal.action === 'SELL' && signal.score < 25 && pnlPips > 10)
    return { shouldExit:true, reason:'smart_signal_exit', pnlPips, pnlUSD };
  if (!isBuy && signal.action === 'BUY'  && signal.score > 75 && pnlPips > 10)
    return { shouldExit:true, reason:'smart_signal_exit', pnlPips, pnlUSD };
  return { shouldExit:false, pnlPips, pnlUSD };
}

// Double confirmation
let _lastAction = null;
let _confirmCount = 0;
export function checkDoubleConfirmation(action) {
  if (!runtimeSettings.doubleConfirmEnabled) return true;
  if (action === 'HOLD') { _lastAction = null; _confirmCount = 0; return false; }
  if (action === _lastAction) { _confirmCount++; return _confirmCount >= 2; }
  _lastAction = action; _confirmCount = 1; return false;
}
export function resetDoubleConfirmation() { _lastAction = null; _confirmCount = 0; }

// Pair blacklist
const blacklistedPairs = new Map();
export function isPairBlacklisted(pair)   { const b = blacklistedPairs.get(pair); return b ? Date.now() < b.until : false; }
export function reportPairLoss(pair)      {
  const b = blacklistedPairs.get(pair) || { losses:0 };
  b.losses++;
  if (b.losses >= 2) { b.until = Date.now() + 60 * 60 * 1000; blacklistedPairs.set(pair, b); return true; }
  blacklistedPairs.set(pair, b); return false;
}
export function resetPairLoss(pair)       { blacklistedPairs.delete(pair); }
export function getBlacklistedPairs()     { return [...blacklistedPairs.entries()].filter(([,v]) => Date.now() < (v.until||0)).map(([k]) => k); }

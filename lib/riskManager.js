/**
 * lib/riskManager.js — Risk Management
 * MIFX Ultra Low Account:
 *  - Komisi $10 per lot per sisi (round-trip $20/lot)
 *  - Spread float 0.2-0.3 pips (EUR/USD)
 *  - Leverage 1:100
 *  - No hedging, no scalping
 *  - Min TP harus cover komisi + spread
 *
 * FIX v2:
 *  - Settings persisten ke /tmp/riskSettings.json (tidak hilang saat restart)
 *  - Balance < $312 → paksa 0.01 lot (akun kecil)
 *  - Balance ≥ $312 → pakai maxLotSize dari user (slider aktif)
 *  - Hapus filter komisi yang terlalu ketat (biang lot selalu 0.01)
 */

import fs from 'fs';

const SETTINGS_FILE = '/tmp/riskSettings.json';

// ── Default settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  maxPositions          : parseInt(process.env.MAX_POSITIONS          || '1'),
  maxRiskPercent        : parseFloat(process.env.MAX_RISK_PERCENT     || '2'),
  stopLossPips          : parseFloat(process.env.STOP_LOSS_PIPS       || '30'),
  takeProfitPips        : parseFloat(process.env.TAKE_PROFIT_PIPS     || '60'),
  trailingStopPips      : parseFloat(process.env.TRAILING_STOP_PIPS   || '15'),
  maxConsecutiveLosses  : parseInt(process.env.MAX_CONSECUTIVE_LOSSES || '3'),
  defaultLotSize        : 0.01,
  maxLotSize            : parseFloat(process.env.MAX_LOT_SIZE         || '0.10'),
  cooldownSeconds       : 300,
  minAccountUSD         : 10,

  // Batas balance untuk unlock lot size manual
  // Balance < LOT_UNLOCK_BALANCE → paksa 0.01 lot
  // Balance ≥ LOT_UNLOCK_BALANCE → pakai maxLotSize pilihan user
  lotUnlockBalance      : 312,

  maxHoldMinutes        : 480,
  targetProfitUSD       : 500,
  maxProfitMode         : false,
  ultraProfitMode       : false,
  ultraLightMode        : false,
  partialTpEnabled      : true,
  breakevenEnabled      : true,
  breakevenPlusPips     : 5,
  smartExitEnabled      : true,
  timeExitEnabled       : true,
  winMultiplierEnabled  : false,
  winMultiplierFactor   : 1.25,
  winMultiplierMaxFactor: 2.0,
  compoundEnabled       : false,
  doubleConfirmEnabled  : false,

  // MIFX Ultra Low spesifik
  commissionPerLot      : 10,
  brokerType            : 'mifx_ultra_low',
  minTpPips             : 15,
  minSlPips             : 10,
};

// ── Load settings dari file (persisten) ──────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw  = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      // Merge dengan default — agar key baru tidak hilang
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch (err) {
    console.warn('[RISK] Gagal load settings, pakai default:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

// ── Simpan settings ke file ───────────────────────────────────────────────────
function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(runtimeSettings, null, 2), 'utf8');
  } catch (err) {
    console.warn('[RISK] Gagal simpan settings:', err.message);
  }
}

// ── Runtime settings (load dari file saat startup) ────────────────────────────
let runtimeSettings = loadSettings();

export function getRiskSettings() {
  return { ...runtimeSettings };
}

export function updateRiskSettings(newSettings) {
  runtimeSettings = { ...runtimeSettings, ...newSettings };
  saveSettings(); // ← simpan ke file setiap ada perubahan
  return runtimeSettings;
}

export function getActiveProfitMode() {
  if (runtimeSettings.ultraProfitMode) return 'ultra_profit';
  if (runtimeSettings.ultraLightMode)  return 'ultra_light';
  if (runtimeSettings.maxProfitMode)   return 'max_profit';
  return 'normal';
}

/**
 * Cek apakah balance sudah cukup untuk unlock lot size manual
 * Balance < $312 → locked (paksa 0.01)
 * Balance ≥ $312 → unlocked (pakai maxLotSize pilihan user)
 */
export function isLotSizeUnlocked(balance) {
  const threshold = runtimeSettings.lotUnlockBalance || 312;
  return balance >= threshold;
}

// Pip map
const PIP_MAP = {
  'EUR_USD':0.0001,'GBP_USD':0.0001,'AUD_USD':0.0001,'NZD_USD':0.0001,
  'USD_CAD':0.0001,'USD_CHF':0.0001,'EUR_GBP':0.0001,'EUR_AUD':0.0001,
  'GBP_AUD':0.0001,'GBP_NZD':0.0001,'EUR_CHF':0.0001,
  'EUR_JPY':0.01,  'GBP_JPY':0.01,  'USD_JPY':0.01,  'AUD_JPY':0.01,  'CHF_JPY':0.01,
  'XAU_USD':0.01,
  'XAG_USD':0.001,
};
function getPip(instrument) { return PIP_MAP[instrument] || 0.0001; }

function getPipValuePerLot(instrument) {
  if (instrument.includes('JPY')) return 9.30;
  if (instrument === 'XAU_USD')   return 1.0;
  if (instrument === 'XAG_USD')   return 5.0;
  return 10.0;
}

export function calculateTradingCost(lots, instrument, spreadPips = 0.5) {
  const commissionRoundTrip = runtimeSettings.commissionPerLot * 2 * lots;
  const spreadCost = spreadPips * getPipValuePerLot(instrument) * lots;
  const totalCost  = commissionRoundTrip + spreadCost;
  const costInPips = totalCost / (getPipValuePerLot(instrument) * lots);
  return { commissionRoundTrip, spreadCost, totalCost, costInPips };
}

/**
 * Hitung lot size
 *
 * ATURAN BARU:
 *  - Balance < $312 (lotUnlockBalance) → PAKSA 0.01 lot (akun kecil, locked)
 *  - Balance ≥ $312 → hitung berdasarkan risk%, tapi capped di maxLotSize pilihan user
 */
export function calculateLotSize(balance, slPips, instrument='EUR_USD', botState={}, signalGrade='C') {
  const { consecutiveLosses=0, consecutiveWins=0, startBalance=balance } = botState;
  const s    = runtimeSettings;
  const mode = getActiveProfitMode();

  if (balance < s.minAccountUSD) return { lots: 0, reason: 'balance_tidak_cukup' };

  // ── AKUN KECIL: balance < lotUnlockBalance → paksa 0.01 lot ─────────────────
  const unlockThreshold = s.lotUnlockBalance || 312;
  if (balance < unlockThreshold) {
    return {
      lots              : 0.01,
      riskAmount        : parseFloat((slPips * getPipValuePerLot(instrument) * 0.01).toFixed(2)),
      riskPercent       : parseFloat(((slPips * getPipValuePerLot(instrument) * 0.01 / balance) * 100).toFixed(2)),
      commissionEstimate: parseFloat((s.commissionPerLot * 2 * 0.01).toFixed(2)),
      reason            : 'akun_kecil_locked_001',
      locked            : true,
    };
  }

  // ── AKUN CUKUP: hitung lot berdasarkan risk% ─────────────────────────────────
  let riskPercent = s.maxRiskPercent;

  // Kurangi risk saat consecutive losses
  if (consecutiveLosses >= 3)       riskPercent = 0.5;
  else if (consecutiveLosses === 2) riskPercent = 1.0;
  else if (consecutiveLosses === 1) riskPercent = 1.5;

  // Mode multiplier
  if (mode === 'ultra_profit') riskPercent = Math.min(riskPercent * 1.5, 5.0);
  if (mode === 'ultra_light')  riskPercent = Math.min(riskPercent * 0.5, 1.0);
  if (mode === 'max_profit')   riskPercent = Math.min(riskPercent * 1.2, 3.0);

  // Compound mode
  const effectiveBalance = s.compoundEnabled
    ? balance
    : Math.min(balance, startBalance);

  // Signal grade multiplier
  const gradeMultiplier = { 'A+':1.0, 'A':0.9, 'B':0.8, 'C':0.7, 'D':0.5, 'F':0 };
  const gradeMult       = gradeMultiplier[signalGrade] || 0.7;
  const riskAmount      = effectiveBalance * (riskPercent / 100) * gradeMult;

  const pipValuePerLot = getPipValuePerLot(instrument);
  const slRisk         = slPips * pipValuePerLot;
  if (slRisk <= 0) return { lots: 0.01, reason: 'default_micro' };

  // Hitung lot
  let lotsNeeded = riskAmount / slRisk;
  let lots = Math.max(0.01, parseFloat((Math.floor(lotsNeeded * 100) / 100).toFixed(2)));

  // Cap di maxLotSize pilihan user (SLIDER BERPENGARUH DI SINI)
  const maxLots = s.maxLotSize || 0.10;
  lots = Math.min(lots, maxLots);

  // Win multiplier (anti-martingale)
  if (s.winMultiplierEnabled && consecutiveWins >= 2) {
    const streakMult = Math.pow(s.winMultiplierFactor, consecutiveWins - 1);
    lots = Math.min(
      parseFloat((lots * Math.min(streakMult, s.winMultiplierMaxFactor)).toFixed(2)),
      maxLots
    );
  }

  // Pastikan minimal 0.01
  lots = Math.max(0.01, lots);

  const riskAmountActual = slRisk * lots;
  return {
    lots,
    riskAmount        : parseFloat(riskAmountActual.toFixed(2)),
    riskPercent       : parseFloat(((riskAmountActual / balance) * 100).toFixed(2)),
    commissionEstimate: parseFloat((s.commissionPerLot * 2 * lots).toFixed(2)),
    locked            : false,
  };
}

export function canOpenPosition(openCount, consecutiveLosses, isPaused) {
  const s = runtimeSettings;
  if (isPaused)                                    return { allowed: false, reason: 'bot_paused' };
  if (openCount >= s.maxPositions)                 return { allowed: false, reason: 'max_positions' };
  if (consecutiveLosses >= s.maxConsecutiveLosses) return { allowed: false, reason: 'consecutive_losses' };
  return { allowed: true };
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

  if (isBuy  && currentPrice <= position.stopLoss) return { shouldClose: true, reason: 'stop_loss', pnlPips, pnlUSD };
  if (!isBuy && currentPrice >= position.stopLoss) return { shouldClose: true, reason: 'stop_loss', pnlPips, pnlUSD };

  if (position.takeProfit) {
    if (isBuy  && currentPrice >= position.takeProfit) return { shouldClose: true, reason: 'take_profit', pnlPips, pnlUSD };
    if (!isBuy && currentPrice <= position.takeProfit) return { shouldClose: true, reason: 'take_profit', pnlPips, pnlUSD };
  }

  if (!position.tp1Triggered && position.takeProfit) {
    const tpDistance = Math.abs(position.takeProfit - position.entryPrice);
    const progress   = Math.abs(currentPrice - position.entryPrice) / tpDistance;
    if (progress >= 0.40 && pnlPips >= s.minTpPips) {
      return { shouldPartial: true, pnlPips, pnlUSD };
    }
  }

  if (!position.breakevenSet && pnlPips >= s.breakevenPlusPips) {
    const newSL = isBuy
      ? position.entryPrice + pip * 2
      : position.entryPrice - pip * 2;
    return { shouldBreakeven: true, newStopLoss: newSL, pnlPips, pnlUSD };
  }

  if (s.timeExitEnabled && position.openTime) {
    const holdMin = (Date.now() - position.openTime) / 60000;
    if (holdMin >= s.maxHoldMinutes) return { shouldClose: true, reason: 'time_exit', pnlPips, pnlUSD };
  }

  return { shouldClose: false, pnlPips, pnlUSD };
}

export function updateTrailingStop(position, currentPrice) {
  const s     = runtimeSettings;
  const pip   = getPip(position.instrument);
  const isBuy = position.direction === 'buy';
  const trail = pip * (s.trailingStopPips || 15);

  if (isBuy) {
    const minProfitToActivate = position.entryPrice + trail;
    if (currentPrice < minProfitToActivate) return position;
    const newSL = currentPrice - trail;
    if (newSL > position.stopLoss) return { ...position, trailingStop: newSL, stopLoss: newSL };
  } else {
    const minProfitToActivate = position.entryPrice - trail;
    if (currentPrice > minProfitToActivate) return position;
    const newSL = currentPrice + trail;
    if (newSL < position.stopLoss) return { ...position, trailingStop: newSL, stopLoss: newSL };
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

  const ageMinutes = position.openTime ? (Date.now() - position.openTime) / 60000 : 0;
  if (ageMinutes < 15) return { shouldExit: false, pnlPips, pnlUSD };

  if (isBuy  && signal.action === 'SELL' && signal.score < 25 && pnlPips > 10)
    return { shouldExit: true, reason: 'smart_signal_exit', pnlPips, pnlUSD };
  if (!isBuy && signal.action === 'BUY'  && signal.score > 75 && pnlPips > 10)
    return { shouldExit: true, reason: 'smart_signal_exit', pnlPips, pnlUSD };

  return { shouldExit: false, pnlPips, pnlUSD };
}

let _lastAction   = null;
let _confirmCount = 0;
export function checkDoubleConfirmation(action) {
  if (!runtimeSettings.doubleConfirmEnabled) return true;
  if (action === 'HOLD') { _lastAction = null; _confirmCount = 0; return false; }
  if (action === _lastAction) { _confirmCount++; return _confirmCount >= 2; }
  _lastAction = action; _confirmCount = 1; return false;
}
export function resetDoubleConfirmation() { _lastAction = null; _confirmCount = 0; }

const blacklistedPairs = new Map();
export function isPairBlacklisted(pair)  { const b = blacklistedPairs.get(pair); return b ? Date.now() < b.until : false; }
export function reportPairLoss(pair)     {
  const b = blacklistedPairs.get(pair) || { losses: 0 };
  b.losses++;
  if (b.losses >= 2) { b.until = Date.now() + 60 * 60 * 1000; blacklistedPairs.set(pair, b); return true; }
  blacklistedPairs.set(pair, b); return false;
}
export function resetPairLoss(pair)      { blacklistedPairs.delete(pair); }
export function getBlacklistedPairs()    { return [...blacklistedPairs.entries()].filter(([,v]) => Date.now() < (v.until||0)).map(([k]) => k); }

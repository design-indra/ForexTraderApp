/**
 * lib/riskManager.js — Risk Management
 * Fix: calculateLotSize unit conversion (micro → standard lot)
 *      checkPositionExit pnlUSD formula (hapus * 0.01)
 *      getPip sesuai dengan monex.js PIP_VALUES
 */

let runtimeSettings = {
  maxPositions          : parseInt(process.env.MAX_POSITIONS          ||'1'),
  maxRiskPercent        : parseFloat(process.env.MAX_RISK_PERCENT     ||'2'),
  stopLossPips          : parseFloat(process.env.STOP_LOSS_PIPS       ||'30'),
  takeProfitPips        : parseFloat(process.env.TAKE_PROFIT_PIPS     ||'60'),
  trailingStopPips      : parseFloat(process.env.TRAILING_STOP_PIPS   ||'15'),
  maxConsecutiveLosses  : parseInt(process.env.MAX_CONSECUTIVE_LOSSES ||'3'),
  defaultLotSize        : parseFloat(process.env.DEFAULT_LOT_SIZE     ||'0.01'),
  maxLotSize            : parseFloat(process.env.MAX_LOT_SIZE         ||'0.10'),
  cooldownSeconds       : 30,
  minAccountUSD         : 10,
  maxHoldMinutes        : 240,
  targetProfitUSD       : 500,
  maxProfitMode         : false,
  ultraProfitMode       : false,
  ultraLightMode        : false,
  partialTpEnabled      : true,
  breakevenEnabled      : true,
  breakevenPlusPips     : 3,
  smartExitEnabled      : true,
  timeExitEnabled       : true,
  winMultiplierEnabled  : false,
  winMultiplierFactor   : 1.25,
  winMultiplierMaxFactor: 2.0,
  compoundEnabled       : false,
  doubleConfirmEnabled  : false,
};

export function getRiskSettings()               { return { ...runtimeSettings }; }
export function updateRiskSettings(newSettings) { runtimeSettings={ ...runtimeSettings,...newSettings }; return runtimeSettings; }
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
  'XAU_USD':0.10,  'XAG_USD':0.01,
};
function getPip(instrument) { return PIP_MAP[instrument] || 0.0001; }

// Pip value per standard lot — untuk kalkulasi lot size dan PnL
function getPipValuePerLot(instrument) {
  if (instrument.includes('JPY')) return 9.30;
  if (instrument === 'XAU_USD')   return 100.0;
  if (instrument === 'XAG_USD')   return 50.0;
  return 10.0;
}

/**
 * Hitung lot size berdasarkan risk management forex standard
 * Fix: unit lot sekarang benar (standard lots, bukan micro lots)
 * Formula: Lots = (Balance × Risk%) / (SL_pips × PipValuePerLot)
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

  // FIXED: gunakan standard lot pip value, bukan micro lot
  const pipValuePerLot = getPipValuePerLot(instrument);
  const slRisk         = slPips * pipValuePerLot;
  if (slRisk <= 0) return { lots:0.01, reason:'default_micro' };

  // lotsNeeded = standard lots
  let lotsNeeded = riskAmount / slRisk;
  // Round down ke 2 desimal (standard lot precision)
  let lots = Math.max(0.01, parseFloat((Math.floor(lotsNeeded * 100) / 100).toFixed(2)));

  const maxLots = s.maxLotSize || (mode==='ultra_profit' ? 1.0 : 0.10);

  if (s.winMultiplierEnabled && consecutiveWins >= 2) {
    const streakMult = Math.pow(s.winMultiplierFactor, consecutiveWins-1);
    const cappedMult = Math.min(streakMult, s.winMultiplierMaxFactor||2.0);
    lots = parseFloat((lots * cappedMult).toFixed(2));
  }

  const finalLots = Math.min(lots, maxLots);
  return {
    lots:finalLots, riskAmount:parseFloat(riskAmount.toFixed(2)),
    riskPercent:parseFloat(riskPercent.toFixed(2)),
    reason:`${mode}_grade${signalGrade}_wins${consecutiveWins}`,
    gradeMult, winMultApplied:s.winMultiplierEnabled && consecutiveWins>=2,
  };
}

export function canOpenPosition(openCount, consecutiveLosses, isPaused) {
  const s = runtimeSettings;
  if (isPaused)                                      return { allowed:false, reason:'bot_paused' };
  if (openCount >= s.maxPositions)                   return { allowed:false, reason:'max_positions' };
  if (consecutiveLosses >= s.maxConsecutiveLosses)   return { allowed:false, reason:'consecutive_losses' };
  return { allowed:true };
}

export function getStopLossPrice(entry, dir, slPips, instrument) {
  const p = getPip(instrument) * slPips;
  return dir==='buy' ? parseFloat((entry-p).toFixed(5)) : parseFloat((entry+p).toFixed(5));
}

export function getTakeProfitPrice(entry, dir, tpPips, instrument) {
  const p = getPip(instrument) * tpPips;
  return dir==='buy' ? parseFloat((entry+p).toFixed(5)) : parseFloat((entry-p).toFixed(5));
}

export function checkPositionExit(position, currentPrice) {
  const s     = runtimeSettings;
  const pip   = getPip(position.instrument);
  const isBuy = position.direction === 'buy';

  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;

  // FIXED: hapus * 0.01
  const pnlUSD = parseFloat((pnlPips * getPipValuePerLot(position.instrument) * (position.lots||0.01)).toFixed(2));

  if (isBuy  && currentPrice <= position.stopLoss)   return { shouldClose:true, reason:'stop_loss',   pnlPips, pnlUSD };
  if (!isBuy && currentPrice >= position.stopLoss)   return { shouldClose:true, reason:'stop_loss',   pnlPips, pnlUSD };
  if (isBuy  && currentPrice >= position.takeProfit) return { shouldClose:true, reason:'take_profit', pnlPips, pnlUSD };
  if (!isBuy && currentPrice <= position.takeProfit) return { shouldClose:true, reason:'take_profit', pnlPips, pnlUSD };

  // Partial TP di 50%
  if (!position.tp1Triggered) {
    const partialLevel = isBuy
      ? position.entryPrice + (position.takeProfit - position.entryPrice) * 0.5
      : position.entryPrice - (position.entryPrice - position.takeProfit) * 0.5;
    if ((isBuy && currentPrice >= partialLevel) || (!isBuy && currentPrice <= partialLevel)) {
      return { shouldPartial:true, partialPct:50, pnlPips, pnlUSD };
    }
  }

  // Breakeven+ di 30% menuju TP
  if (!position.breakevenSet) {
    const bePlevel = isBuy
      ? position.entryPrice + (position.takeProfit - position.entryPrice) * 0.3
      : position.entryPrice - (position.entryPrice - position.takeProfit) * 0.3;
    if ((isBuy && currentPrice >= bePlevel) || (!isBuy && currentPrice <= bePlevel)) {
      const bufPips = s.breakevenPlusPips || 0;
      const newSL   = isBuy
        ? position.entryPrice + pip * bufPips
        : position.entryPrice - pip * bufPips;
      return { shouldBreakeven:true, newStopLoss:parseFloat(newSL.toFixed(5)), pnlPips, pnlUSD };
    }
  }

  // Time exit
  if (s.timeExitEnabled && position.openTime) {
    if (Date.now() - position.openTime > s.maxHoldMinutes * 60000) {
      return { shouldClose:true, reason:'time_exit', pnlPips, pnlUSD };
    }
  }

  return { shouldClose:false, pnlPips, pnlUSD };
}

export function updateTrailingStop(position, currentPrice) {
  if (!position.trailingStop) return position;
  const s   = runtimeSettings;
  const pip = getPip(position.instrument);
  const isBuy     = position.direction==='buy';
  const trailDist = (s.trailingStopPips||15) * pip;
  if (isBuy) {
    const newTrail = currentPrice - trailDist;
    if (newTrail > position.stopLoss) return { ...position, stopLoss:parseFloat(newTrail.toFixed(5)) };
  } else {
    const newTrail = currentPrice + trailDist;
    if (newTrail < position.stopLoss) return { ...position, stopLoss:parseFloat(newTrail.toFixed(5)) };
  }
  return position;
}

export function checkSignalReversal(position, currentPrice, signal) {
  const isBuy   = position.direction==='buy';
  const pip     = getPip(position.instrument);
  const pnlPips = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;
  const pnlUSD  = parseFloat((pnlPips * getPipValuePerLot(position.instrument) * (position.lots||0.01)).toFixed(2));

  if (isBuy  && signal.action==='SELL' && signal.score < 30 && pnlPips > 5)
    return { shouldExit:true, reason:'smart_signal_exit', pnlPips, pnlUSD };
  if (!isBuy && signal.action==='BUY'  && signal.score > 70 && pnlPips > 5)
    return { shouldExit:true, reason:'smart_signal_exit', pnlPips, pnlUSD };
  return { shouldExit:false, pnlPips, pnlUSD };
}

const blacklistedPairs = new Map();
export function isPairBlacklisted(pair)   { const b=blacklistedPairs.get(pair); return b ? Date.now()<b.until : false; }
export function reportPairLoss(pair) {
  const rec = blacklistedPairs.get(pair)||{ losses:0 };
  rec.losses++;
  if (rec.losses>=2) { rec.until=Date.now()+3600000; blacklistedPairs.set(pair,rec); return true; }
  blacklistedPairs.set(pair,rec);
  return false;
}
export function resetPairLoss(pair)    { blacklistedPairs.delete(pair); }
export function getBlacklistedPairs()  { return [...blacklistedPairs.entries()].filter(([,v])=>Date.now()<v.until).map(([pair,v])=>({pair,remainingMs:v.until-Date.now(),reason:'pair_loss_streak'})); }

let _lastSignalAction=null, _lastSignalCount=0;
export function checkDoubleConfirmation(action) {
  const s = runtimeSettings;
  if (!s.doubleConfirmEnabled) return true;
  if (action==='HOLD') { _lastSignalAction=null; _lastSignalCount=0; return false; }
  if (action===_lastSignalAction) {
    _lastSignalCount++;
    if (_lastSignalCount>=2) return true;
    return false;
  }
  _lastSignalAction=action; _lastSignalCount=1; return false;
}
export function resetDoubleConfirmation() { _lastSignalAction=null; _lastSignalCount=0; }

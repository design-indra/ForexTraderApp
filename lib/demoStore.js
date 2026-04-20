/**
 * lib/demoStore.js — Demo Mode State for ForexTrader
 * Unit: USD (bukan IDR seperti IndoTrader)
 */

let demoState = {
  usdBalance:        10000,   // saldo demo dalam USD
  startBalance:      10000,
  totalPnl:          0,
  totalPnlPct:       0,
  openPositions:     [],
  closedTrades:      [],
  tradeCount:        0,
  consecutiveLosses: 0,
  consecutiveWins:   0,
};

export function getDemoState()  { return demoState; }
export function setStartBalance(amount) {
  demoState.startBalance = amount;
  demoState.usdBalance   = amount;
}

export function resetDemo(balance = 10000) {
  demoState = {
    usdBalance: balance, startBalance: balance,
    totalPnl: 0, totalPnlPct: 0,
    openPositions: [], closedTrades: [],
    tradeCount: 0, consecutiveLosses: 0, consecutiveWins: 0,
  };
}

/**
 * Buka posisi demo (BUY/SELL)
 */
export function demoOpen(instrument, direction, lots, entryPrice, stopLoss, takeProfit, meta = {}) {
  // Estimasi margin yang dibutuhkan (simplified: lots * 100 * 1% untuk leverage 100:1)
  const marginRequired = lots * 100; // $100 per 0.01 lot (approx)
  if (demoState.usdBalance < marginRequired) return { success: false, error: 'Saldo tidak cukup' };

  const pos = {
    id:           `demo_${Date.now()}`,
    instrument,
    direction,    // 'buy' atau 'sell'
    lots,
    entryPrice,
    stopLoss,
    takeProfit,
    trailingStop: null,
    openTime:     Date.now(),
    tp1Triggered: false,
    breakevenSet: false,
    marginRequired,
    ...meta,
  };
  demoState.openPositions.push(pos);
  return { success: true, position: pos };
}

/**
 * Tutup posisi demo
 */
export function demoClose(positionId, closePrice, reason = 'manual') {
  const idx = demoState.openPositions.findIndex(p => p.id === positionId);
  if (idx === -1) return { success: false, error: 'Posisi tidak ditemukan' };

  const pos    = demoState.openPositions[idx];
  const isBuy  = pos.direction === 'buy';
  const pip    = pos.instrument?.includes('JPY') ? 0.01 : 0.0001;
  const pnlPips = isBuy
    ? (closePrice - pos.entryPrice) / pip
    : (pos.entryPrice - closePrice) / pip;
  const pipValueUSD = pos.lots * (pos.instrument?.includes('JPY') ? 9.30 : 10.0); // per pip
  const pnlUSD = parseFloat((pnlPips * pipValueUSD * 0.01).toFixed(2)); // normalize ke micro

  const trade = {
    id:         pos.id + '_closed',
    instrument: pos.instrument,
    direction:  pos.direction,
    lots:       pos.lots,
    entryPrice: pos.entryPrice,
    closePrice,
    openTime:   pos.openTime,
    closeTime:  Date.now(),
    pnlPips:    parseFloat(pnlPips.toFixed(1)),
    pnlUSD,
    reason,
    duration:   Math.round((Date.now() - pos.openTime) / 60000), // menit
  };

  demoState.openPositions.splice(idx, 1);
  demoState.closedTrades.unshift(trade);
  if (demoState.closedTrades.length > 200) demoState.closedTrades = demoState.closedTrades.slice(0, 200);

  demoState.usdBalance   = parseFloat((demoState.usdBalance + pnlUSD).toFixed(2));
  demoState.totalPnl     = parseFloat((demoState.totalPnl + pnlUSD).toFixed(2));
  demoState.totalPnlPct  = parseFloat(((demoState.totalPnl / demoState.startBalance) * 100).toFixed(2));
  demoState.tradeCount++;

  if (pnlUSD > 0) { demoState.consecutiveWins++; demoState.consecutiveLosses = 0; }
  else            { demoState.consecutiveLosses++; demoState.consecutiveWins  = 0; }

  return { success: true, trade };
}

/**
 * Update harga semua posisi terbuka (unrealized PnL)
 */
export function updatePositions(instrument, currentPrice) {
  demoState.openPositions = demoState.openPositions.map(pos => {
    if (pos.instrument !== instrument) return pos;
    const isBuy  = pos.direction === 'buy';
    const pip    = instrument?.includes('JPY') ? 0.01 : 0.0001;
    const pnlPips = isBuy
      ? (currentPrice - pos.entryPrice) / pip
      : (pos.entryPrice - currentPrice) / pip;
    const pipValueUSD = pos.lots * (instrument?.includes('JPY') ? 9.30 : 10.0);
    return { ...pos, currentPrice, unrealizedPnl: parseFloat((pnlPips * pipValueUSD * 0.01).toFixed(2)), unrealizedPips: parseFloat(pnlPips.toFixed(1)) };
  });
}

/**
 * lib/demoStore.js — Demo Mode State
 * Fix: pnlUSD formula - hapus * 0.01 yang salah (100x terlalu kecil)
 *
 * Standard pip value formula:
 *   pnlUSD = pnlPips × lots × pipValuePerStandardLot
 *   EUR/USD: pipValuePerStandardLot = $10.00
 *   JPY pairs: pipValuePerStandardLot = ~$9.30 (approx 150 JPY/USD)
 *   XAU/USD: pipValuePerStandardLot = $1.00 (pip = 0.10)
 */

let demoState = {
  usdBalance:10000, startBalance:10000,
  totalPnl:0, totalPnlPct:0,
  openPositions:[], closedTrades:[],
  tradeCount:0, consecutiveLosses:0, consecutiveWins:0,
};

export function getDemoState()  { return demoState; }
export function setStartBalance(amount) { demoState.startBalance=amount; demoState.usdBalance=amount; }

export function resetDemo(balance=10000) {
  demoState = {
    usdBalance:balance, startBalance:balance,
    totalPnl:0, totalPnlPct:0,
    openPositions:[], closedTrades:[],
    tradeCount:0, consecutiveLosses:0, consecutiveWins:0,
  };
}

// Pip value per standard lot untuk setiap pair
function getPipValueUSD(instrument, lots) {
  const isJPY  = instrument.includes('JPY');
  const isGold = instrument === 'XAU_USD';
  const isSilver = instrument === 'XAG_USD';
  const perLot = isGold ? 100.0 : isSilver ? 50.0 : isJPY ? 9.30 : 10.0;
  return lots * perLot;
}

export function demoOpen(instrument, direction, lots, entryPrice, stopLoss, takeProfit, meta={}) {
  // Margin = lots * 1000 USD (approx leverage 100:1, 1 lot = $100,000 nominal, 1% margin = $1000)
  const marginRequired = lots * 1000;
  if (demoState.usdBalance < marginRequired * 0.1) {
    return { success:false, error:`Saldo tidak cukup (margin ~$${marginRequired.toFixed(0)})` };
  }
  const pos = {
    id:`demo_${Date.now()}`, instrument, direction, lots,
    entryPrice, stopLoss, takeProfit, trailingStop:null,
    openTime:Date.now(), tp1Triggered:false, breakevenSet:false,
    marginRequired, ...meta,
  };
  demoState.openPositions.push(pos);
  return { success:true, position:pos };
}

export function demoClose(positionId, closePrice, reason='manual') {
  const idx = demoState.openPositions.findIndex(p=>p.id===positionId);
  if (idx===-1) return { success:false, error:'Posisi tidak ditemukan' };

  const pos     = demoState.openPositions[idx];
  const isBuy   = pos.direction==='buy';
  const pip     = pos.instrument?.includes('JPY') ? 0.01 :
                  pos.instrument==='XAU_USD'       ? 0.10 :
                  pos.instrument==='XAG_USD'        ? 0.01 : 0.0001;
  const pnlPips = isBuy
    ? (closePrice - pos.entryPrice) / pip
    : (pos.entryPrice - closePrice) / pip;

  // FIXED: hapus * 0.01 yang salah sebelumnya
  const pnlUSD  = parseFloat((pnlPips * getPipValueUSD(pos.instrument, pos.lots)).toFixed(2));

  const trade = {
    id:pos.id+'_closed', instrument:pos.instrument, direction:pos.direction,
    lots:pos.lots, entryPrice:pos.entryPrice, closePrice,
    openTime:pos.openTime, closeTime:Date.now(),
    pnlPips:parseFloat(pnlPips.toFixed(1)), pnlUSD, reason,
    duration:Math.round((Date.now()-pos.openTime)/60000),
  };

  demoState.openPositions.splice(idx,1);
  demoState.closedTrades.unshift(trade);
  if (demoState.closedTrades.length>200) demoState.closedTrades=demoState.closedTrades.slice(0,200);

  demoState.usdBalance  = parseFloat((demoState.usdBalance  + pnlUSD).toFixed(2));
  demoState.totalPnl    = parseFloat((demoState.totalPnl    + pnlUSD).toFixed(2));
  demoState.totalPnlPct = parseFloat(((demoState.totalPnl / demoState.startBalance)*100).toFixed(2));
  demoState.tradeCount++;

  if (pnlUSD>0) { demoState.consecutiveWins++;   demoState.consecutiveLosses=0; }
  else          { demoState.consecutiveLosses++;  demoState.consecutiveWins=0;   }

  return { success:true, trade };
}

export function updatePositions(instrument, currentPrice) {
  demoState.openPositions = demoState.openPositions.map(pos => {
    if (pos.instrument!==instrument) return pos;
    const isBuy   = pos.direction==='buy';
    const pip     = instrument.includes('JPY') ? 0.01 :
                    instrument==='XAU_USD'      ? 0.10 :
                    instrument==='XAG_USD'       ? 0.01 : 0.0001;
    const pnlPips = isBuy
      ? (currentPrice - pos.entryPrice) / pip
      : (pos.entryPrice - currentPrice) / pip;
    // FIXED: hapus * 0.01
    const unrealizedPnl = parseFloat((pnlPips * getPipValueUSD(instrument, pos.lots)).toFixed(2));
    return { ...pos, currentPrice, unrealizedPnl, unrealizedPips:parseFloat(pnlPips.toFixed(1)) };
  });
}

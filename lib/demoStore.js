/**
 * lib/demoStore.js — Demo Mode State
 * Fix v2:
 *  - File-based persistence agar state tidak hilang antar cycle
 *  - Hard guard maxPositions = 1 di level demoOpen (double protection)
 *  - default balance $31.25 (≈ Rp 500.000 @ 16.000)
 *  - pnlUSD formula benar: pips × lots × pipValuePerLot
 * Fix v3:
 *  - export saveState() agar bisa dipanggil dari bot/route.js
 */

import fs   from 'fs';
import path from 'path';

const STATE_FILE = '/tmp/demoState.json';
const DEFAULT_BALANCE = 31.25;

const DEFAULT_STATE = {
  usdBalance:DEFAULT_BALANCE, startBalance:DEFAULT_BALANCE,
  totalPnl:0, totalPnlPct:0,
  openPositions:[], closedTrades:[],
  tradeCount:0, consecutiveLosses:0, consecutiveWins:0,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.openPositions)) {
        return { ...DEFAULT_STATE, ...parsed };
      }
    }
  } catch (e) {
    console.warn('[demoStore] gagal load state:', e.message);
  }
  return { ...DEFAULT_STATE };
}

// FIX v3: dijadikan export agar bisa dipanggil dari route.js
export function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(demoState), 'utf8');
  } catch (e) {
    console.warn('[demoStore] gagal save state:', e.message);
  }
}

let demoState = loadState();

export function getDemoState()  { return demoState; }
export function setStartBalance(amount) {
  demoState.startBalance = amount;
  demoState.usdBalance   = amount;
  saveState();
}

export function resetDemo(balance=DEFAULT_BALANCE) {
  demoState = {
    usdBalance:balance, startBalance:balance,
    totalPnl:0, totalPnlPct:0,
    openPositions:[], closedTrades:[],
    tradeCount:0, consecutiveLosses:0, consecutiveWins:0,
  };
  saveState();
}

function getPipValueUSD(instrument, lots) {
  // USD value per 1 pip per lot size
  // XAU: 1 pip = $0.01, 1 standard lot = 100 oz → pip value = $1/pip/lot = $0.01/pip/micro
  // XAG: 1 pip = $0.001, pip value = $0.05/pip/micro
  // JPY: pip value ≈ $0.093/pip/micro
  // Other: pip value = $0.10/pip/micro
  const isJPY    = instrument.includes('JPY');
  const isGold   = instrument === 'XAU_USD';
  const isSilver = instrument === 'XAG_USD';
  const perLot   = isGold ? 1.0 : isSilver ? 0.50 : isJPY ? 9.30 : 10.0;
  return lots * perLot;
}

function getPipSize(instrument) {
  if (!instrument) return 0.0001;
  if (instrument.includes('JPY')) return 0.01;
  if (instrument === 'XAU_USD')   return 0.01;   // XAU pip = $0.01 (bukan 0.10)
  if (instrument === 'XAG_USD')   return 0.001;
  return 0.0001;
}

export function demoOpen(instrument, direction, lots, entryPrice, stopLoss, takeProfit, meta={}) {
  if (demoState.openPositions.length >= 1) {
    return { success:false, error:`Max 1 posisi — sudah ada ${demoState.openPositions.length} posisi terbuka` };
  }
  const marginRequired = lots * 1000;
  if (demoState.usdBalance < Math.max(5, marginRequired * 0.1)) {
    return { success:false, error:`Saldo tidak cukup (butuh minimal $${(marginRequired * 0.1).toFixed(2)})` };
  }
  const pos = {
    id:`demo_${Date.now()}`, instrument, direction, lots,
    entryPrice, stopLoss, takeProfit, trailingStop:null,
    openTime:Date.now(), tp1Triggered:false, breakevenSet:false,
    marginRequired, ...meta,
  };
  demoState.openPositions.push(pos);
  saveState();
  return { success:true, position:pos };
}

export function demoClose(positionId, closePrice, reason='manual') {
  const idx = demoState.openPositions.findIndex(p=>p.id===positionId);
  if (idx===-1) return { success:false, error:'Posisi tidak ditemukan' };

  const pos   = demoState.openPositions[idx];
  const isBuy = pos.direction==='buy';
  const pip   = getPipSize(pos.instrument);

  const pnlPips = isBuy
    ? (closePrice - pos.entryPrice) / pip
    : (pos.entryPrice - closePrice) / pip;

  const pnlUSD = parseFloat((pnlPips * getPipValueUSD(pos.instrument, pos.lots)).toFixed(2));

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

  if (pnlUSD>0) { demoState.consecutiveWins++;  demoState.consecutiveLosses=0; }
  else          { demoState.consecutiveLosses++; demoState.consecutiveWins=0;   }

  saveState();
  return { success:true, trade };
}

export function updatePositions(instrument, currentPrice) {
  demoState.openPositions = demoState.openPositions.map(pos => {
    if (pos.instrument!==instrument) return pos;
    const isBuy = pos.direction==='buy';
    const pip   = getPipSize(pos.instrument);
    const pnlPips = isBuy
      ? (currentPrice - pos.entryPrice) / pip
      : (pos.entryPrice - currentPrice) / pip;
    const unrealizedPnl = parseFloat((pnlPips * getPipValueUSD(pos.instrument, pos.lots)).toFixed(2));
    return { ...pos, currentPrice, unrealizedPnl, unrealizedPips:parseFloat(pnlPips.toFixed(1)) };
  });
  saveState();
}

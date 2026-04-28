/**
 * lib/userState.js — Per-User Demo State Manager
 *
 * Setiap user punya state sendiri yang tersimpan di Supabase tabel user_states.
 * Tidak ada lagi global state — semua operasi butuh userId.
 *
 * Tabel user_states:
 *   user_id        UUID (FK ke users.id)
 *   usd_balance    FLOAT
 *   start_balance  FLOAT
 *   total_pnl      FLOAT
 *   total_pnl_pct  FLOAT
 *   trade_count    INT
 *   win_count      INT
 *   loss_count     INT
 *   consec_losses  INT
 *   consec_wins    INT
 *   open_positions JSONB
 *   closed_trades  JSONB
 *   updated_at     TIMESTAMPTZ
 */

import { supabase } from './supabase.js';

const DEFAULT_BALANCE = 31.25; // ~Rp 500rb dalam USD

// ─── Default state untuk user baru ───────────────────────────────────────────
function defaultState(userId) {
  return {
    userId,
    usdBalance       : DEFAULT_BALANCE,
    startBalance     : DEFAULT_BALANCE,
    totalPnl         : 0,
    totalPnlPct      : 0,
    tradeCount       : 0,
    winCount         : 0,
    lossCount        : 0,
    consecutiveLosses: 0,
    consecutiveWins  : 0,
    openPositions    : [],
    closedTrades     : [],
  };
}

// ─── Load state dari Supabase ─────────────────────────────────────────────────
export async function getUserState(userId) {
  if (!userId) throw new Error('userId wajib');

  const { data, error } = await supabase
    .from('user_states')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return defaultState(userId);

  return {
    userId,
    usdBalance       : data.usd_balance      ?? DEFAULT_BALANCE,
    startBalance     : data.start_balance    ?? DEFAULT_BALANCE,
    totalPnl         : data.total_pnl        ?? 0,
    totalPnlPct      : data.total_pnl_pct    ?? 0,
    tradeCount       : data.trade_count      ?? 0,
    winCount         : data.win_count        ?? 0,
    lossCount        : data.loss_count       ?? 0,
    consecutiveLosses: data.consec_losses    ?? 0,
    consecutiveWins  : data.consec_wins      ?? 0,
    openPositions    : data.open_positions   ?? [],
    closedTrades     : data.closed_trades    ?? [],
  };
}

// ─── Save state ke Supabase ───────────────────────────────────────────────────
export async function saveUserState(userId, state) {
  if (!userId) throw new Error('userId wajib');

  const { error } = await supabase
    .from('user_states')
    .upsert({
      user_id        : userId,
      usd_balance    : state.usdBalance,
      start_balance  : state.startBalance,
      total_pnl      : state.totalPnl,
      total_pnl_pct  : state.totalPnlPct,
      trade_count    : state.tradeCount,
      win_count      : state.winCount,
      loss_count     : state.lossCount,
      consec_losses  : state.consecutiveLosses,
      consec_wins    : state.consecutiveWins,
      open_positions : state.openPositions,
      closed_trades  : state.closedTrades  ?? [],
      updated_at     : new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) throw error;
}

// ─── Reset state user ─────────────────────────────────────────────────────────
export async function resetUserState(userId, balance = DEFAULT_BALANCE) {
  const fresh = defaultState(userId);
  fresh.usdBalance   = balance;
  fresh.startBalance = balance;
  await saveUserState(userId, fresh);
  return fresh;
}

// ─── Open posisi demo ─────────────────────────────────────────────────────────
export async function userDemoOpen(userId, { instrument, direction, lots, entryPrice, stopLoss, takeProfit }) {
  const state = await getUserState(userId);

  const isXAU = instrument === 'XAU_USD';
  const isXAG = instrument === 'XAG_USD';
  const baseP  = isXAU ? entryPrice : isXAG ? entryPrice : 1;
  const margin = isXAU || isXAG ? lots * baseP * 10 / 100 : lots * 1000 / 100;

  if (state.usdBalance < margin) {
    return { success: false, error: `Saldo tidak cukup (butuh $${margin.toFixed(2)} margin)` };
  }

  const position = {
    id: `pos_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    instrument, direction, lots,
    entryPrice  : parseFloat(entryPrice.toFixed(5)),
    stopLoss    : stopLoss    ? parseFloat(stopLoss.toFixed(5))    : null,
    takeProfit  : takeProfit  ? parseFloat(takeProfit.toFixed(5))  : null,
    openTime    : new Date().toISOString(),
    marginUsed  : margin,
    unrealizedPnl: 0,
    unrealizedPips: 0,
    currentPrice : entryPrice,
  };

  state.usdBalance   -= margin;
  state.openPositions = [...state.openPositions, position];
  await saveUserState(userId, state);

  return { success: true, position, balance: state.usdBalance };
}

// ─── Close posisi demo ────────────────────────────────────────────────────────
function getPipSize(instrument) {
  if (!instrument) return 0.0001;
  if (instrument.includes('JPY')) return 0.01;
  if (instrument === 'XAU_USD')   return 0.01;
  if (instrument === 'XAG_USD')   return 0.001;
  return 0.0001;
}

function getPipValuePerLot(instrument) {
  if (instrument.includes('JPY')) return 9.30;
  if (instrument === 'XAU_USD')   return 1.0;
  if (instrument === 'XAG_USD')   return 5.0;
  return 10.0;
}

export async function userDemoClose(userId, positionId, closePrice, reason = null) {
  const state = await getUserState(userId);
  const idx   = state.openPositions.findIndex(p => p.id === positionId);
  if (idx === -1) return { success: false, error: 'Posisi tidak ditemukan' };

  const pos     = state.openPositions[idx];
  const isBuy   = pos.direction === 'buy';
  const pip     = getPipSize(pos.instrument);
  const pnlPips = isBuy
    ? (closePrice - pos.entryPrice) / pip
    : (pos.entryPrice - closePrice) / pip;

  const pipVal = getPipValuePerLot(pos.instrument);
  const pnlUSD = parseFloat((pnlPips * pipVal * pos.lots).toFixed(2));

  const closedTrade = {
    ...pos, closePrice, closeTime: new Date().toISOString(),
    pnlUSD, pnlPips: parseFloat(pnlPips.toFixed(1)),
    result: pnlUSD >= 0 ? 'win' : 'loss',
    reason: reason || (pnlUSD >= 0 ? 'take_profit' : 'stop_loss'),
  };

  state.usdBalance     = parseFloat((state.usdBalance + pos.marginUsed + pnlUSD).toFixed(2));
  state.totalPnl       = parseFloat((state.totalPnl + pnlUSD).toFixed(2));
  state.totalPnlPct    = parseFloat(((state.usdBalance - state.startBalance) / state.startBalance * 100).toFixed(2));
  state.tradeCount    += 1;
  state.openPositions  = state.openPositions.filter((_, i) => i !== idx);

  if (!state.closedTrades) state.closedTrades = [];
  state.closedTrades = [closedTrade, ...state.closedTrades].slice(0, 100);

  if (pnlUSD >= 0) {
    state.winCount       = (state.winCount || 0) + 1;
    state.consecutiveWins     += 1;
    state.consecutiveLosses    = 0;
  } else {
    state.lossCount      = (state.lossCount || 0) + 1;
    state.consecutiveLosses    += 1;
    state.consecutiveWins       = 0;
  }

  await saveUserState(userId, state);
  return { success: true, trade: closedTrade, balance: state.usdBalance };
}

// ─── Update unrealized PnL posisi terbuka ────────────────────────────────────
export async function userUpdatePositions(userId, instrument, currentPrice) {
  const state = await getUserState(userId);
  let changed = false;

  state.openPositions = state.openPositions.map(pos => {
    if (pos.instrument !== instrument) return pos;
    const isBuy   = pos.direction === 'buy';
    const pip     = getPipSize(instrument);
    const pnlPips = isBuy
      ? (currentPrice - pos.entryPrice) / pip
      : (pos.entryPrice - currentPrice) / pip;
    const pipVal  = getPipValuePerLot(instrument);
    const unrealizedPnl = parseFloat((pnlPips * pipVal * pos.lots).toFixed(2));
    changed = true;
    return { ...pos, currentPrice, unrealizedPnl, unrealizedPips: parseFloat(pnlPips.toFixed(1)) };
  });

  if (changed) await saveUserState(userId, state);
  return state.openPositions;
}

/**
 * app/api/autocycle/route.js — Server-Side Bot Auto Cycle (Per-User)
 *
 * v3.0 — Per-User Multi-Tenant
 * Setiap user punya cycle timer sendiri — tidak ada global state.
 * Admin start/stop hanya mempengaruhi bot milik admin itu sendiri.
 */

import { NextResponse } from 'next/server';
import { getBotState, runCycle, recordTradeResult } from '../../../lib/tradingEngine.js';
import { getOHLCV, getTicker } from '../../../lib/monex.js';
import { getRiskSettings } from '../../../lib/riskManager.js';
import { scanAllPairs } from '../../../lib/pairScanner.js';
import { verifyToken } from '../../../lib/auth.js';
import {
  getUserState, saveUserState,
  userDemoOpen, userDemoClose, userUpdatePositions,
} from '../../../lib/userState.js';

const userCycles = new Map();
const TF_MAP = { '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D' };
const SCAN_INTERVAL_MS = 30_000;

function getCycleState(userId) {
  if (!userCycles.has(userId)) {
    userCycles.set(userId, {
      timer: null, running: false,
      config: { tf:'5m', autoPair:false, instrument:'EUR_USD', signalMode:'combined' },
      lastCycleTime: null, lastError: null, cycleCount: 0,
      scanResult: null, scanTime: 0,
    });
  }
  return userCycles.get(userId);
}

function extractUserId(req) {
  const auth    = req.headers.get('authorization') || '';
  const token   = auth.replace('Bearer ', '').trim();
  const decoded = verifyToken(token);
  return decoded?.id || null;
}

async function runUserAutoCycle(userId) {
  const cs  = getCycleState(userId);
  const bot = getBotState(userId);
  if (!bot.running) return;

  let userDemo;
  try { userDemo = await getUserState(userId); }
  catch { return; }

  const openPos    = userDemo.openPositions || [];
  const hasOpenPos = openPos.length > 0;
  const tf         = cs.config.tf || '5m';
  const signalMode = cs.config.signalMode || 'combined';
  const autoPair   = (signalMode === 'scanner' || signalMode === 'combined')
    ? (cs.config.autoPair || false) : false;
  const granularity = TF_MAP[tf] || 'M5';
  const riskCfg    = getRiskSettings();

  let instrument = cs.config.instrument || bot.instrument || 'EUR_USD';
  let scanData   = null;

  try {
    if (autoPair && hasOpenPos) {
      instrument = openPos[0].instrument;
      scanData   = cs.scanResult;
    } else if (autoPair && !hasOpenPos) {
      const needScan = (Date.now() - cs.scanTime) > SCAN_INTERVAL_MS;
      if (needScan || !cs.scanResult) {
        scanData      = await scanAllPairs(tf, {});
        cs.scanResult = scanData;
        cs.scanTime   = Date.now();
      } else {
        scanData = cs.scanResult;
      }
      if (scanData?.best && scanData.best.action !== 'HOLD') {
        instrument = scanData.best.instrument;
      } else {
        return;
      }
    }

    const candles = await getOHLCV(instrument, granularity, 200, {});
    if (!candles || candles.length < 30) return;

    const close = candles[candles.length - 1].close;
    await userUpdatePositions(userId, instrument, close).catch(() => {});

    const otherPairs = [...new Set(openPos.map(p => p.instrument).filter(p => p !== instrument))];
    for (const p of otherPairs) {
      const pc = await getOHLCV(p, granularity, 5, {}).then(c => c?.slice(-1)[0]?.close).catch(() => null);
      if (pc) await userUpdatePositions(userId, p, pc).catch(() => {});
    }

    const ticker = await getTicker(instrument, {}).catch(() => null);
    const freshDemo = await getUserState(userId);
    const openForInstrument = (freshDemo.openPositions || []).filter(p => p.instrument === instrument);

    const scanSignalForCycle = (signalMode !== 'level' && autoPair && !hasOpenPos && scanData?.best?.instrument === instrument)
      ? { action: scanData.best.action, score: scanData.best.score, delta: scanData.best.delta }
      : null;

    const decision = await runCycle(userId, candles, {
      balance      : freshDemo.usdBalance,
      startBalance : freshDemo.startBalance || 31.25,
      targetBalance: riskCfg.targetProfitUSD || 500,
      openPositions: openForInstrument,
      instrument,
      scanSignal   : scanSignalForCycle,
      ticker,
    });

    for (const exitDec of (decision.exits || [])) {
      if (exitDec.isPartial) {
        const pos      = exitDec.position;
        const halfLots = parseFloat((pos.lots * 0.5).toFixed(2));
        const trade = {
          id: pos.id + '_partial_' + Date.now(),
          instrument: pos.instrument, direction: pos.direction,
          lots: halfLots, entryPrice: pos.entryPrice, closePrice: close,
          openTime: pos.openTime, closeTime: new Date().toISOString(),
          pnlPips: exitDec.pnlPips * 0.5, pnlUSD: exitDec.pnlUSD * 0.5,
          reason: 'partial_tp',
          duration: Math.round((Date.now() - new Date(pos.openTime).getTime()) / 60000),
        };
        const st = await getUserState(userId);
        if (!st.closedTrades) st.closedTrades = [];
        st.closedTrades.unshift(trade);
        st.totalPnl    = parseFloat((st.totalPnl + trade.pnlUSD).toFixed(2));
        st.totalPnlPct = parseFloat(((st.totalPnl / st.startBalance) * 100).toFixed(2));
        st.tradeCount  = (st.tradeCount || 0) + 1;
        const idx = st.openPositions.findIndex(p => p.id === pos.id);
        if (idx !== -1) st.openPositions[idx] = { ...st.openPositions[idx], lots: halfLots, tp1Triggered: true };
        await saveUserState(userId, st);
        recordTradeResult(userId, trade.pnlUSD, trade.pnlPips, pos.instrument);
        continue;
      }

      if (exitDec.isBreakeven) {
        const st  = await getUserState(userId);
        const idx = st.openPositions.findIndex(p => p.id === exitDec.position.id);
        if (idx !== -1) st.openPositions[idx] = { ...st.openPositions[idx], stopLoss: exitDec.newStopLoss, breakevenSet: true };
        await saveUserState(userId, st);
        continue;
      }

      if (exitDec.position) {
        const exitClosePrice = exitDec.position.instrument === instrument
          ? close : (exitDec.position.currentPrice || close);
        const result = await userDemoClose(userId, exitDec.position.id, exitClosePrice);
        if (result.success) recordTradeResult(userId, result.trade.pnlUSD, result.trade.pnlPips, exitDec.position.instrument);
      }
    }

    if (decision.entry) {
      const e = decision.entry;
      await userDemoOpen(userId, {
        instrument,
        direction  : e.direction,
        lots       : e.lots,
        entryPrice : e.price,
        stopLoss   : e.stopLoss,
        takeProfit : e.takeProfit,
      });
    }

    cs.lastCycleTime = new Date().toISOString();
    cs.lastError     = null;
    cs.cycleCount++;

  } catch (err) {
    cs.lastError = err.message;
    console.error('[AutoCycle][' + userId + ']', err.message);
  }
}

function startUserCycle(userId, cfg = {}) {
  const cs = getCycleState(userId);
  if (cs.timer) clearInterval(cs.timer);
  cs.config  = { ...cs.config, ...cfg };
  cs.running = true;
  cs.timer   = setInterval(() => runUserAutoCycle(userId), 10_000);
  runUserAutoCycle(userId);
}

function stopUserCycle(userId) {
  const cs = getCycleState(userId);
  if (cs.timer) { clearInterval(cs.timer); cs.timer = null; }
  cs.running = false;
}

export async function GET(req) {
  const userId = extractUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const cs  = getCycleState(userId);
  const bot = getBotState(userId);
  return NextResponse.json({
    success: true, autoCycleRunning: cs.running, autoCycleConfig: cs.config,
    lastCycleTime: cs.lastCycleTime, lastCycleError: cs.lastError,
    cycleCount: cs.cycleCount, botRunning: bot.running,
  });
}

export async function POST(req) {
  const userId = extractUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { action, config } = body;
  const cs = getCycleState(userId);

  switch (action) {
    case 'start':
      startUserCycle(userId, config || {});
      return NextResponse.json({ success: true, message: 'Auto-cycle started', autoCycleRunning: true });
    case 'stop':
      stopUserCycle(userId);
      return NextResponse.json({ success: true, message: 'Auto-cycle stopped', autoCycleRunning: false });
    case 'status': {
      const bot = getBotState(userId);
      return NextResponse.json({
        success: true, autoCycleRunning: cs.running, autoCycleConfig: cs.config,
        lastCycleTime: cs.lastCycleTime, lastCycleError: cs.lastError,
        cycleCount: cs.cycleCount, botRunning: bot.running,
      });
    }
    case 'update-config':
      cs.config = { ...cs.config, ...(config || {}) };
      if (cs.running) startUserCycle(userId, cs.config);
      return NextResponse.json({ success: true, autoCycleConfig: cs.config });
    default:
      return NextResponse.json({ success: false, error: 'Unknown action: ' + action }, { status: 400 });
  }
}

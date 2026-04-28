/**
 * app/api/bot/route.js — ForexTrader Bot Controller
 * v3.0 — Per-User Multi-Tenant (FIXED)
 *
 * Semua operasi bot (start, stop, cycle, logs, dll) terikat ke userId dari JWT.
 * Admin yang stop/start bot TIDAK mempengaruhi user lain.
 */
import { NextResponse } from 'next/server';
import {
  getBotState, startBot, stopBot, resetBotState,
  resumeBot, getLogs, runCycle, recordTradeResult,
} from '../../../lib/tradingEngine.js';
import { getCandles as brokerGetCandles, openTrade as brokerOpenTrade, closeTrade as brokerCloseTrade } from '../../../lib/brokerClient.js';
import { getOHLCV, getTicker } from '../../../lib/monex.js';
import { verifyToken } from '../../../lib/auth.js';
import {
  getUserState, saveUserState, resetUserState,
  userDemoOpen, userDemoClose, userUpdatePositions,
} from '../../../lib/userState.js';
import { getRiskSettings } from '../../../lib/riskManager.js';
import { scanAllPairs } from '../../../lib/pairScanner.js';

const TF_MAP = {
  '1m':'M1','5m':'M5','15m':'M15','30m':'M30',
  '1h':'H1','4h':'H4','1d':'D',
};

// ── Per-user scan cache (in-memory) ──────────────────────────────────────────
const userScanCache = new Map(); // userId → { result, time }
const SCAN_INTERVAL_MS = 30_000;

function getScanCache(userId) {
  if (!userScanCache.has(userId)) userScanCache.set(userId, { result: null, time: 0 });
  return userScanCache.get(userId);
}

// ── Helper: extract userId dari request ───────────────────────────────────────
function extractUserId(req) {
  const auth    = req.headers.get('authorization') || '';
  const token   = auth.replace('Bearer ', '').trim();
  const decoded = verifyToken(token);
  return decoded?.id || null;
}

function buildDefaultDemo(userId) {
  return {
    userId, usdBalance: 31.25, startBalance: 31.25, totalPnl: 0,
    totalPnlPct: 0, tradeCount: 0, winCount: 0, lossCount: 0,
    consecutiveLosses: 0, consecutiveWins: 0, openPositions: [], closedTrades: [],
  };
}

// ── GET — load state per user ─────────────────────────────────────────────────
export async function GET(req) {
  const userId = extractUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const state    = getBotState(userId);
  const logs     = getLogs(userId, 50);
  const scanCache = getScanCache(userId);

  let userDemo = buildDefaultDemo(userId);
  try { userDemo = await getUserState(userId); } catch (e) { console.error('[GET userState]', e.message); }

  return NextResponse.json({
    success: true,
    bot: {
      running           : state.running,
      mode              : state.mode,
      level             : state.level,
      instrument        : state.instrument,
      direction         : state.direction,
      isPaused          : state.isPaused,
      pauseReason       : state.pauseReason,
      consecutiveLosses : state.consecutiveLosses,
      consecutiveWins   : state.consecutiveWins,
      totalPnl          : state.totalPnl,
      lastSignal        : state.lastSignal,
      stats             : state.stats,
      autoPair          : state.autoPair || false,
      currentPair       : state.currentPair || state.instrument,
    },
    demo: {
      usdBalance        : userDemo.usdBalance,
      startBalance      : userDemo.startBalance,
      totalPnl          : userDemo.totalPnl,
      totalPnlPct       : userDemo.totalPnlPct,
      openPositions     : userDemo.openPositions,
      closedTrades      : (userDemo.closedTrades || []).slice(0, 50),
      tradeCount        : userDemo.tradeCount,
      consecutiveLosses : userDemo.consecutiveLosses,
    },
    scanResult: scanCache.result,
    logs,
  });
}

// ── POST — semua action bot, terikat ke userId ────────────────────────────────
export async function POST(req) {
  const userId = extractUserId(req);
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action, config, clientState, brokerCredentials, brokerConfig: bc } = body;

  const brokerConfig = bc || (brokerCredentials?.brokerId
    ? brokerCredentials
    : { brokerId: brokerCredentials?.apiKey ? 'oanda' : 'demo', credentials: brokerCredentials || {} });
  const creds = brokerConfig?.credentials || {};

  // Load per-user state
  let userDemo = null;
  try { userDemo = await getUserState(userId); } catch (e) { console.error('[userState load]', e.message); }
  if (!userDemo && clientState) {
    userDemo = {
      userId: null,
      usdBalance       : clientState.usdBalance        ?? 31.25,
      startBalance     : clientState.startBalance      ?? 31.25,
      totalPnl         : clientState.totalPnl          ?? 0,
      totalPnlPct      : clientState.totalPnlPct       ?? 0,
      tradeCount       : clientState.tradeCount        ?? 0,
      winCount         : clientState.winCount          ?? 0,
      lossCount        : clientState.lossCount         ?? 0,
      consecutiveLosses: clientState.consecutiveLosses ?? 0,
      consecutiveWins  : clientState.consecutiveWins   ?? 0,
      openPositions    : clientState.openPositions     ?? [],
      closedTrades     : clientState.closedTrades      ?? [],
    };
  }
  if (!userDemo) userDemo = buildDefaultDemo(userId);

  const scanCache = getScanCache(userId);

  try {
    switch (action) {

      // ── Start ─────────────────────────────────────────────────────────────
      case 'start': {
        if ((config?.mode === 'live' || config?.mode === 'practice') && !config.confirmed) {
          return NextResponse.json({ success: false, requireConfirmation: true });
        }
        startBot(userId, config || {});
        return NextResponse.json({ success: true, message: 'Bot started', state: getBotState(userId) });
      }

      case 'sync':
        return NextResponse.json({
          success: true,
          bot: getBotState(userId),
          demo: userDemo,
          logs: getLogs(userId, 50),
          scanResult: scanCache.result,
        });

      case 'stop':
        stopBot(userId);
        return NextResponse.json({ success: true });

      case 'resume':
        resumeBot(userId);
        return NextResponse.json({ success: true });

      case 'reset': {
        resetBotState(userId);
        const amount = config?.balance || 31.25;
        scanCache.result = null; scanCache.time = 0;
        let freshDemo = buildDefaultDemo(userId);
        freshDemo.usdBalance = amount; freshDemo.startBalance = amount;
        try { freshDemo = await resetUserState(userId, amount); } catch (e) { console.error('[resetUserState]', e.message); }
        return NextResponse.json({ success: true, demo: freshDemo });
      }

      case 'deleteTrade': {
        const tradeId = config?.tradeId;
        if (tradeId) {
          userDemo.closedTrades = (userDemo.closedTrades || []).filter(t => t.id !== tradeId);
          userDemo.totalPnl     = parseFloat(userDemo.closedTrades.reduce((s,t) => s + (t.pnlUSD||0), 0).toFixed(2));
          userDemo.tradeCount   = userDemo.closedTrades.length;
          userDemo.totalPnlPct  = userDemo.startBalance > 0 ? parseFloat(((userDemo.totalPnl/userDemo.startBalance)*100).toFixed(2)) : 0;
          userDemo.usdBalance   = parseFloat((userDemo.startBalance + userDemo.totalPnl).toFixed(2));
          await saveUserState(userId, userDemo);
        }
        return NextResponse.json({ success: true, demo: userDemo });
      }

      case 'clearHistory': {
        userDemo.closedTrades      = [];
        userDemo.totalPnl          = 0;
        userDemo.totalPnlPct       = 0;
        userDemo.tradeCount        = 0;
        userDemo.consecutiveWins   = 0;
        userDemo.consecutiveLosses = 0;
        userDemo.usdBalance        = userDemo.startBalance;
        await saveUserState(userId, userDemo);
        return NextResponse.json({ success: true, demo: userDemo });
      }

      case 'scan': {
        const tf   = config?.tf || '5m';
        const scan = await scanAllPairs(tf, {});
        scanCache.result = scan; scanCache.time = Date.now();
        return NextResponse.json({ success: true, scan });
      }

      // ── Cycle ─────────────────────────────────────────────────────────────
      case 'cycle': {
        const state = getBotState(userId);
        if (!state.running) return NextResponse.json({ success: false, error: 'Bot not running' });

        const tf         = config?.tf || '5m';
        const signalMode = config?.signalMode ?? state.signalMode ?? 'combined';
        const autoPair   = (signalMode === 'scanner' || signalMode === 'combined')
          ? (config?.autoPair ?? state.autoPair ?? false) : false;

        const openPos    = userDemo.openPositions || [];
        const hasOpenPos = openPos.length > 0;

        let instrument = config?.instrument || state.instrument || 'EUR_USD';
        let scanData   = null;

        if (autoPair && hasOpenPos) {
          instrument = openPos[0].instrument;
          state.currentPair = instrument;
          scanData = scanCache.result;

        } else if (autoPair && !hasOpenPos) {
          const needScan = (Date.now() - scanCache.time) > SCAN_INTERVAL_MS;
          if (needScan || !scanCache.result) {
            scanData         = await scanAllPairs(tf, {});
            scanCache.result = scanData;
            scanCache.time   = Date.now();
          } else {
            scanData = scanCache.result;
          }
          if (scanData?.best && scanData.best.action !== 'HOLD') {
            instrument = scanData.best.instrument;
            state.currentPair = instrument;
          } else {
            return NextResponse.json({
              success: true, skipped: true, reason: 'no_strong_signal_in_scan',
              scanResult: scanData, demo: userDemo,
            });
          }
        }

        const granularity = TF_MAP[tf] || 'M5';

        let candles = null;
        if (brokerConfig.brokerId !== 'demo') {
          try { candles = await brokerGetCandles(instrument, config?.tf || '5m', 200, brokerConfig); } catch {}
        }
        if (!candles || !candles.length) candles = await getOHLCV(instrument, granularity, 200, creds);
        if (!candles || candles.length < 30) return NextResponse.json({ success: false, error: 'Insufficient candle data' });

        const close = candles[candles.length - 1].close;

        // Update unrealized PnL
        try { userDemo.openPositions = await userUpdatePositions(userId, instrument, close); } catch {}

        const otherPairs = [...new Set(openPos.map(p => p.instrument).filter(p => p !== instrument))];
        for (const p of otherPairs) {
          const pc = await getOHLCV(p, granularity, 5, creds).then(c => c?.slice(-1)[0]?.close).catch(() => null);
          if (pc) await userUpdatePositions(userId, p, pc).catch(() => {});
        }

        const riskCfg  = getRiskSettings();
        const openForInstrument = (userDemo.openPositions || []).filter(p => p.instrument === instrument);
        const ticker   = await getTicker(instrument, creds).catch(() => null);

        const scanSignalForCycle = (signalMode !== 'level' && autoPair && !hasOpenPos && scanData?.best?.instrument === instrument)
          ? { action: scanData.best.action, score: scanData.best.score, delta: scanData.best.delta }
          : null;

        // Reload fresh demo sebelum runCycle untuk saldo akurat
        let freshDemo = userDemo;
        try { freshDemo = await getUserState(userId); } catch {}

        const decision = await runCycle(userId, candles, {
          balance      : freshDemo.usdBalance,
          startBalance : freshDemo.startBalance || 31.25,
          targetBalance: riskCfg.targetProfitUSD || 500,
          openPositions: openForInstrument,
          instrument,
          scanSignal   : scanSignalForCycle,
          ticker,
        });

        // ── Process exits ──────────────────────────────────────────────────
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
            // Reload → update → save
            const st = await getUserState(userId);
            if (!st.closedTrades) st.closedTrades = [];
            st.closedTrades.unshift(trade);
            st.totalPnl    = parseFloat((st.totalPnl + trade.pnlUSD).toFixed(2));
            st.totalPnlPct = parseFloat(((st.totalPnl / st.startBalance) * 100).toFixed(2));
            st.tradeCount  = (st.tradeCount || 0) + 1;
            const idx = st.openPositions.findIndex(p => p.id === pos.id);
            if (idx !== -1) st.openPositions[idx] = { ...st.openPositions[idx], lots: halfLots, tp1Triggered: true };
            await saveUserState(userId, st);
            userDemo = st; // sync local
            recordTradeResult(userId, trade.pnlUSD, trade.pnlPips, pos.instrument);
            continue;
          }

          if (exitDec.isBreakeven) {
            const st  = await getUserState(userId);
            const idx = st.openPositions.findIndex(p => p.id === exitDec.position.id);
            if (idx !== -1) st.openPositions[idx] = { ...st.openPositions[idx], stopLoss: exitDec.newStopLoss, breakevenSet: true };
            await saveUserState(userId, st);
            userDemo = st;
            continue;
          }

          if (state.mode === 'demo') {
            const exitClosePrice = exitDec.position.instrument === instrument
              ? close : (exitDec.position.currentPrice || close);
            const result = await userDemoClose(userId, exitDec.position.id, exitClosePrice);
            if (result.success) {
              recordTradeResult(userId, result.trade.pnlUSD, result.trade.pnlPips, exitDec.position.instrument);
              try { userDemo = await getUserState(userId); } catch {}
            }
          } else {
            try {
              await brokerCloseTrade(exitDec.position.monexTradeId || exitDec.position.id, brokerConfig);
              recordTradeResult(userId, exitDec.pnlUSD || 0, exitDec.pnlPips || 0, instrument);
            } catch (err) { console.error('Close trade error:', err.message); }
          }
        }

        // ── Process entry ──────────────────────────────────────────────────
        if (decision.entry) {
          const e = decision.entry;
          if (state.mode === 'demo') {
            const openResult = await userDemoOpen(userId, {
              instrument,
              direction  : e.direction,
              lots       : e.lots,
              entryPrice : e.price,
              stopLoss   : e.stopLoss,
              takeProfit : e.takeProfit,
            });
            if (openResult.success) {
              try { userDemo = await getUserState(userId); } catch {}
            }
          } else {
            try {
              const units = e.direction === 'buy' ? e.lots * 100000 : -(e.lots * 100000);
              await brokerOpenTrade(instrument, units, e.stopLoss, e.takeProfit, brokerConfig);
            } catch (err) { console.error('Open trade error:', err.message); }
          }
        }

        const freshState = getBotState(userId);
        return NextResponse.json({
          success: true, decision, instrument, autoPair,
          scanResult: scanData,
          demo: userDemo,
          bot: {
            running          : freshState.running,
            mode             : freshState.mode,
            level            : freshState.level,
            instrument       : freshState.instrument,
            direction        : freshState.direction,
            isPaused         : freshState.isPaused,
            consecutiveLosses: freshState.consecutiveLosses,
            consecutiveWins  : freshState.consecutiveWins,
            totalPnl         : freshState.totalPnl,
            lastSignal       : freshState.lastSignal,
            stats            : freshState.stats,
            autoPair         : freshState.autoPair || autoPair,
            currentPair      : instrument,
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: 'Unknown action: ' + action }, { status: 400 });
    }
  } catch (err) {
    console.error('Bot API error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

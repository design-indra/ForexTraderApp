/**
 * app/api/bot/route.js — ForexTrader Bot Controller (MONEX/MIFX Edition)
 */
import { NextResponse } from 'next/server';
import { getBotState, startBot, stopBot, resetBotState, resumeBot, getLogs, runCycle, recordTradeResult } from '../../../lib/tradingEngine.js';
import { getDemoState, resetDemo, demoOpen, demoClose, updatePositions, setStartBalance } from '../../../lib/demoStore.js';
import { getOHLCV, openTrade, closeTrade } from '../../../lib/monex.js';
import { getRiskSettings } from '../../../lib/riskManager.js';

const TF_MAP = { '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D' };

export async function GET() {
  const state = getBotState();
  const demo  = getDemoState();
  const logs  = getLogs(50);
  return NextResponse.json({
    success: true,
    bot: {
      running: state.running, mode: state.mode, level: state.level,
      instrument: state.instrument, direction: state.direction,
      isPaused: state.isPaused, pauseReason: state.pauseReason,
      consecutiveLosses: state.consecutiveLosses, consecutiveWins: state.consecutiveWins,
      totalPnl: state.totalPnl, lastSignal: state.lastSignal, stats: state.stats,
    },
    demo: {
      usdBalance:    demo.usdBalance,
      startBalance:  demo.startBalance,
      totalPnl:      demo.totalPnl,
      totalPnlPct:   demo.totalPnlPct,
      openPositions: demo.openPositions,
      closedTrades:  demo.closedTrades.slice(0, 50),
      tradeCount:    demo.tradeCount,
      consecutiveLosses: demo.consecutiveLosses,
    },
    logs,
  });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, config, clientState, brokerCredentials } = body;

  // Restore client state (stateless fix)
  if (clientState) {
    const demo = getDemoState();
    if (clientState.usdBalance !== undefined) {
      demo.usdBalance        = clientState.usdBalance;
      demo.startBalance      = clientState.startBalance      || demo.startBalance;
      demo.totalPnl          = clientState.totalPnl          || 0;
      demo.totalPnlPct       = clientState.totalPnlPct       || 0;
      demo.tradeCount        = clientState.tradeCount        || 0;
      demo.consecutiveLosses = clientState.consecutiveLosses || 0;
      demo.consecutiveWins   = clientState.consecutiveWins   || 0;
      if (Array.isArray(clientState.openPositions)) demo.openPositions = clientState.openPositions;
      if (Array.isArray(clientState.closedTrades)) {
        const existing = new Set(demo.closedTrades.map(t => t.id));
        for (const t of clientState.closedTrades) {
          if (!existing.has(t.id)) { demo.closedTrades.unshift(t); existing.add(t.id); }
        }
        demo.closedTrades = demo.closedTrades.slice(0, 200);
      }
    }
  }

  try {
    switch (action) {

      case 'start': {
        if ((config?.mode === 'live' || config?.mode === 'practice') && !config.confirmed) {
          return NextResponse.json({ success: false, requireConfirmation: true });
        }
        startBot(config || {});
        return NextResponse.json({ success: true, message: 'Bot started', state: getBotState() });
      }

      case 'sync':
        return NextResponse.json({ success: true, bot: getBotState(), demo: getDemoState(), logs: getLogs(50) });

      case 'stop':   stopBot();   return NextResponse.json({ success: true });
      case 'resume': resumeBot(); return NextResponse.json({ success: true });

      case 'reset': {
        resetBotState();
        const amount = config?.balance || 10000;
        setStartBalance(amount);
        resetDemo(amount);
        return NextResponse.json({ success: true, demo: getDemoState() });
      }

      case 'deleteTrade': {
        const demo    = getDemoState();
        const tradeId = config?.tradeId;
        if (tradeId) {
          demo.closedTrades = demo.closedTrades.filter(t => t.id !== tradeId);
          demo.totalPnl     = demo.closedTrades.reduce((s, t) => s + (t.pnlUSD || 0), 0);
          demo.tradeCount   = demo.closedTrades.length;
          demo.totalPnlPct  = demo.startBalance > 0 ? (demo.totalPnl / demo.startBalance) * 100 : 0;
        }
        return NextResponse.json({ success: true, demo: getDemoState() });
      }

      case 'clearHistory': {
        const demo = getDemoState();
        demo.closedTrades = []; demo.totalPnl = 0; demo.totalPnlPct = 0; demo.tradeCount = 0;
        return NextResponse.json({ success: true, demo: getDemoState() });
      }

      case 'cycle': {
        const state = getBotState();
        if (!state.running) return NextResponse.json({ success: false, error: 'Bot not running' });

        const instrument  = config?.instrument || state.instrument || 'EUR_USD';
        const tf          = config?.tf          || '5m';
        const granularity = TF_MAP[tf] || 'M5';

        // Ambil candle — gunakan credentials untuk mode live
        const creds = (state.mode !== 'demo') ? brokerCredentials : null;
        const candles = await getOHLCV(instrument, granularity, 100, creds || {});
        if (!candles || candles.length < 30) return NextResponse.json({ success: false, error: 'Insufficient candle data' });

        const demo  = getDemoState();
        const close = candles[candles.length - 1].close;
        updatePositions(instrument, close);

        let openPositions = demo.openPositions.filter(p => p.instrument === instrument);
        const riskCfg     = getRiskSettings();

        const decision = await runCycle(candles, {
          balance:       demo.usdBalance,
          startBalance:  demo.startBalance  || 10000,
          targetBalance: riskCfg.targetProfitUSD || 500,
          openPositions,
        });

        // ── Process exits ─────────────────────────────────────────────────────
        for (const exitDec of (decision.exits || [])) {
          if (exitDec.isPartial) {
            const pos      = exitDec.position;
            const halfLots = parseFloat((pos.lots * 0.5).toFixed(2));
            const trade    = {
              id         : pos.id + '_partial_' + Date.now(),
              instrument : pos.instrument,
              direction  : pos.direction,
              lots       : halfLots,
              entryPrice : pos.entryPrice,
              closePrice : close,
              openTime   : pos.openTime,
              closeTime  : Date.now(),
              pnlPips    : exitDec.pnlPips * 0.5,
              pnlUSD     : exitDec.pnlUSD  * 0.5,
              reason     : 'partial_tp',
              duration   : Math.round((Date.now() - pos.openTime) / 60000),
            };
            demo.closedTrades.unshift(trade);
            demo.usdBalance  = parseFloat((demo.usdBalance + trade.pnlUSD).toFixed(2));
            demo.totalPnl    = parseFloat((demo.totalPnl   + trade.pnlUSD).toFixed(2));
            demo.totalPnlPct = parseFloat(((demo.totalPnl / demo.startBalance) * 100).toFixed(2));
            const idx = demo.openPositions.findIndex(p => p.id === pos.id);
            if (idx !== -1) { demo.openPositions[idx] = { ...demo.openPositions[idx], lots: halfLots, tp1Triggered: true }; }
            continue;
          }
          if (exitDec.isBreakeven) {
            const idx = demo.openPositions.findIndex(p => p.id === exitDec.position.id);
            if (idx !== -1) { demo.openPositions[idx] = { ...demo.openPositions[idx], stopLoss: exitDec.newStopLoss, breakevenSet: true }; }
            continue;
          }
          if (state.mode === 'demo') {
            const result = demoClose(exitDec.position.id, close, exitDec.reason);
            if (result.success) recordTradeResult(result.trade.pnlUSD, result.trade.pnlPips, instrument);
          } else {
            // Live MONEX close
            try {
              await closeTrade(exitDec.position.monexTradeId || exitDec.position.id, creds || {});
              recordTradeResult(exitDec.pnlUSD || 0, exitDec.pnlPips || 0, instrument);
            } catch (err) {
              console.error('Close trade error:', err.message);
            }
          }
        }

        // ── Process entry ─────────────────────────────────────────────────────
        if (decision.entry) {
          const e = decision.entry;
          if (state.mode === 'demo') {
            demoOpen(instrument, e.direction, e.lots, e.price, e.stopLoss, e.takeProfit, {
              slPips: e.slPips, tpPips: e.tpPips, riskUSD: e.riskUSD,
              riskReward: e.riskReward, score: e.score, level: e.level,
              session: e.session, momentumGrade: e.momentumGrade,
            });
          } else {
            try {
              const units = e.direction === 'buy' ? e.lots * 100000 : -(e.lots * 100000);
              await openTrade(instrument, units, e.stopLoss, e.takeProfit, creds || {});
            } catch (err) {
              console.error('Open trade error:', err.message);
            }
          }
        }

        return NextResponse.json({ success: true, decision, demo: getDemoState() });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Bot API error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * app/api/autocycle/route.js — Server-Side Bot Auto Cycle
 *
 * Cara kerja:
 * - Railway menjalankan server terus-menerus (bukan serverless/Vercel)
 * - Saat server start, bot cycle berjalan otomatis di background via setInterval
 * - Tidak bergantung pada browser — bot tetap aktif meski app ditutup
 *
 * Endpoint:
 * GET  /api/autocycle         → cek status autocycle
 * POST /api/autocycle         → start / stop / get-status autocycle
 */

import { NextResponse } from 'next/server';
import { getBotState, runCycle } from '../../../lib/tradingEngine.js';
import {
  getDemoState, demoOpen, demoClose, updatePositions,
} from '../../../lib/demoStore.js';
import { getOHLCV, getTicker } from '../../../lib/monex.js';
import { getRiskSettings } from '../../../lib/riskManager.js';
import { scanAllPairs } from '../../../lib/pairScanner.js';
import { recordTradeResult } from '../../../lib/tradingEngine.js';

// ── State autocycle (in-memory per server instance) ───────────────────────────
let autoCycleTimer   = null;
let autoCycleRunning = false;
let autoCycleConfig  = { tf: '5m', autoPair: false, instrument: 'EUR_USD', signalMode: 'combined' };
let lastCycleTime    = null;
let lastCycleError   = null;
let cycleCount       = 0;

const TF_MAP = {
  '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
  '1h': 'H1', '4h': 'H4', '1d': 'D',
};
const SCAN_INTERVAL_MS = 30_000;
let lastScanResult = null;
let lastScanTime   = 0;

// ── Fungsi cycle (sama logika dengan bot/route.js cycle) ─────────────────────
async function runAutoCycle() {
  const state = getBotState();
  if (!state.running) return;

  const demo       = getDemoState();
  const openPos    = demo.openPositions || [];
  const hasOpenPos = openPos.length > 0;
  const tf         = autoCycleConfig.tf || '5m';
  const signalMode = autoCycleConfig.signalMode || 'combined';
  const autoPair   = (signalMode === 'scanner' || signalMode === 'combined')
    ? (autoCycleConfig.autoPair || false)
    : false;
  const granularity = TF_MAP[tf] || 'M5';
  const riskCfg    = getRiskSettings();

  let instrument = autoCycleConfig.instrument || state.instrument || 'EUR_USD';
  let scanData   = null;

  try {
    if (autoPair && hasOpenPos) {
      instrument = openPos[0].instrument;
      scanData   = lastScanResult;

    } else if (autoPair && !hasOpenPos) {
      const needScan = (Date.now() - lastScanTime) > SCAN_INTERVAL_MS;
      if (needScan || !lastScanResult) {
        scanData       = await scanAllPairs(tf, {});
        lastScanResult = scanData;
        lastScanTime   = Date.now();
      } else {
        scanData = lastScanResult;
      }
      if (scanData?.best && scanData.best.action !== 'HOLD') {
        instrument = scanData.best.instrument;
      } else {
        return; // tidak ada sinyal kuat, skip cycle
      }
    }

    // FIX v3: fetch 200 candles agar EMA50/100/200 dan ADX akurat (sebelumnya 100)
    const candles = await getOHLCV(instrument, granularity, 200, {});
    if (!candles || candles.length < 30) return;

    const close = candles[candles.length - 1].close;
    updatePositions(instrument, close);

    // Update posisi pair lain
    const otherPairs = [...new Set(openPos.map(p => p.instrument).filter(p => p !== instrument))];
    for (const p of otherPairs) {
      const pc = await getOHLCV(p, granularity, 5, {})
        .then(c => c?.slice(-1)[0]?.close).catch(() => null);
      if (pc) updatePositions(p, pc);
    }

    const ticker = await getTicker(instrument, {}).catch(() => null);
    const openForInstrument = openPos.filter(p => p.instrument === instrument);

    const scanSignalForCycle = (signalMode !== 'level' && autoPair && !hasOpenPos && scanData?.best?.instrument === instrument)
      ? { action: scanData.best.action, score: scanData.best.score, delta: scanData.best.delta }
      : null;

    const decision = await runCycle(candles, {
      balance      : demo.usdBalance,
      startBalance : demo.startBalance || 10000,
      targetBalance: riskCfg.targetProfitUSD || 500,
      openPositions: openForInstrument,
      instrument,
      scanSignal   : scanSignalForCycle,
      ticker,
    });

    // Process exits
    for (const exitDec of (decision.exits || [])) {
      if (exitDec.isPartial) {
        const pos      = exitDec.position;
        const halfLots = parseFloat((pos.lots * 0.5).toFixed(2));
        const trade = {
          id        : pos.id + '_partial_' + Date.now(),
          instrument: pos.instrument, direction: pos.direction,
          lots      : halfLots, entryPrice: pos.entryPrice, closePrice: close,
          openTime  : pos.openTime, closeTime: Date.now(),
          pnlPips   : exitDec.pnlPips * 0.5, pnlUSD: exitDec.pnlUSD * 0.5,
          reason    : 'partial_tp',
          duration  : Math.round((Date.now() - pos.openTime) / 60000),
        };
        demo.closedTrades.unshift(trade);
        demo.usdBalance  = parseFloat((demo.usdBalance + trade.pnlUSD).toFixed(2));
        demo.totalPnl    = parseFloat((demo.totalPnl   + trade.pnlUSD).toFixed(2));
        demo.totalPnlPct = parseFloat(((demo.totalPnl / demo.startBalance) * 100).toFixed(2));
        demo.tradeCount  = (demo.tradeCount || 0) + 1;
        const idx = demo.openPositions.findIndex(p => p.id === pos.id);
        if (idx !== -1) {
          demo.openPositions[idx] = { ...demo.openPositions[idx], lots: halfLots, tp1Triggered: true };
        }
        recordTradeResult(trade.pnlUSD, trade.pnlPips, pos.instrument);
        continue;
      }
      if (exitDec.isBreakeven) {
        const idx = demo.openPositions.findIndex(p => p.id === exitDec.position.id);
        if (idx !== -1) {
          demo.openPositions[idx] = { ...demo.openPositions[idx], stopLoss: exitDec.newStopLoss, breakevenSet: true };
        }
        continue;
      }
      if (exitDec.position) {
        const exitClosePrice = exitDec.position.instrument === instrument
          ? close : (exitDec.position.currentPrice || close);
        const result = demoClose(exitDec.position.id, exitClosePrice, exitDec.reason);
        if (result.success) recordTradeResult(result.trade.pnlUSD, result.trade.pnlPips, exitDec.position.instrument);
      }
    }

    // Process entry
    if (decision.entry) {
      const e = decision.entry;
      demoOpen(instrument, e.direction, e.lots, e.price, e.stopLoss, e.takeProfit, {
        slPips: e.slPips, tpPips: e.tpPips, riskUSD: e.riskUSD,
        riskReward: e.riskReward, score: e.score, level: e.level,
        session: e.session, momentumGrade: e.momentumGrade,
        foundByScanner: autoPair,
      });
    }

    lastCycleTime  = new Date().toISOString();
    lastCycleError = null;
    cycleCount++;

  } catch (err) {
    lastCycleError = err.message;
  }
}

// ── Start autocycle loop ──────────────────────────────────────────────────────
function startAutoCycle(cfg = {}) {
  if (autoCycleTimer) clearInterval(autoCycleTimer);
  autoCycleConfig  = { ...autoCycleConfig, ...cfg };
  autoCycleRunning = true;

  // Cycle interval: 10 detik (Railway server-side, tidak perlu hemat resource browser)
  autoCycleTimer = setInterval(runAutoCycle, 10_000);
  runAutoCycle(); // langsung jalankan sekali
}

function stopAutoCycle() {
  if (autoCycleTimer) { clearInterval(autoCycleTimer); autoCycleTimer = null; }
  autoCycleRunning = false;
}

// ── API Handlers ──────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    success         : true,
    autoCycleRunning,
    autoCycleConfig,
    lastCycleTime,
    lastCycleError,
    cycleCount,
    botRunning      : getBotState().running,
  });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, config } = body;

  switch (action) {
    case 'start': {
      startAutoCycle(config || {});
      return NextResponse.json({ success: true, message: 'Auto-cycle started', autoCycleRunning: true });
    }
    case 'stop': {
      stopAutoCycle();
      return NextResponse.json({ success: true, message: 'Auto-cycle stopped', autoCycleRunning: false });
    }
    case 'status': {
      return NextResponse.json({
        success: true, autoCycleRunning, autoCycleConfig,
        lastCycleTime, lastCycleError, cycleCount,
        botRunning: getBotState().running,
      });
    }
    case 'update-config': {
      autoCycleConfig = { ...autoCycleConfig, ...(config || {}) };
      // Jika cycle sedang running, restart dengan config baru
      if (autoCycleRunning) startAutoCycle(autoCycleConfig);
      return NextResponse.json({ success: true, autoCycleConfig });
    }
    default:
      return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  }
}

'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Zap, Shield, Play, Square,
  RefreshCw, Settings, AlertTriangle, BarChart2, Target, LogOut, ChevronDown,
  Eye, EyeOff, Wifi, WifiOff, CheckCircle, XCircle,
} from 'lucide-react';
import CandleChart  from './CandleChart';
import TradeLog     from './TradeLog';
import PositionCard from './PositionCard';

// ─── Constants ─────────────────────────────────────────────────────────────────
const PAIR_GROUPS = [
  { label:'💱 Major',  pairs:['EUR_USD','GBP_USD','USD_JPY','AUD_USD','USD_CAD','USD_CHF','NZD_USD'] },
  { label:'💶 Cross',  pairs:['EUR_GBP','EUR_JPY','GBP_JPY','AUD_JPY','EUR_AUD','GBP_AUD','EUR_CHF'] },
  { label:'🥇 Metals', pairs:['XAU_USD','XAG_USD'] },
];
const TIMEFRAMES = ['1m','5m','15m','30m','1h','4h','1d'];
const LEVELS = [
  { id:1, label:'Scalper',      icon:'⚡', color:'#0ea5e9', desc:'RSI7 + EMA Ribbon' },
  { id:2, label:'Smart',        icon:'🧠', color:'#6366f1', desc:'Market filter + confidence' },
  { id:3, label:'AI Score',     icon:'📊', color:'#8b5cf6', desc:'Multi-indicator scoring' },
  { id:4, label:'Adaptive',     icon:'🤖', color:'#f59e0b', desc:'ATR + S/R adaptive' },
  { id:5, label:'Full Context', icon:'🔴', color:'#ef4444', desc:'All filters + divergence' },
];
const TABS = [
  { id:'home',     label:'Home',   icon:'🏠' },
  { id:'chart',    label:'Chart',  icon:'📈' },
  { id:'signal',   label:'Signal', icon:'📡' },
  { id:'risk',     label:'Risk',   icon:'🛡️' },
  { id:'settings', label:'Setup',  icon:'⚙️' },
];

// IDR exchange rate default
const DEFAULT_IDR_RATE = 16000;

// ─── Formatters ─────────────────────────────────────────────────────────────────
const fmtIDR  = (usd, rate = DEFAULT_IDR_RATE) => {
  const idr = Math.round((usd || 0) * rate);
  return `Rp ${idr.toLocaleString('id-ID')}`;
};
const fmtIDRCompact = (usd, rate = DEFAULT_IDR_RATE) => {
  const idr = Math.round((usd || 0) * rate);
  if (Math.abs(idr) >= 1_000_000) return `Rp ${(idr / 1_000_000).toFixed(2)}jt`;
  if (Math.abs(idr) >= 1_000)    return `Rp ${(idr / 1_000).toFixed(0)}rb`;
  return `Rp ${idr.toLocaleString('id-ID')}`;
};
// USD formatters — untuk PnL & saldo utama
const fmtUSD = (usd) => {
  const n = usd || 0;
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtUSDCompact = (usd) => {
  const n = usd || 0;
  const sign = n >= 0 ? '' : '-';
  const abs  = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};
const fmtPnlUSD = (usd) => {
  const n = usd || 0;
  const sign = n >= 0 ? '+' : '-';
  const abs  = Math.abs(n);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};
const fmtPct   = (n) => `${n >= 0 ? '+' : ''}${(n || 0).toFixed(2)}%`;
const fmtPips  = (n) => `${n >= 0 ? '+' : ''}${(n || 0).toFixed(1)}p`;
const fmtPrice = (n, inst='') => (n||0).toFixed(inst.includes('JPY') ? 3 : 5);
const fmtPnlIDR = (usd, rate) => {
  const sign = usd >= 0 ? '+' : '';
  return `${sign}${fmtIDR(usd, rate)}`;
};


// ─── Pair Selector ─────────────────────────────────────────────────────────────
function PairSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const display = value?.replace('_', '/') || 'EUR/USD';
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 bg-slate-800/80 border border-slate-600 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-100">
        {display} <ChevronDown size={12}/>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden w-44" style={{ maxHeight: 280, overflowY: 'auto' }}>
          {PAIR_GROUPS.map(g => (
            <div key={g.label}>
              <div className="px-3 py-1.5 text-xs text-slate-500 font-semibold bg-slate-900/50 sticky top-0">{g.label}</div>
              {g.pairs.map(p => (
                <button key={p} onClick={() => { onChange(p); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 ${value === p ? 'text-emerald-400 bg-emerald-900/20' : 'text-slate-200'}`}>
                  {p.replace('_', '/')}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#10b981', icon }) {
  return (
    <div className="rounded-2xl border border-slate-700 p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500">{label}</span>
        {icon && <span className="text-base">{icon}</span>}
      </div>
      <div className="font-bold text-lg mono" style={{ color }}>{value}</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`w-10 h-6 rounded-full transition-colors relative ${value ? 'bg-emerald-500' : 'bg-slate-700'}`}>
      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${value ? 'left-5' : 'left-1'}`}/>
    </button>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard({ userEmail = '', onLogout }) {
  const [tab,           setTab]           = useState('home');
  const [botData,       setBotData]       = useState(null);
  const [marketData,    setMarketData]    = useState(null);
  const [liveBalance,   setLiveBalance]   = useState(null);
  const [riskSettings,  setRiskSettings]  = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [liveConfirm,   setLiveConfirm]   = useState(false);
  const [showApiKey,    setShowApiKey]    = useState(false);
  const [showSecret,    setShowSecret]    = useState(false);
  const [connStatus,    setConnStatus]    = useState(null); // null | 'loading' | 'ok' | 'error'
  const [connMsg,       setConnMsg]       = useState('');

  // IDR rate (configurable di settings)
  const [idrRate, setIdrRate] = useState(() => {
    try { return parseInt(localStorage.getItem('ft_idr_rate') || String(DEFAULT_IDR_RATE)); }
    catch { return DEFAULT_IDR_RATE; }
  });

  // MONEX credentials (disimpan di localStorage, bukan env)
  const [monexCreds, setMonexCreds] = useState(() => {
    try {
      const s = localStorage.getItem('ft_monex_creds');
      return s ? JSON.parse(s) : {
        apiKey     : '',
        accountId  : '',
        apiSecret  : '',
        environment: 'demo',
        baseUrl    : 'https://api.mifx.com',
      };
    } catch {
      return { apiKey:'', accountId:'', apiSecret:'', environment:'demo', baseUrl:'https://api.mifx.com' };
    }
  });

  const [config, setConfig] = useState(() => {
    try { const s = localStorage.getItem('ft_config'); return s ? JSON.parse(s) : { mode:'demo', level:1, instrument:'EUR_USD', tf:'5m', direction:'both', autoPair:false }; }
    catch { return { mode:'demo', level:1, instrument:'EUR_USD', tf:'5m', direction:'both', autoPair:false }; }
  });
  const [localDemo, setLocalDemo] = useState(() => {
    try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [scanResult,  setScanResult]  = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const wakeLockRef = useRef(null);
  const cycleRef    = useRef(null);

  useEffect(() => {
    try { localStorage.setItem('ft_config', JSON.stringify(config)); } catch {}
  }, [config]);

  // Save credentials to localStorage
  const saveMonexCreds = useCallback((creds) => {
    setMonexCreds(creds);
    try { localStorage.setItem('ft_monex_creds', JSON.stringify(creds)); } catch {}
  }, []);

  const saveIdrRate = useCallback((rate) => {
    setIdrRate(rate);
    try { localStorage.setItem('ft_idr_rate', String(rate)); } catch {}
  }, []);

  const saveDemoState = useCallback((demo) => {
    if (!demo) return;
    try { localStorage.setItem('ft_demo', JSON.stringify(demo)); } catch {}
    setLocalDemo(demo);
  }, []);

  const fetchBot = useCallback(async (clientState = null) => {
    try {
      const body = clientState ? { action:'sync', clientState } : undefined;
      const res  = body
        ? await fetch('/api/bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await fetch('/api/bot');
      const d = await res.json();
      if (d.success) { setBotData(d); if (d.demo) saveDemoState(d.demo); if (d.scanResult) setScanResult(d.scanResult); }
    } catch {} finally { setLoading(false); }
  }, [saveDemoState]);

  const fetchMarket = useCallback(async () => {
    try {
      const d = await fetch(`/api/market?instrument=${config.instrument}&tf=${config.tf}&count=100`).then(r => r.json());
      if (d.success) setMarketData(d);
    } catch {}
  }, [config.instrument, config.tf]);

  const fetchLiveBalance = useCallback(async () => {
    if (config.mode === 'demo') return;
    try {
      const creds = (() => { try { const s = localStorage.getItem('ft_monex_creds'); return s ? JSON.parse(s) : null; } catch { return null; } })();
      const d = await fetch('/api/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: config.mode, credentials: creds }),
      }).then(r => r.json());
      if (d.success) setLiveBalance(d.balance);
      else setLiveBalance(null);
    } catch { setLiveBalance(null); }
  }, [config.mode]);

  const fetchRiskSettings = useCallback(async () => {
    try { const d = await fetch('/api/settings').then(r => r.json()); if (d.success) setRiskSettings(d.risk); } catch {}
  }, []);

  useEffect(() => {
    fetchBot(); fetchMarket(); fetchRiskSettings();
    const b = setInterval(fetchBot, 3000);
    const m = setInterval(fetchMarket, 5000);
    const l = setInterval(fetchLiveBalance, 15000);
    return () => { clearInterval(b); clearInterval(m); clearInterval(l); };
  }, [fetchBot, fetchMarket, fetchLiveBalance, fetchRiskSettings]);

  useEffect(() => { fetchLiveBalance(); }, [config.mode, fetchLiveBalance]);

  // Wake lock
  useEffect(() => {
    async function wl() { if (!('wakeLock' in navigator)) return; try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {} }
    if (botData?.bot?.running) wl();
    else if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
  }, [botData?.bot?.running]);

  // Bot cycle interval
  useEffect(() => {
    if (botData?.bot?.running) {
      cycleRef.current = setInterval(async () => {
        try {
          const storedDemo  = (() => { try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; } })();
          const storedCreds = (() => { try { const s = localStorage.getItem('ft_monex_creds'); return s ? JSON.parse(s) : null; } catch { return null; } })();
          const res = await fetch('/api/bot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'cycle',
              config: { instrument: config.instrument, tf: config.tf, autoPair: config.autoPair },
              clientState: storedDemo,
              brokerCredentials: storedCreds,
            }),
          });
          const d = await res.json();
          if (d.success) {
              if (d.demo) saveDemoState(d.demo);
              if (d.scanResult) setScanResult(d.scanResult);
              setBotData(prev => {
                if (!prev) return prev;
                const updated = { ...prev };
                if (d.demo)  updated.demo = d.demo;
                if (d.bot)   updated.bot  = { ...prev.bot, ...d.bot };
                return updated;
              });
            }
        } catch {}
      }, 5000);
    } else clearInterval(cycleRef.current);
    return () => clearInterval(cycleRef.current);
  }, [botData?.bot?.running, config.instrument, config.tf, config.autoPair, saveDemoState]);

  const handleAction = async (action, extra = {}) => {
    setActionLoading(true);
    try {
      const storedDemo  = (() => { try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; } })();
      const storedCreds = (() => { try { const s = localStorage.getItem('ft_monex_creds'); return s ? JSON.parse(s) : null; } catch { return null; } })();
      const d = await fetch('/api/bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          config: { ...config, ...extra },
          clientState: storedDemo,
          brokerCredentials: storedCreds,
        }),
      }).then(r => r.json());
      if (d.requireConfirmation) { setLiveConfirm(true); return; }
      if (d.demo) saveDemoState(d.demo);
      await fetchBot();
    } catch {} finally { setActionLoading(false); }
  };

  const handleDeleteTrade = async (tradeId) => {
    const storedDemo = (() => { try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; } })();
    const d = await fetch('/api/bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'deleteTrade', config:{tradeId}, clientState: storedDemo }) }).then(r => r.json());
    if (d.success && d.demo) { saveDemoState(d.demo); setBotData(prev => prev ? { ...prev, demo: d.demo } : prev); if (d.scanResult) setScanResult(d.scanResult); }
  };

  const handleClearHistory = async () => {
    if (!confirm('Hapus semua riwayat trade?')) return;
    const storedDemo = (() => { try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; } })();
    const d = await fetch('/api/bot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'clearHistory', clientState: storedDemo }) }).then(r => r.json());
    if (d.success && d.demo) { saveDemoState(d.demo); setBotData(prev => prev ? { ...prev, demo: d.demo } : prev); if (d.scanResult) setScanResult(d.scanResult); }
  };

  const saveRiskSettings = async (newSettings) => {
    try { const d = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newSettings) }).then(r => r.json()); if (d.success) setRiskSettings(d.risk); } catch {}
  };

  const handleTestConnection = async () => {
    setConnStatus('loading');
    setConnMsg('Menghubungkan...');
    try {
      const res = await fetch('/api/broker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', credentials: monexCreds }),
      }).then(r => r.json());
      if (res.success) {
        setConnStatus('ok');
        const bal = res.balance;
        setConnMsg(`✅ Terhubung! Saldo: ${fmtIDR(bal?.balance, idrRate)} (${bal?.currency || 'USD'})`);
      } else {
        setConnStatus('error');
        setConnMsg(`❌ ${res.error}`);
      }
    } catch (err) {
      setConnStatus('error');
      setConnMsg(`❌ ${err.message}`);
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const bot        = botData?.bot  || {};
  const serverDemo = botData?.demo || {};
  // FIX: openPositions dan closedTrades SELALU dari server (data real-time + unrealizedPnl akurat)
  // localDemo hanya untuk balance/totalPnl saat server belum respond
  const demo       = localDemo
    ? { ...serverDemo, ...localDemo, openPositions: serverDemo.openPositions ?? localDemo.openPositions, closedTrades: serverDemo.closedTrades ?? localDemo.closedTrades }
    : serverDemo;
  const logs       = botData?.logs || [];
  const ticker     = marketData?.ticker     || {};
  const indicators = marketData?.indicators || {};
  const candles    = marketData?.candles    || [];
  const isLive     = config.mode !== 'demo';
  const isRunning  = bot.running;
  const isPaused   = bot.isPaused;
  const openPos    = demo.openPositions || [];
  const totalBal   = isLive && liveBalance ? liveBalance.balance : (demo.usdBalance || 0);
  const totalPnl   = demo.totalPnl || 0;
  const pnlPct     = demo.totalPnlPct || 0;
  const startBal   = demo.startBalance || 10000;
  const target     = riskSettings?.targetProfitUSD || 500;
  const progress   = Math.min(100, Math.max(0, ((totalBal - startBal) / (target)) * 100));
  const currentLevel = LEVELS.find(l => l.id === (bot.level || config.level)) || LEVELS[0];
  // Signal: dari lastSignal bot, atau fallback ke scanner best
  const signal = bot.lastSignal ||
    (scanResult?.best && scanResult.best.action !== 'HOLD' ? {
      action   : scanResult.best.action,
      score    : scanResult.best.score,
      instrument: scanResult.best.instrument,
      fromScanner: true,
      reasons  : scanResult.best.reasons || [],
      session  : null,
    } : null);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background:'var(--surface)' }}>
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg" style={{ background:'linear-gradient(135deg,#10b981,#059669)' }}>
          <TrendingUp size={32} className="text-white"/>
        </div>
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"/>
        <p className="text-slate-500 text-sm mt-3">Memuat ForexTrader...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background:'var(--surface)' }}>

      {/* ── HEADER ── */}
      <header className="border-b border-slate-700 px-3 flex items-center justify-between gap-2 sticky top-0 z-40" style={{ height:52, background:'var(--surface-2)' }}>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow" style={{ background:'linear-gradient(135deg,#10b981,#059669)' }}>
            <TrendingUp size={16} className="text-white"/>
          </div>
          <div>
            <span className="font-bold text-slate-100 text-sm">Forex<span className="text-emerald-400">Trader</span></span>
            <span className="text-xs text-slate-600 ml-1 hidden sm:inline">MONEX</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
          {config.autoPair ? (
            <div className="flex items-center gap-1.5 bg-emerald-900/30 border border-emerald-700/50 rounded-xl px-2.5 py-1.5">
              <span className="text-xs text-emerald-400 font-bold">🔍 Auto Scan</span>
              {scanResult?.best && <span className="text-xs text-slate-300 font-semibold">{scanResult.best.instrument.replace('_','/')}</span>}
            </div>
          ) : (
            <PairSelector value={config.instrument} onChange={(p) => setConfig(c => ({ ...c, instrument: p }))}/>
          )}
          {ticker.mid && !config.autoPair && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="mono font-bold text-slate-100 text-sm truncate">{fmtPrice(ticker.mid, config.instrument)}</span>
              {ticker.change24h !== undefined && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ticker.change24h >= 0 ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                  {fmtPct(ticker.change24h)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400 pulse' : isPaused ? 'bg-amber-400' : 'bg-slate-600'}`}/>
          {onLogout && (
            <button onClick={onLogout} className="text-slate-600 hover:text-slate-400">
              <LogOut size={15}/>
            </button>
          )}
        </div>
      </header>

      {/* Banners */}
      {isPaused && (
        <div className="bg-amber-900/30 border-b border-amber-700/50 px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400 shrink-0"/>
          <span className="text-xs text-amber-300 font-medium flex-1">Auto-pause: {bot.consecutiveLosses} consecutive losses</span>
          <button onClick={() => handleAction('resume')} className="text-xs bg-amber-500 text-white px-3 py-1 rounded-lg font-bold">Resume</button>
        </div>
      )}
      {isLive && liveBalance === null && (
        <div className="bg-red-900/30 border-b border-red-700/50 px-3 py-2">
          <p className="text-xs text-red-400">⚠️ Saldo MONEX gagal dimuat — cek API Key di menu Setup</p>
        </div>
      )}
      {liveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl p-6 max-w-xs w-full">
            <AlertTriangle size={32} className="text-amber-400 mx-auto mb-3"/>
            <h3 className="text-white font-bold text-center mb-2">Konfirmasi Live Trading</h3>
            <p className="text-slate-400 text-sm text-center mb-4">Bot akan trading menggunakan akun MONEX <span className="text-red-400 font-bold">{config.mode.toUpperCase()}</span>. Dana nyata dapat terpengaruh.</p>
            <div className="flex gap-2">
              <button onClick={() => setLiveConfirm(false)} className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-xl text-sm">Batal</button>
              <button onClick={() => { setLiveConfirm(false); handleAction('start', { confirmed: true }); }} className="flex-1 py-2 bg-red-600 text-white rounded-xl text-sm font-bold">Ya, Lanjut</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONTENT ── */}
      <div className="flex-1 overflow-y-auto pb-20">

        {/* ═══ HOME ═══ */}
        {tab === 'home' && (
          <div className="p-3 space-y-3">

            {/* Control Bar */}
            <div className="rounded-2xl border border-slate-700 p-3 flex items-center gap-3" style={{ background:'var(--surface-2)' }}>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 pulse' : isPaused ? 'bg-amber-400' : 'bg-slate-600'}`}/>
                <span className={`text-xs font-semibold ${isRunning ? 'text-emerald-400' : isPaused ? 'text-amber-400' : 'text-slate-500'}`}>
                  {isRunning ? 'Running' : isPaused ? 'Paused' : 'Stopped'}
                </span>
              </div>
              <div className="flex-1"/>
              <select value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value }))}
                disabled={isRunning}
                className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 disabled:opacity-50">
                <option value="demo">Demo</option>
                <option value="practice">Practice</option>
                <option value="live">Live</option>
              </select>
              {isRunning ? (
                <button onClick={() => handleAction('stop')} disabled={actionLoading}
                  className="flex items-center gap-1.5 bg-red-600 text-white px-4 py-2 rounded-xl text-xs font-bold">
                  <Square size={13}/> Stop
                </button>
              ) : (
                <button onClick={() => handleAction('start')} disabled={actionLoading}
                  className="flex items-center gap-1.5 text-white px-4 py-2 rounded-xl text-xs font-bold"
                  style={{ background:'linear-gradient(135deg,#10b981,#059669)' }}>
                  <Play size={13}/> Start
                </button>
              )}
            </div>

            {/* ── Auto Pair Scanner — info saja, toggle ada di tab Signal ── */}
            {config.autoPair && (
              <div className="rounded-2xl border border-emerald-700/40 px-4 py-2.5 flex items-center gap-3 bg-emerald-900/10">
                <span className="text-base shrink-0">🔍</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-emerald-400">Auto Scan Aktif</span>
                  <span className="text-xs text-slate-400 ml-2">
                    {scanResult?.best
                      ? `${scanResult.best.instrument.replace('_','/')} · ${scanResult.best.action} · ${scanResult.best.score}pts`
                      : 'Mencari sinyal terbaik...'}
                  </span>
                </div>
                <span className="text-xs text-slate-600">📡 {scanResult?.scannedCount || 15} pair</span>
              </div>
            )}

            {/* Balance + PnL — Saldo IDR, P&L dalam USD */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label={`Saldo ${config.mode.toUpperCase()}`}
                value={fmtIDRCompact(totalBal, idrRate)}
                sub={`≈ ${fmtUSDCompact(totalBal)}`}
                color="#e2e8f0"
                icon="💰"
              />
              <StatCard
                label="Total P&L"
                value={fmtPnlUSD(totalPnl)}
                sub={fmtPct(pnlPct)}
                color={totalPnl >= 0 ? '#10b981' : '#ef4444'}
                icon={totalPnl >= 0 ? '📈' : '📉'}
              />
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Trades" value={demo.tradeCount || 0} icon="🔢"/>
              <StatCard
                label="Win Rate"
                value={bot.stats?.totalTrades > 0 ? `${bot.stats.winRate?.toFixed(0)}%` : '-'}
                color={bot.stats?.winRate >= 50 ? '#10b981' : '#ef4444'}
                icon="🎯"
              />
              <StatCard
                label="Streak"
                value={bot.consecutiveWins > 0 ? `W${bot.consecutiveWins}` : bot.consecutiveLosses > 0 ? `L${bot.consecutiveLosses}` : '-'}
                color={bot.consecutiveWins > 0 ? '#10b981' : bot.consecutiveLosses > 0 ? '#ef4444' : '#94a3b8'}
                icon="🔥"
              />
            </div>

            {/* Progress bar — dalam IDR */}
            {target > 0 && (
              <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-500">Target Profit</span>
                  <span className="text-slate-300">{fmtPnlUSD(totalPnl)} / ${target.toFixed(0)}</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width:`${progress}%`, background:'linear-gradient(90deg,#10b981,#059669)' }}/>
                </div>
                <div className="text-xs text-slate-600 mt-1">{progress.toFixed(1)}%</div>
              </div>
            )}

            {/* Level selector */}
            <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
              <div className="text-xs text-slate-500 mb-2 font-semibold">Strategy Level</div>
              <div className="grid grid-cols-5 gap-1.5">
                {LEVELS.map(l => (
                  <button key={l.id}
                    onClick={() => { setConfig(c => ({ ...c, level: l.id })); if (!isRunning) handleAction('sync'); }}
                    disabled={isRunning}
                    className={`flex flex-col items-center p-2 rounded-xl border transition-all text-xs ${config.level === l.id ? 'border-opacity-100' : 'border-slate-700 opacity-60'}`}
                    style={{ background: config.level === l.id ? `${l.color}22` : 'transparent', borderColor: config.level === l.id ? l.color : undefined }}>
                    <span className="text-base mb-0.5">{l.icon}</span>
                    <span className="text-slate-300 text-center leading-tight" style={{ fontSize:9 }}>{l.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Direction + Timeframe */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                <div className="text-xs text-slate-500 mb-2">Direction</div>
                <div className="flex gap-1">
                  {['both','buy','sell'].map(d => (
                    <button key={d} onClick={() => setConfig(c => ({ ...c, direction: d }))} disabled={isRunning}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${config.direction === d ? 'text-white' : 'bg-slate-700 text-slate-400'}`}
                      style={{ background: config.direction === d ? (d==='both'?'#475569':d==='buy'?'#059669':'#dc2626') : undefined }}>
                      {d === 'both' ? '↕' : d === 'buy' ? '▲' : '▼'} {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                <div className="text-xs text-slate-500 mb-2">Timeframe</div>
                <div className="flex flex-wrap gap-1">
                  {TIMEFRAMES.map(t => (
                    <button key={t} onClick={() => setConfig(c => ({ ...c, tf: t }))}
                      className={`px-2 py-1 rounded-lg text-xs font-bold ${config.tf === t ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Open Positions */}
            {openPos.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 mb-2">Posisi Terbuka ({openPos.length})</h3>
                <div className="space-y-2">
                  {openPos.map(p => <PositionCard key={p.id} position={p} currentPrice={ticker.mid || p.entryPrice}/>)}
                </div>
              </div>
            )}

            {/* Trade History */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 mb-2">Riwayat Trade</h3>
              <TradeLog trades={demo.closedTrades || []} onDelete={handleDeleteTrade} onClearAll={handleClearHistory}/>
            </div>

            {/* Bot Log */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 mb-2">Bot Log</h3>
              <div className="rounded-2xl border border-slate-700 overflow-hidden" style={{ background:'var(--surface-2)' }}>
                <div className="space-y-0 max-h-64 overflow-y-auto">
                  {logs.length === 0 && <p className="text-xs text-slate-600 text-center py-6">Log kosong</p>}
                  {logs.map((log, i) => (
                    <div key={log.id || i} className={`px-3 py-2 text-xs border-b border-slate-800/50 flex gap-2 ${
                      log.type === 'error'  ? 'text-red-400' :
                      log.type === 'profit' ? 'text-emerald-400' :
                      log.type === 'loss'   ? 'text-red-400' :
                      log.type === 'buy'    ? 'text-emerald-300' :
                      log.type === 'sell'   ? 'text-red-300' :
                      log.type === 'warning'? 'text-amber-400' :
                      log.type === 'system' ? 'text-sky-400' :
                      'text-slate-400'
                    }`}>
                      <span className="text-slate-600 shrink-0">{new Date(log.time).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
                      <span className="flex-1">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ═══ CHART ═══ */}
        {tab === 'chart' && (
          <div className="p-3 space-y-3">
            <div className="rounded-2xl border border-slate-700 overflow-hidden" style={{ background:'var(--surface-2)' }}>
              <CandleChart
                candles={candles}
                indicators={indicators}
                instrument={config.autoPair && bot.currentPair ? bot.currentPair : config.instrument}
                tf={config.tf}
                openPositions={openPos}
                onRefresh={fetchMarket}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="RSI 14" value={indicators.rsi14?.toFixed(1) || '-'} color={indicators.rsi14 < 30 ? '#10b981' : indicators.rsi14 > 70 ? '#ef4444' : '#94a3b8'} icon="📊"/>
              <StatCard label="EMA 9 / 21" value={indicators.ema9 ? `${indicators.ema9.toFixed(4)}` : '-'} sub={indicators.ema21 ? `EMA21: ${indicators.ema21.toFixed(4)}` : ''} icon="📉"/>
              <StatCard label="MACD Hist" value={indicators.macd?.histogram?.toFixed(5) || '-'} color={indicators.macd?.histogram >= 0 ? '#10b981' : '#ef4444'} icon="⚡"/>
              <StatCard label="Momentum" value={indicators.momentum?.grade || '-'} sub={`Score: ${indicators.momentum?.score || 0}`} color={indicators.momentum?.score >= 70 ? '#10b981' : '#f59e0b'} icon="💪"/>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Spread" value={ticker.spread ? (ticker.spread * 10000).toFixed(1) + ' pips' : '-'} icon="📏"/>
              <StatCard label="ATR" value={indicators.atr ? indicators.atr.toFixed(5) : '-'} icon="🌊"/>
            </div>
          </div>
        )}

        {/* ═══ SIGNAL ═══ */}
        {tab === 'signal' && (
          <div className="p-3 space-y-3">
            {signal ? (
              <>
                <div className={`rounded-2xl border p-4 text-center ${signal.action === 'BUY' ? 'border-emerald-700/50 bg-emerald-900/10' : signal.action === 'SELL' ? 'border-red-700/50 bg-red-900/10' : 'border-slate-700'}`} style={{ background: signal.action === 'HOLD' ? 'var(--surface-2)' : undefined }}>
                  <div className="text-5xl mb-2">
                    {signal.action === 'BUY' ? '📈' : signal.action === 'SELL' ? '📉' : '⏸️'}
                  </div>
                  <div className={`text-2xl font-bold ${signal.action === 'BUY' ? 'text-emerald-400' : signal.action === 'SELL' ? 'text-red-400' : 'text-slate-400'}`}>
                    {signal.action}
                  </div>
                  {/* Pair yang menghasilkan sinyal */}
                  {(signal.instrument || (config.autoPair && bot.currentPair)) && (
                    <div className="text-base font-bold text-slate-300 mt-1">
                      {(signal.instrument || bot.currentPair).replace('_','/')}
                    </div>
                  )}
                  <div className="text-slate-500 text-sm mt-1">Score: {signal.score?.toFixed(0) || 50}/100</div>
                  <div className="text-xs text-slate-600 mt-1 flex items-center gap-1.5 justify-center flex-wrap">
                    {signal.fromScanner
                      ? <span>🔍 Scanner Signal</span>
                      : <span>Level {signal.level || config.level} · {currentLevel.label}</span>
                    }
                    {signal.scannerAgreement   && <span className="text-emerald-400">✅ Konfirmasi</span>}
                    {signal.boostedByScan && !signal.scannerAgreement && <span className="text-amber-400">⚡ Boosted</span>}
                    {signal.levelHoldOverride  && <span className="text-sky-400">🔍 Scanner Override</span>}
                    {signal.levelConflict      && <span className="text-orange-500">⚠️ Konflik Arah</span>}
                    {signal.sessionBlocked     && <span className="text-orange-400">🕐 Sesi Sepi</span>}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-slate-500">Signal Strength</span>
                    <span className="text-slate-300">{signal.score?.toFixed(0) || 0}/100</span>
                  </div>
                  <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${signal.score || 0}%`,
                      background: signal.score >= 75 ? 'linear-gradient(90deg,#10b981,#059669)' :
                                  signal.score >= 55 ? 'linear-gradient(90deg,#f59e0b,#d97706)' :
                                  signal.score >= 35 ? 'linear-gradient(90deg,#ef4444,#dc2626)' : '#475569',
                    }}/>
                  </div>
                  <div className="flex justify-between text-xs mt-1.5 text-slate-600">
                    <span>Lemah</span><span>Sedang</span><span>Kuat</span>
                  </div>
                </div>

                {signal.signals && (
                  <div className="rounded-2xl border border-slate-700 p-3 space-y-2" style={{ background:'var(--surface-2)' }}>
                    <h3 className="text-xs font-semibold text-slate-400">Signal Detail</h3>
                    {Object.entries(signal.signals).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="text-slate-500 capitalize">{k.replace(/_/g,' ')}</span>
                        <span className={`font-medium ${v === 'bullish' || v === 'oversold' || v === 'near_support' ? 'text-emerald-400' : v === 'bearish' || v === 'overbought' || v === 'near_resistance' ? 'text-red-400' : 'text-slate-300'}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}

                {signal.reasons?.length > 0 && (
                  <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                    <h3 className="text-xs font-semibold text-slate-400 mb-2">Alasan</h3>
                    {signal.reasons.map((r, i) => <p key={i} className="text-xs text-slate-300 mb-1">• {r}</p>)}
                  </div>
                )}

                {signal.session && (
                  <div className="rounded-2xl border border-slate-700 p-3" style={{ background:'var(--surface-2)' }}>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Sesi Trading</span>
                      <span className="text-slate-200">{signal.session.sessionName}</span>
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-slate-500">UTC Time</span>
                      <span className="text-slate-200">{signal.session.utcH?.toString().padStart(2,'0')}:{signal.session.utcM?.toString().padStart(2,'0')} UTC</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-slate-600">
                <Activity size={40} className="mx-auto mb-3 opacity-30"/>
                <p>{isRunning ? 'Menunggu sinyal pertama...' : 'Jalankan bot untuk melihat sinyal'}</p>
                {isRunning && config.autoPair && (
                  <p className="text-xs text-slate-700 mt-2">Bot sedang scan {scanResult?.scannedCount || 15} pair...</p>
                )}
              </div>
            )}

            {/* ── Scanner Ranking — selalu tampil di tab Signal ─────────────── */}
            <div className="rounded-2xl border border-slate-700 overflow-hidden" style={{ background:'var(--surface-2)' }}>
              {/* Header scanner */}
              <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔍</span>
                  <div>
                    <span className="text-sm font-bold text-slate-100">Pair Scanner</span>
                    {scanResult && (
                      <span className="text-xs text-slate-500 ml-2">
                        {scanResult.scannedCount} pair · {new Date(scanResult.timestamp).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle value={!!config.autoPair} onChange={v => setConfig(c => ({ ...c, autoPair: v }))}/>
                  <button
                    onClick={async () => {
                      setScanLoading(true);
                      try {
                        const storedCreds = (() => { try { const s = localStorage.getItem('ft_monex_creds'); return s ? JSON.parse(s) : null; } catch { return null; } })();
                        const storedDemo  = (() => { try { const s = localStorage.getItem('ft_demo'); return s ? JSON.parse(s) : null; } catch { return null; } })();
                        const d = await fetch('/api/bot', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action:'scan', config:{ tf: config.tf }, clientState: storedDemo, brokerCredentials: storedCreds }),
                        }).then(r => r.json());
                        if (d.success) setScanResult(d.scan);
                      } catch {} finally { setScanLoading(false); }
                    }}
                    disabled={scanLoading}
                    className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
                    {scanLoading
                      ? <div className="w-3.5 h-3.5 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"/>
                      : <RefreshCw size={13}/>
                    }
                  </button>
                </div>
              </div>

              {/* Ranking list */}
              {scanResult?.ranked?.length > 0 ? (
                <div className="p-2 space-y-1.5">
                  {scanResult.ranked.slice(0, 10).map((r, i) => {
                    const isActive  = r.action !== 'HOLD';
                    const isTop     = i === 0 && isActive;
                    const isCurrent = signal?.instrument === r.instrument ||
                                      (bot.currentPair && bot.currentPair === r.instrument);
                    return (
                      <div key={r.instrument}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl transition-all ${
                          isTop     ? 'bg-emerald-900/20 border border-emerald-800/40' :
                          isCurrent ? 'bg-sky-900/20 border border-sky-800/30' :
                          'bg-slate-800/40 border border-transparent'
                        }`}>
                        {/* Rank */}
                        <span className={`text-xs font-bold w-5 text-center shrink-0 ${isTop ? 'text-amber-400' : 'text-slate-600'}`}>
                          {isTop ? '★' : i + 1}
                        </span>
                        {/* Pair */}
                        <span className={`text-xs font-bold w-16 shrink-0 ${isCurrent ? 'text-sky-300' : 'text-slate-200'}`}>
                          {r.instrument.replace('_','/')}
                        </span>
                        {/* Action badge */}
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          r.action === 'BUY'  ? 'bg-emerald-900/60 text-emerald-400' :
                          r.action === 'SELL' ? 'bg-red-900/60 text-red-400' :
                          'bg-slate-700 text-slate-500'
                        }`}>
                          {r.action}
                        </span>
                        {/* Progress bar */}
                        <div className="flex-1 h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{
                              width:`${isActive ? r.score : 50}%`,
                              background: r.action==='BUY' ? 'linear-gradient(90deg,#10b981,#059669)' :
                                          r.action==='SELL'? 'linear-gradient(90deg,#ef4444,#dc2626)' :
                                          '#475569',
                            }}/>
                        </div>
                        {/* Score */}
                        <span className={`text-xs font-mono font-bold w-7 text-right shrink-0 ${
                          r.score >= 80 ? 'text-emerald-400' : r.score >= 65 ? 'text-amber-400' : 'text-slate-500'
                        }`}>
                          {r.score?.toFixed(0)}
                        </span>
                        {/* Current indicator */}
                        {isCurrent && <span className="text-xs text-sky-400 shrink-0">▶</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-600">
                  {scanLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"/>
                      <p className="text-xs">Scanning 15 pair...</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm">Belum ada data scan</p>
                      <p className="text-xs mt-1">Jalankan bot atau tekan tombol refresh ↑</p>
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ═══ RISK ═══ */}
        {tab === 'risk' && riskSettings && (
          <div className="p-3 space-y-3">
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-4">Risk Settings</h3>
              <div className="space-y-4">
                {[
                  { key:'maxRiskPercent',      label:'Max Risk %/Trade',   min:0.5,  max:5,    step:0.5,  suffix:'%' },
                  { key:'maxLotSize',          label:'Max Lot Size',       min:0.01, max:1.0,  step:0.01, suffix:' lot' },
                  { key:'stopLossPips',        label:'Stop Loss',          min:10,   max:100,  step:5,    suffix:' pips' },
                  { key:'takeProfitPips',      label:'Take Profit',        min:20,   max:200,  step:10,   suffix:' pips' },
                  { key:'trailingStopPips',    label:'Trailing Stop',      min:5,    max:50,   step:5,    suffix:' pips' },
                  { key:'maxConsecutiveLosses',label:'Max Consec. Losses', min:1,    max:10,   step:1,    suffix:'x' },
                  { key:'targetProfitUSD',     label:'Target Profit (USD)',min:50,   max:5000, step:50,   suffix:' USD' },
                  { key:'cooldownSeconds',     label:'Cooldown',           min:10,   max:300,  step:10,   suffix:' sec' },
                  { key:'breakevenPlusPips',   label:'Breakeven+ Buffer',  min:0,    max:10,   step:1,    suffix:' pips' },
                ].map(({ key, label, min, max, step, suffix }) => (
                  <div key={key}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-400">{label}</span>
                      <span className="text-slate-200 font-bold">{riskSettings[key]}{suffix}</span>
                    </div>
                    <input type="range" min={min} max={max} step={step} value={riskSettings[key]}
                      onChange={e => { const v = parseFloat(e.target.value); setRiskSettings(s => ({ ...s, [key]: v })); saveRiskSettings({ [key]: v }); }}
                      className="w-full accent-emerald-500"/>
                  </div>
                ))}
                {/* Target Profit dalam IDR (info saja) */}
                <div className="bg-slate-900/50 rounded-xl p-2 text-xs text-slate-500">
                  Target IDR: <span className="text-emerald-400 font-bold">{fmtIDRCompact(riskSettings.targetProfitUSD, idrRate)}</span>
                </div>
              </div>
            </div>

            {/* Profit Modes */}
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-3">Profit Mode</h3>
              {[
                { key:'maxProfitMode',   label:'Max Profit',   desc:'Dynamic ATR SL/TP, R:R min 1.5x',         color:'#6366f1' },
                { key:'ultraProfitMode', label:'Ultra Profit', desc:'Agresif, risk ×1.5, R:R min 1.0x',        color:'#ef4444' },
                { key:'ultraLightMode',  label:'Ultra Light',  desc:'Konservatif, risk ×0.5, R:R min 2.0x',    color:'#10b981' },
              ].map(({ key, label, desc, color }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-slate-800">
                  <div>
                    <div className="text-sm text-slate-200" style={{ color: riskSettings[key] ? color : undefined }}>{label}</div>
                    <div className="text-xs text-slate-600">{desc}</div>
                  </div>
                  <Toggle value={!!riskSettings[key]} onChange={v => {
                    const all = { maxProfitMode:false, ultraProfitMode:false, ultraLightMode:false };
                    const newR = { ...all, [key]: v };
                    setRiskSettings(s => ({ ...s, ...newR }));
                    saveRiskSettings(newR);
                  }}/>
                </div>
              ))}
            </div>

            {/* Exit Features */}
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-3">Exit Features</h3>
              {[
                { key:'partialTpEnabled',     label:'Partial Take Profit',   desc:'Jual 50% saat TP 50%' },
                { key:'breakevenEnabled',     label:'Breakeven+ Stop',       desc:`Geser SL ke entry +${riskSettings.breakevenPlusPips || 0} pips` },
                { key:'smartExitEnabled',     label:'Smart Exit',            desc:'Keluar awal jika sinyal berbalik' },
                { key:'timeExitEnabled',      label:'Time-based Exit',       desc:'Paksa keluar setelah max hold time' },
              ].map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-slate-800">
                  <div>
                    <div className="text-sm text-slate-200">{label}</div>
                    <div className="text-xs text-slate-600">{desc}</div>
                  </div>
                  <Toggle value={!!riskSettings[key]} onChange={v => { setRiskSettings(s => ({ ...s, [key]: v })); saveRiskSettings({ [key]: v }); }}/>
                </div>
              ))}
            </div>

            {/* 🆕 Profit Booster Features */}
            <div className="rounded-2xl border border-amber-700/40 p-4" style={{ background:'rgba(217,119,6,0.05)' }}>
              <h3 className="text-sm font-bold text-amber-400 mb-1">⚡ Profit Booster</h3>
              <p className="text-xs text-slate-500 mb-3">Fitur tambahan untuk konsistensi profit</p>

              {/* Win Multiplier */}
              <div className="border-b border-slate-800 pb-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm text-slate-200">Win Multiplier 🎰</div>
                    <div className="text-xs text-slate-600">Naik lot saat win streak (anti-martingale)</div>
                  </div>
                  <Toggle value={!!riskSettings.winMultiplierEnabled} onChange={v => { setRiskSettings(s => ({ ...s, winMultiplierEnabled: v })); saveRiskSettings({ winMultiplierEnabled: v }); }}/>
                </div>
                {riskSettings.winMultiplierEnabled && (
                  <div className="space-y-2 mt-2 pl-2 border-l-2 border-amber-700/40">
                    {[
                      { key:'winMultiplierFactor',    label:'Faktor/Win',   min:1.1,  max:2.0, step:0.05, suffix:'×' },
                      { key:'winMultiplierMaxFactor', label:'Max Multiplier', min:1.5, max:5.0, step:0.5,  suffix:'×' },
                    ].map(({ key, label, min, max, step, suffix }) => (
                      <div key={key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">{label}</span>
                          <span className="text-amber-300 font-bold">{riskSettings[key]?.toFixed(2)}{suffix}</span>
                        </div>
                        <input type="range" min={min} max={max} step={step} value={riskSettings[key] || min}
                          onChange={e => { const v = parseFloat(e.target.value); setRiskSettings(s => ({ ...s, [key]: v })); saveRiskSettings({ [key]: v }); }}
                          className="w-full accent-amber-500"/>
                      </div>
                    ))}
                    <p className="text-xs text-slate-600">
                      Contoh: Win 3×, faktor 1.25× → lot ×{(Math.pow(riskSettings.winMultiplierFactor || 1.25, 2)).toFixed(2)} (capped {riskSettings.winMultiplierMaxFactor || 2}×)
                    </p>
                  </div>
                )}
              </div>

              {/* Compound Mode */}
              <div className="flex items-center justify-between py-2 border-b border-slate-800">
                <div>
                  <div className="text-sm text-slate-200">Compound Mode 📈</div>
                  <div className="text-xs text-slate-600">Lot naik otomatis seiring profit akun</div>
                </div>
                <Toggle value={!!riskSettings.compoundEnabled} onChange={v => { setRiskSettings(s => ({ ...s, compoundEnabled: v })); saveRiskSettings({ compoundEnabled: v }); }}/>
              </div>

              {/* Double Confirmation */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm text-slate-200">Double Confirmation ✅</div>
                  <div className="text-xs text-slate-600">Entry hanya jika sinyal sama 2 siklus berturut</div>
                </div>
                <Toggle value={!!riskSettings.doubleConfirmEnabled} onChange={v => { setRiskSettings(s => ({ ...s, doubleConfirmEnabled: v })); saveRiskSettings({ doubleConfirmEnabled: v }); }}/>
              </div>
            </div>

            {/* Reset Demo balance dalam IDR */}
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-1">Reset Demo Balance</h3>
              <p className="text-xs text-slate-500 mb-3">Pilih modal awal (IDR)</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { usd: 31.25,  label: 'Rp 500rb' },
                  { usd: 62.5,   label: 'Rp 1jt'   },
                  { usd: 125,    label: 'Rp 2jt'    },
                  { usd: 312.5,  label: 'Rp 5jt'    },
                  { usd: 625,    label: 'Rp 10jt'   },
                  { usd: 1562,   label: 'Rp 25jt'   },
                ].map(({ usd, label }) => (
                  <button key={label} onClick={() => handleAction('reset', { balance: usd })}
                    className="py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-xs font-medium">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {tab === 'settings' && (
          <div className="p-3 space-y-3">

            {/* MONEX API Credentials — isi langsung di sini */}
            <div className="rounded-2xl border border-emerald-700/40 p-4" style={{ background:'rgba(16,185,129,0.04)' }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'linear-gradient(135deg,#10b981,#059669)' }}>
                  <span className="text-white text-sm font-bold">M</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">MONEX / MIFX API</h3>
                  <p className="text-xs text-slate-500">mifx.com — Akun Live</p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Account ID */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Account ID / Login</label>
                  <input
                    type="text"
                    value={monexCreds.accountId}
                    onChange={e => saveMonexCreds({ ...monexCreds, accountId: e.target.value })}
                    placeholder="Contoh: 12345678"
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">API Key</label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={monexCreds.apiKey}
                      onChange={e => saveMonexCreds({ ...monexCreds, apiKey: e.target.value })}
                      placeholder="API Key dari dashboard MIFX"
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                    <button onClick={() => setShowApiKey(v => !v)} className="absolute right-3 top-3 text-slate-500">
                      {showApiKey ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                </div>

                {/* API Secret (optional) */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">API Secret <span className="text-slate-600">(opsional)</span></label>
                  <div className="relative">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      value={monexCreds.apiSecret}
                      onChange={e => saveMonexCreds({ ...monexCreds, apiSecret: e.target.value })}
                      placeholder="Secret key (jika dibutuhkan)"
                      className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                    <button onClick={() => setShowSecret(v => !v)} className="absolute right-3 top-3 text-slate-500">
                      {showSecret ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                </div>

                {/* Environment */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Tipe Akun</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['live','demo'].map(env => (
                      <button key={env}
                        onClick={() => saveMonexCreds({ ...monexCreds, environment: env })}
                        className={`py-2.5 rounded-xl text-sm font-bold border transition-all ${monexCreds.environment === env
                          ? env === 'live' ? 'bg-red-600/20 border-red-600 text-red-400' : 'bg-emerald-600/20 border-emerald-600 text-emerald-400'
                          : 'bg-slate-800 border-slate-600 text-slate-400'}`}>
                        {env === 'live' ? '🔴 Live' : '🟢 Demo'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Base URL (advanced) */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">API Base URL <span className="text-slate-600">(advanced)</span></label>
                  <input
                    type="text"
                    value={monexCreds.baseUrl}
                    onChange={e => saveMonexCreds({ ...monexCreds, baseUrl: e.target.value })}
                    placeholder="https://api.mifx.com"
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                {/* Test Connection */}
                <button
                  onClick={handleTestConnection}
                  disabled={connStatus === 'loading' || !monexCreds.apiKey || !monexCreds.accountId}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                  style={{ background:'linear-gradient(135deg,#10b981,#059669)', color:'white' }}>
                  {connStatus === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                      Menghubungkan...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Wifi size={15}/>
                      Test Koneksi
                    </span>
                  )}
                </button>

                {connMsg && (
                  <div className={`rounded-xl p-3 text-xs ${connStatus === 'ok' ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40' : 'bg-red-900/30 text-red-300 border border-red-700/40'}`}>
                    {connMsg}
                  </div>
                )}

                {/* Panduan mendapatkan API Key */}
                <div className="bg-slate-900/50 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                  <p className="text-slate-400 font-semibold mb-2">📋 Cara mendapatkan API Key MIFX:</p>
                  <p>1. Login ke <span className="text-sky-400">mifx.com</span></p>
                  <p>2. Menu Akun → API Access / Developer</p>
                  <p>3. Generate API Key baru</p>
                  <p>4. Copy Account ID dari halaman profil</p>
                  <p className="text-amber-400 mt-2">⚠️ Jangan share API Key ke siapapun</p>
                </div>
              </div>
            </div>

            {/* IDR Rate Setting */}
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-3">🇮🇩 Kurs Tampilan (USD→IDR)</h3>
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Kurs USD/IDR</span>
                  <span className="text-emerald-400 font-bold">Rp {idrRate.toLocaleString('id-ID')}</span>
                </div>
                <input type="range" min={14000} max={18000} step={100} value={idrRate}
                  onChange={e => saveIdrRate(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"/>
                <div className="flex justify-between text-xs text-slate-600 mt-1">
                  <span>Rp 14.000</span><span>Rp 18.000</span>
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-xl p-2.5 text-xs text-slate-400 space-y-1">
                <div className="flex justify-between"><span>$1.000</span><span className="text-slate-200">{fmtIDR(1000, idrRate)}</span></div>
                <div className="flex justify-between"><span>$100 profit</span><span className="text-emerald-400">{fmtIDR(100, idrRate)}</span></div>
              </div>
              <p className="text-xs text-slate-600 mt-2">Semua tampilan saldo & profit menggunakan kurs ini. Logic trading tetap USD.</p>
            </div>

            {/* About */}
            <div className="rounded-2xl border border-slate-700 p-4" style={{ background:'var(--surface-2)' }}>
              <h3 className="text-sm font-bold text-slate-100 mb-3">Tentang Bot</h3>
              <div className="space-y-2 text-xs text-slate-500">
                <div className="flex justify-between"><span>Versi</span><span className="text-slate-300">ForexTrader v2.0 MONEX</span></div>
                <div className="flex justify-between"><span>Broker</span><span className="text-slate-300">MONEX / MIFX Indonesia</span></div>
                <div className="flex justify-between"><span>Engine</span><span className="text-slate-300">Next.js 15</span></div>
                <div className="flex justify-between"><span>Indikator</span><span className="text-slate-300">RSI, EMA, MACD, BB, S/R, Fib, VWAP</span></div>
                <div className="flex justify-between"><span>Profit Booster</span><span className="text-emerald-400">Win Multiplier, Compound, 2× Confirm</span></div>
                <div className="flex justify-between"><span>User</span><span className="text-slate-300">{userEmail}</span></div>
              </div>
            </div>

            {onLogout && (
              <button onClick={onLogout} className="w-full py-3 bg-red-900/30 border border-red-800/50 text-red-400 rounded-2xl text-sm font-semibold">
                Logout
              </button>
            )}
          </div>
        )}

      </div>

      {/* ── BOTTOM NAV ── */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-700 flex z-40" style={{ background:'var(--surface-2)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${tab === t.id ? 'text-emerald-400' : 'text-slate-600'}`}>
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="text-xs">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

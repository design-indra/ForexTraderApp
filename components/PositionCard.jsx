'use client';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';

function fmtPrice(n, instrument = '') {
  const dec = instrument.includes('JPY') ? 3 : 5;
  return (n || 0).toFixed(dec);
}
function fmtPips(n) { return (n >= 0 ? '+' : '') + (n || 0).toFixed(1) + 'p'; }

function fmtIDR(usd) {
  try {
    const rate = parseInt(localStorage.getItem('ft_idr_rate') || '16000');
    const idr  = Math.round((usd || 0) * rate);
    const sign = usd >= 0 ? '+' : '';
    if (Math.abs(idr) >= 1_000_000) return `${sign}Rp ${(idr / 1_000_000).toFixed(2)}jt`;
    if (Math.abs(idr) >= 1_000)    return `${sign}Rp ${(idr / 1_000).toFixed(0)}rb`;
    return `${sign}Rp ${idr.toLocaleString('id-ID')}`;
  } catch { return (usd >= 0 ? '+' : '') + '$' + Math.abs(usd || 0).toFixed(2); }
}

export default function PositionCard({ position, currentPrice }) {
  const isBuy    = position.direction === 'buy';
  const pip      = position.instrument?.includes('JPY') ? 0.01 : 0.0001;
  const pnlPips  = isBuy
    ? (currentPrice - position.entryPrice) / pip
    : (position.entryPrice - currentPrice) / pip;
  const pnlUSD   = pnlPips * (position.lots || 0.01) * 10 * 0.01;
  const isProfit = pnlPips >= 0;
  const holdMins = Math.round((Date.now() - position.openTime) / 60000);

  // Progress to TP
  const tpDist   = Math.abs(position.takeProfit - position.entryPrice);
  const curDist  = isBuy
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;
  const progress = tpDist > 0 ? Math.max(0, Math.min(100, (curDist / tpDist) * 100)) : 0;

  return (
    <div className={`rounded-2xl border p-4 ${isProfit ? 'border-emerald-700/50 bg-emerald-900/10' : 'border-red-700/50 bg-red-900/10'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
            {isBuy ? <TrendingUp size={16} className="text-emerald-400"/> : <TrendingDown size={16} className="text-red-400"/>}
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm">{position.instrument?.replace('_', '/')}</div>
            <div className={`text-xs font-semibold ${isBuy ? 'text-emerald-400' : 'text-red-400'}`}>
              {isBuy ? '▲ BUY' : '▼ SELL'} {position.lots}lot
            </div>
          </div>
        </div>
        <div className="text-right">
          {/* PnL dalam IDR — utama */}
          <div className={`font-bold text-base mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmtIDR(pnlUSD)}
          </div>
          {/* Pips + USD kecil di bawah */}
          <div className={`text-xs mono ${isProfit ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmtPips(pnlPips)} · {(pnlUSD >= 0 ? '+' : '')}${Math.abs(pnlUSD).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-slate-500 mb-0.5">Entry</div>
          <div className="text-slate-200 mono font-medium">{fmtPrice(position.entryPrice, position.instrument)}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-slate-500 mb-0.5">SL</div>
          <div className="text-red-400 mono font-medium">{fmtPrice(position.stopLoss, position.instrument)}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-2 text-center">
          <div className="text-slate-500 mb-0.5">TP</div>
          <div className="text-emerald-400 mono font-medium">{fmtPrice(position.takeProfit, position.instrument)}</div>
        </div>
      </div>

      {/* Progress bar ke TP */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          <span>Progress ke TP</span>
          <span>{progress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width:`${progress}%`, background: isProfit ? '#10b981' : '#ef4444' }}/>
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-slate-500 flex-wrap gap-1">
        <span className="flex items-center gap-1"><Clock size={11}/> {holdMins}m</span>
        {position.momentumGrade && <span className="bg-slate-700/50 px-2 py-0.5 rounded-full">Grade {position.momentumGrade}</span>}
        {position.tp1Triggered && <span className="text-amber-400 font-semibold">TP1 ✓</span>}
        {position.breakevenSet  && <span className="text-sky-400 font-semibold">BE ✓</span>}
        {position.riskReward    && <span>R:R {position.riskReward}x</span>}
      </div>
    </div>
  );
}

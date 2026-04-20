'use client';
import { Trash2, TrendingUp, TrendingDown } from 'lucide-react';

const IDR_RATE = () => {
  try { return parseInt(localStorage.getItem('ft_idr_rate') || '16000'); }
  catch { return 16000; }
};

function fmtIDR(usd) {
  try {
    const rate = IDR_RATE();
    const idr  = Math.round((usd || 0) * rate);
    const sign = usd >= 0 ? '+' : '';
    if (Math.abs(idr) >= 1_000_000) return `${sign}Rp ${(idr / 1_000_000).toFixed(2)}jt`;
    if (Math.abs(idr) >= 1_000)    return `${sign}Rp ${(idr / 1_000).toFixed(0)}rb`;
    return `${sign}Rp ${idr.toLocaleString('id-ID')}`;
  } catch { return `$${(usd||0).toFixed(2)}`; }
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short' });
}

export default function TradeLog({ trades = [], onDelete, onClearAll }) {
  if (!trades.length) return (
    <div className="text-center py-10 text-slate-600">
      <TrendingUp size={32} className="mx-auto mb-2 opacity-30"/>
      <p className="text-sm">Belum ada trade</p>
    </div>
  );

  return (
    <div>
      {onClearAll && trades.length > 0 && (
        <div className="flex justify-end mb-2">
          <button onClick={onClearAll} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
            <Trash2 size={12}/> Hapus Semua
          </button>
        </div>
      )}
      <div className="space-y-2">
        {trades.map((t) => {
          const isProfit = (t.pnlUSD || 0) >= 0;
          const isBuy    = t.direction === 'buy';
          const reasonLabel = {
            take_profit : '🎯 TP',
            stop_loss   : '🛑 SL',
            partial_tp  : '½TP',
            time_exit   : '⏰ Time',
            smart_exit  : '🧠 Smart',
          }[t.reason] || (t.reason || '').replace(/_/g,' ');

          return (
            <div key={t.id} className={`rounded-xl border p-3 flex items-center gap-3 ${isProfit ? 'border-emerald-800/40 bg-emerald-900/10' : 'border-red-800/40 bg-red-900/10'}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isBuy ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
                {isBuy ? <TrendingUp size={13} className="text-emerald-400"/> : <TrendingDown size={13} className="text-red-400"/>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-slate-200">{(t.instrument || '').replace('_','/')}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${isBuy ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
                    {isBuy ? 'BUY' : 'SELL'}
                  </span>
                  <span className="text-xs text-slate-600">{t.lots}lot</span>
                  {t.reason && <span className="text-xs text-slate-600">{reasonLabel}</span>}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {fmtDate(t.closeTime)} {fmtTime(t.closeTime)}
                  {t.duration != null ? ` · ${t.duration}m` : ''}
                  {t.pnlPips != null ? ` · ${t.pnlPips >= 0 ? '+' : ''}${(t.pnlPips||0).toFixed(1)}p` : ''}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-sm font-bold mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtIDR(t.pnlUSD)}
                </div>
                <div className={`text-xs text-slate-600 mono`}>
                  {(t.pnlUSD >= 0 ? '+' : '')}${Math.abs(t.pnlUSD || 0).toFixed(2)}
                </div>
              </div>
              {onDelete && (
                <button onClick={() => onDelete(t.id)} className="text-slate-700 hover:text-red-400 shrink-0">
                  <Trash2 size={13}/>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

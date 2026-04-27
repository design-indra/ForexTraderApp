'use client';
import { Lock, MessageCircle, Clock, LogOut } from 'lucide-react';

export default function SubscriptionExpired({ email, onLogout }) {
  const WA_NUMBER  = '6283803888990';
  const WA_MESSAGE = encodeURIComponent(
    `Halo Admin ForexTrader,\nSaya ingin mengaktifkan subscription.\nEmail: ${email}\nMohon bantuannya. Terima kasih.`
  );
  const waLink = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface)' }}>
      <div className="w-full max-w-sm text-center">

        <div className="w-24 h-24 mx-auto mb-6 rounded-3xl flex items-center justify-center shadow-2xl bg-red-950/60 border border-red-800/50">
          <Lock size={40} className="text-red-400"/>
        </div>

        <h2 className="text-xl font-bold text-slate-100 mb-2">Akses Tidak Aktif</h2>
        <p className="text-slate-400 text-sm mb-1">
          Halo, <span className="text-slate-200 font-semibold">{email}</span>
        </p>
        <p className="text-slate-500 text-sm mb-8 leading-relaxed">
          Subscription Anda belum aktif atau sudah expired.<br/>
          Hubungi admin untuk mengaktifkan akses trading.
        </p>

        <div className="rounded-2xl border border-slate-700 p-4 mb-6 text-left space-y-3" style={{ background: 'var(--surface-2)' }}>
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Paket Tersedia</p>
          {[
            { label:'1 Bulan',  tag: null },
            { label:'3 Bulan',  tag: 'Hemat' },
            { label:'12 Bulan', tag: 'Best Value' },
          ].map(plan => (
            <div key={plan.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-emerald-400"/>
                <span className="text-sm text-slate-200">{plan.label}</span>
                {plan.tag && (
                  <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded-full">{plan.tag}</span>
                )}
              </div>
              <span className="text-xs text-slate-500">Hubungi Admin</span>
            </div>
          ))}
        </div>

        <a href={waLink} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold text-sm text-white mb-3 active:scale-95 transition-transform"
          style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)' }}>
          <MessageCircle size={18}/>
          Hubungi Admin via WhatsApp
        </a>

        <button onClick={onLogout}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm text-slate-400 border border-slate-700 active:scale-95">
          <LogOut size={15}/>
          Logout
        </button>
      </div>
    </div>
  );
}

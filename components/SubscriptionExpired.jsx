'use client';
import { useState } from 'react';
import { Lock, MessageCircle, Clock, LogOut, QrCode, ChevronLeft, Copy, CheckCircle, ArrowRight, Tag } from 'lucide-react';

// ─── Konfigurasi Admin ────────────────────────────────────────────────────────
const ADMIN_WA = '6283803888990';
const ADMIN_NAME = 'Indra Alexander';

// ─── Data Paket ───────────────────────────────────────────────────────────────
const PAKETS = [
  {
    id       : '1bulan',
    label    : '1 Bulan',
    months   : 1,
    harga    : 49000,
    hargaStr : 'Rp 49.000',
    tag      : null,
    tagColor : null,
    qris     : '/qris-1bulan.jpg',
    desc     : 'Cocok untuk coba-coba',
  },
  {
    id       : '3bulan',
    label    : '3 Bulan',
    months   : 3,
    harga    : 119000,
    hargaStr : 'Rp 119.000',
    tag      : 'Hemat 19%',
    tagColor : 'emerald',
    qris     : '/qris-3bulan.jpg',
    desc     : 'Paling populer',
  },
  {
    id       : '6bulan',
    label    : '6 Bulan',
    months   : 6,
    harga    : 199000,
    hargaStr : 'Rp 199.000',
    tag      : 'Hemat 32%',
    tagColor : 'blue',
    qris     : '/qris-6bulan.jpg',
    desc     : 'Trader serius',
  },
  {
    id       : '12bulan',
    label    : '12 Bulan',
    months   : 12,
    harga    : 349000,
    hargaStr : 'Rp 349.000',
    tag      : 'Best Value',
    tagColor : 'amber',
    qris     : '/qris-12bulan.jpg',
    desc     : 'Hemat maksimal',
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────
function fmtRp(num) {
  return 'Rp ' + num.toLocaleString('id-ID');
}

function buildWaMessage(email, paket) {
  return encodeURIComponent(
    `Halo Admin ForexTrader! 👋\n\n` +
    `Saya sudah melakukan pembayaran paket:\n` +
    `📦 Paket   : ${paket.label}\n` +
    `💰 Nominal : ${paket.hargaStr}\n` +
    `📧 Email   : ${email}\n\n` +
    `Mohon segera diaktifkan. Terima kasih! 🙏`
  );
}

// ─── Tag Badge ────────────────────────────────────────────────────────────────
function TagBadge({ tag, color }) {
  const colors = {
    emerald : 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50',
    blue    : 'bg-blue-900/50 text-blue-400 border-blue-800/50',
    amber   : 'bg-amber-900/50 text-amber-400 border-amber-800/50',
  };
  return (
    <span className={`text-xs border px-2 py-0.5 rounded-full font-semibold ${colors[color] || colors.emerald}`}>
      {tag}
    </span>
  );
}

// ─── Halaman Utama — Pilih Paket ──────────────────────────────────────────────
function PilihPaket({ email, onPilih, onLogout }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface)' }}>
      <div className="w-full max-w-sm">

        {/* Icon + Judul */}
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl flex items-center justify-center shadow-2xl bg-red-950/60 border border-red-800/50">
            <Lock size={36} className="text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-1">Akses Tidak Aktif</h2>
          <p className="text-slate-400 text-sm">
            Halo, <span className="text-slate-200 font-semibold">{email}</span>
          </p>
          <p className="text-slate-500 text-xs mt-1">
            Pilih paket untuk mulai trading otomatis
          </p>
        </div>

        {/* Label Early Bird */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <Tag size={13} className="text-amber-400" />
          <span className="text-xs text-amber-400 font-semibold">🎉 Harga Early Bird — Terbatas!</span>
        </div>

        {/* Daftar Paket */}
        <div className="space-y-3 mb-5">
          {PAKETS.map(paket => (
            <button
              key={paket.id}
              onClick={() => onPilih(paket)}
              className="w-full rounded-2xl border border-slate-700 p-4 text-left hover:border-emerald-600 active:scale-98 transition-all group"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-900/40 border border-emerald-800/40 flex items-center justify-center shrink-0">
                    <Clock size={18} className="text-emerald-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-100">{paket.label}</span>
                      {paket.tag && <TagBadge tag={paket.tag} color={paket.tagColor} />}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{paket.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-400">{paket.hargaStr}</p>
                    <p className="text-xs text-slate-600">
                      ~{fmtRp(Math.round(paket.harga / paket.months))}/bln
                    </p>
                  </div>
                  <ArrowRight size={14} className="text-slate-600 group-hover:text-emerald-400 transition-colors" />
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm text-slate-500 border border-slate-800 hover:border-slate-600 transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </div>
  );
}

// ─── Halaman Pembayaran QRIS ──────────────────────────────────────────────────
function HalamanPembayaran({ email, paket, onKembali, onLogout }) {
  const [copied,  setCopied]  = useState(false);
  const [sudahBayar, setSudahBayar] = useState(false);

  const waLink = `https://wa.me/${ADMIN_WA}?text=${buildWaMessage(email, paket)}`;

  const handleCopyNominal = () => {
    navigator.clipboard.writeText(String(paket.harga)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSudahBayar = () => {
    setSudahBayar(true);
    // Langsung buka WA
    window.open(waLink, '_blank');
  };

  return (
    <div className="min-h-screen p-4 pb-8" style={{ background: 'var(--surface)' }}>
      <div className="w-full max-w-sm mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pt-2">
          <button
            onClick={onKembali}
            className="w-9 h-9 rounded-xl border border-slate-700 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
            style={{ background: 'var(--surface-2)' }}
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-100">Pembayaran QRIS</h2>
            <p className="text-xs text-slate-500">Paket {paket.label} — {paket.hargaStr}</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {['Scan QRIS', 'Transfer', 'Konfirmasi WA'].map((step, i) => (
            <div key={step} className="flex items-center gap-1 flex-1">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                i === 0 ? 'bg-emerald-600 text-white' :
                i === 1 ? 'bg-emerald-600 text-white' :
                sudahBayar ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-500'
              }`}>
                {sudahBayar && i === 2 ? '✓' : i + 1}
              </div>
              <span className={`text-xs ${i <= 1 || sudahBayar ? 'text-slate-300' : 'text-slate-600'}`}>{step}</span>
              {i < 2 && <div className="flex-1 h-px bg-slate-700 mx-1" />}
            </div>
          ))}
        </div>

        {/* QRIS Image */}
        <div
          className="rounded-2xl border border-slate-700 p-4 mb-4 text-center"
          style={{ background: 'var(--surface-2)' }}
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <QrCode size={16} className="text-emerald-400" />
            <span className="text-sm font-semibold text-slate-200">Scan QRIS untuk Bayar</span>
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-2xl p-3 mx-auto inline-block mb-3 shadow-lg">
            <img
              src={paket.qris}
              alt={`QRIS ${paket.label}`}
              className="w-52 h-52 object-contain"
              onError={(e) => {
                // Fallback jika gambar tidak ditemukan
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            {/* Fallback placeholder */}
            <div
              className="w-52 h-52 items-center justify-center text-slate-400 text-xs text-center p-4"
              style={{ display: 'none' }}
            >
              <QrCode size={48} className="mx-auto mb-2 opacity-30" />
              <p>Gambar QRIS tidak ditemukan</p>
              <p className="text-xs mt-1 opacity-60">Pastikan file qris-{paket.id}.jpg ada di folder public/</p>
            </div>
          </div>

          {/* Nama penerima */}
          <p className="text-xs text-slate-500 mb-1">Pembayaran ke</p>
          <p className="text-sm font-bold text-slate-100">{ADMIN_NAME}</p>
          <p className="text-xs text-slate-500 mt-0.5">NMID: ID1025412021962</p>
        </div>

        {/* Nominal */}
        <div
          className="rounded-2xl border border-emerald-800/40 p-4 mb-4"
          style={{ background: 'var(--surface-2)' }}
        >
          <p className="text-xs text-slate-500 mb-1">Nominal yang harus dibayar</p>
          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-emerald-400">{paket.hargaStr}</p>
            <button
              onClick={handleCopyNominal}
              className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-600 rounded-lg px-3 py-1.5 hover:border-emerald-600 hover:text-emerald-400 transition-colors"
            >
              {copied
                ? <><CheckCircle size={12} className="text-emerald-400" /> Tersalin</>
                : <><Copy size={12} /> Salin</>
              }
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-1">Paket {paket.label} · Early Bird Price</p>
        </div>

        {/* Cara bayar */}
        <div
          className="rounded-2xl border border-slate-700 p-4 mb-5"
          style={{ background: 'var(--surface-2)' }}
        >
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">Cara Pembayaran</p>
          {[
            { no: '1', text: 'Buka aplikasi e-wallet atau m-banking kamu' },
            { no: '2', text: 'Pilih menu "Bayar" atau "Scan QR"' },
            { no: '3', text: `Scan QR di atas, pastikan nominal = ${paket.hargaStr}` },
            { no: '4', text: 'Selesaikan pembayaran' },
            { no: '5', text: 'Tap tombol "Saya Sudah Bayar" lalu kirim bukti ke WhatsApp admin' },
          ].map(item => (
            <div key={item.no} className="flex gap-3 mb-2.5 last:mb-0">
              <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0 mt-0.5">
                {item.no}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>

        {/* Tombol Sudah Bayar */}
        <button
          onClick={handleSudahBayar}
          className="w-full py-4 rounded-2xl font-bold text-sm text-white mb-3 active:scale-95 transition-all shadow-lg"
          style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)' }}
        >
          <div className="flex items-center justify-center gap-2">
            <MessageCircle size={18} />
            ✅ Saya Sudah Bayar — Konfirmasi ke Admin
          </div>
        </button>

        {/* Info WA */}
        <div className="text-center mb-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Tombol di atas akan membuka WhatsApp dengan pesan otomatis berisi detail pembayaran kamu.
            Sertakan <span className="text-slate-400 font-medium">screenshot bukti transfer</span> agar admin bisa verifikasi lebih cepat.
          </p>
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm text-slate-600 hover:text-slate-400 transition-colors"
        >
          <LogOut size={14} />
          Logout
        </button>

      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
export default function SubscriptionExpired({ email, onLogout }) {
  const [selectedPaket, setSelectedPaket] = useState(null);

  if (selectedPaket) {
    return (
      <HalamanPembayaran
        email={email}
        paket={selectedPaket}
        onKembali={() => setSelectedPaket(null)}
        onLogout={onLogout}
      />
    );
  }

  return (
    <PilihPaket
      email={email}
      onPilih={setSelectedPaket}
      onLogout={onLogout}
    />
  );
}

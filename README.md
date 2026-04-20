# 📈 ForexTrader v2 — MONEX/MIFX Edition

Bot trading forex otomatis berbasis Next.js untuk broker **MONEX Investindo Futures (mifx.com)** dengan tampilan saldo **IDR (Rupiah)**.

---

## ✨ Perubahan Utama v2

| Fitur | v1 (OANDA) | v2 (MONEX) |
|---|---|---|
| Broker | OANDA | **MONEX / MIFX Indonesia** |
| Input API Key | File `.env` / Railway env vars | **Form langsung di dashboard Setup** |
| Tampilan Saldo | USD | **IDR (Rupiah)** |
| Kurs | N/A | Konfigurasi di menu Setup |
| Win Multiplier | ❌ | ✅ Anti-martingale lot scaling |
| Compound Mode | ❌ | ✅ Lot naik seiring profit |
| Double Confirm | ❌ | ✅ 2 siklus sinyal sama = entry |
| Breakeven+ | Basic | ✅ Buffer pip konfigurasi |

---

## 🚀 Deploy ke Railway

```bash
# 1. Push ke GitHub
git add .
git commit -m "ForexTrader v2 MONEX"
git push

# 2. Railway: tambah env vars minimal
AUTH_EMAIL=admin@kamu.app
AUTH_PASSWORD=password_kamu
```

**MONEX API Key tidak perlu di Railway env vars** — isi langsung di menu Setup dashboard.

---

## ⚙️ Cara Setup API Key MONEX

1. Login ke [mifx.com](https://mifx.com)
2. Menu **Akun → API Access**
3. Generate API Key baru
4. Copy **Account ID** dari halaman profil
5. Buka dashboard ForexTrader → menu **Setup (⚙️)**
6. Isi form API Key, Account ID, pilih Live/Demo
7. Klik **Test Koneksi** — jika berhasil saldo akan tampil

---

## 💡 Fitur Profit Booster

### Win Multiplier (Anti-Martingale)
Lot dinaikkan otomatis saat win streak. Kebalikan martingale — lebih aman karena hanya scaling saat kondisi bagus.
- Contoh: Win 3×, faktor 1.25× → lot ×1.56 (capped max 2×)
- Setting di menu **Risk → Profit Booster**

### Compound Mode
Lot dihitung dari **saldo berjalan**, bukan modal awal. Profit langsung di-compound ke lot berikutnya.

### Double Confirmation
Entry hanya jika sinyal yang **sama** muncul di **2 siklus berturut-turut**. Drastis mengurangi false signal.

### Breakeven+ Buffer
SL digeser ke entry + N pips (bukan tepat entry). Memberikan buffer kecil agar tidak kena SL akibat spread/slippage.

---

## 📊 5 Level Strategi

| Level | Nama | Kecepatan | Deskripsi |
|---|---|---|---|
| 1 | Scalper ⚡ | Cepat | RSI7 + EMA Ribbon |
| 2 | Smart 🧠 | Sedang | Market filter + confidence score |
| 3 | AI Score 📊 | Sedang | Multi-indicator scoring |
| 4 | Adaptive 🤖 | Lambat | ATR + S/R adaptive |
| 5 | Full Context 🔴 | Paling lambat | Semua filter + divergence |

---

## 🛡️ Risk Management

- Max 1 posisi sekaligus
- Auto-pause setelah N loss berturut
- Pair blacklist otomatis (1 jam)
- Trailing stop
- Partial TP (tutup 50% di TP1)
- Time-based exit (maks hold 4 jam)
- Smart exit (keluar jika sinyal berbalik)

---

## 📱 Stack

- **Frontend**: Next.js 15 + Tailwind CSS (PWA)
- **Backend**: Next.js API Routes
- **Broker**: MONEX / MIFX via REST API
- **Deploy**: Railway / Vercel
- **Storage**: localStorage (credentials + demo state)

---

> ⚠️ **Disclaimer**: Bot ini untuk tujuan edukasi. Trading forex mengandung risiko tinggi. Gunakan modal yang siap hilang.

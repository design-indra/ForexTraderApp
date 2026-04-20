/**
 * app/api/balance/route.js
 * Ambil saldo MONEX/MIFX menggunakan credentials dari frontend
 */
import { NextResponse } from 'next/server';
import { getAccountBalance } from '../../../lib/monex.js';

export async function POST(req) {
  try {
    const { mode, credentials } = await req.json().catch(() => ({}));

    if (mode === 'demo') {
      return NextResponse.json({ success: true, balance: null, mode: 'demo' });
    }

    if (!credentials?.apiKey || !credentials?.accountId) {
      return NextResponse.json({
        success: false,
        error  : 'Credentials belum dikonfigurasi — isi API Key di menu Setup',
      });
    }

    const balance = await getAccountBalance(credentials);
    if (!balance) {
      return NextResponse.json({
        success: false,
        error  : 'Gagal ambil saldo MONEX — cek API Key & Account ID',
      });
    }

    return NextResponse.json({ success: true, balance, mode });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// GET fallback (demo only)
export async function GET() {
  return NextResponse.json({ success: true, balance: null, mode: 'demo' });
}

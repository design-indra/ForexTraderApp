/**
 * app/api/broker/route.js
 * Test koneksi dan ambil info akun MONEX/MIFX
 * Credentials dikirim dari frontend (bukan env vars)
 */
import { NextResponse } from 'next/server';
import { testConnection, getAccountBalance } from '../../../lib/monex.js';

export async function POST(req) {
  try {
    const body        = await req.json().catch(() => ({}));
    const { action, credentials } = body;

    if (!credentials?.apiKey || !credentials?.accountId) {
      return NextResponse.json({
        success: false,
        error  : 'API Key dan Account ID wajib diisi',
      });
    }

    switch (action) {
      case 'test': {
        const result = await testConnection(credentials);
        return NextResponse.json(result);
      }

      case 'balance': {
        const balance = await getAccountBalance(credentials);
        if (!balance) return NextResponse.json({ success: false, error: 'Gagal ambil saldo' });
        return NextResponse.json({ success: true, balance });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

const AUTH_EMAIL    = process.env.AUTH_EMAIL    || 'admin@forextrader.app';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'forextrader123';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    if (email === AUTH_EMAIL && password === AUTH_PASSWORD) {
      return NextResponse.json({ success: true, token: 'ft_' + Date.now(), email });
    }
    return NextResponse.json({ success: false, error: 'Email atau password salah' }, { status: 401 });
  } catch {
    return NextResponse.json({ success: false, error: 'Request tidak valid' }, { status: 400 });
  }
}

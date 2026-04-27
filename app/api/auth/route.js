import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '../../../lib/supabase.js';
import { signToken, isSubscriptionActive, daysRemaining } from '../../../lib/auth.js';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    if (!email || !password)
      return NextResponse.json({ success: false, error: 'Email dan password wajib diisi' }, { status: 400 });

    const { data: user, error } = await supabase
      .from('users').select('*').eq('email', email.toLowerCase().trim()).single();

    if (error || !user)
      return NextResponse.json({ success: false, error: 'Email atau password salah' }, { status: 401 });

    if (!user.is_active)
      return NextResponse.json({ success: false, error: 'Akun Anda dinonaktifkan. Hubungi admin.' }, { status: 403 });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return NextResponse.json({ success: false, error: 'Email atau password salah' }, { status: 401 });

    supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id).then(() => {});

    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    const subActive = isSubscriptionActive(user);
    const days = daysRemaining(user);

    return NextResponse.json({
      success: true, token,
      email: user.email, name: user.name || '', role: user.role,
      subscriptionActive: subActive, subscriptionEnd: user.subscription_end || null,
      subscriptionStatus: user.subscription_status, daysRemaining: days,
    });
  } catch (err) {
    console.error('[AUTH]', err);
    return NextResponse.json({ success: false, error: 'Server error.' }, { status: 500 });
  }
}

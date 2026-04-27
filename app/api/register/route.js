import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabase } from '../../../lib/supabase.js';

export async function POST(req) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name)
      return NextResponse.json({ success: false, error: 'Nama, email, dan password wajib diisi' }, { status: 400 });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ success: false, error: 'Format email tidak valid' }, { status: 400 });

    if (password.length < 8)
      return NextResponse.json({ success: false, error: 'Password minimal 8 karakter' }, { status: 400 });

    if (name.trim().length < 2)
      return NextResponse.json({ success: false, error: 'Nama minimal 2 karakter' }, { status: 400 });

    const cleanEmail = email.toLowerCase().trim();

    const { data: existing } = await supabase.from('users').select('id').eq('email', cleanEmail).maybeSingle();
    if (existing)
      return NextResponse.json({ success: false, error: 'Email sudah terdaftar. Silakan login.' }, { status: 409 });

    const password_hash = await bcrypt.hash(password, 12);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({ email: cleanEmail, password_hash, name: name.trim(), role: 'user', subscription_status: 'inactive', is_active: true })
      .select('id, email, name')
      .single();

    if (insertError) {
      console.error('[REGISTER]', insertError);
      return NextResponse.json({ success: false, error: 'Gagal menyimpan akun. Coba lagi.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Akun berhasil dibuat! Hubungi admin untuk aktivasi subscription.',
      email: newUser.email,
    });

  } catch (err) {
    console.error('[REGISTER]', err);
    return NextResponse.json({ success: false, error: 'Server error.' }, { status: 500 });
  }
}

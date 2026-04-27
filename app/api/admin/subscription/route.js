import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase.js';
import { verifyToken } from '../../../../lib/auth.js';

function getAdmin(req) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'admin') return null;
  return decoded;
}

export async function GET(req) {
  if (!getAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, name, role, subscription_status, subscription_start, subscription_end, subscription_plan, created_at, last_login, is_active')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, users });
}

export async function POST(req) {
  if (!getAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  try {
    const { userId, planMonths = 1 } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId wajib' }, { status: 400 });

    const { data: u } = await supabase.from('users').select('subscription_end, subscription_status').eq('id', userId).single();
    let startDate = new Date();
    if (u?.subscription_status === 'active' && u?.subscription_end && new Date(u.subscription_end) > new Date())
      startDate = new Date(u.subscription_end);

    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + Number(planMonths));
    const planLabel = planMonths==1?'monthly':planMonths==3?'quarterly':planMonths==6?'semi-annual':planMonths==12?'yearly':`${planMonths}-months`;

    const { error } = await supabase.from('users').update({
      subscription_status: 'active', subscription_start: startDate.toISOString(),
      subscription_end: endDate.toISOString(), subscription_plan: planLabel,
    }).eq('id', userId);

    if (error) throw error;
    return NextResponse.json({ success: true, message: `✅ Subscription aktif ${planMonths} bulan (s/d ${endDate.toLocaleDateString('id-ID')})`, subscriptionEnd: endDate.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!getAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  try {
    const { userId } = await req.json();
    const { error } = await supabase.from('users').update({ subscription_status: 'inactive' }).eq('id', userId);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Subscription dinonaktifkan' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

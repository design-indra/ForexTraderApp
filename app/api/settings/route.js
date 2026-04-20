import { NextResponse } from 'next/server';
import { getRiskSettings, updateRiskSettings } from '../../../lib/riskManager.js';

export async function GET() {
  return NextResponse.json({ success: true, risk: getRiskSettings() });
}

export async function POST(req) {
  try {
    const body    = await req.json();
    const updated = updateRiskSettings(body);
    return NextResponse.json({ success: true, risk: updated });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 });
  }
}

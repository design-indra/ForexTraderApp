/**
 * app/api/broker/route.js
 * Multi-broker: OANDA, MetaApi, Demo
 */
import { NextResponse } from 'next/server';
import { testConnection, getAccountBalance, BROKER_LIST } from '../../../lib/brokerClient.js';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action, brokerConfig } = body;
    const config = brokerConfig || { brokerId: 'demo', credentials: body.credentials || {} };

    switch (action) {
      case 'list':
        return NextResponse.json({ success: true, brokers: BROKER_LIST });

      case 'test': {
        if (config.brokerId === 'demo') {
          return NextResponse.json({ success: true, message: 'Mode Demo aktif — tidak butuh API Key', balance: null });
        }
        const broker = BROKER_LIST.find(b => b.id === config.brokerId);
        if (!broker) return NextResponse.json({ success: false, error: 'Broker tidak dikenal' });
        const missing = broker.fields
          .filter(f => f.required && !config.credentials?.[f.key])
          .map(f => f.label);
        if (missing.length) {
          return NextResponse.json({ success: false, error: `Field wajib belum diisi: ${missing.join(', ')}` });
        }
        const result = await testConnection(config);
        return NextResponse.json(result);
      }

      case 'balance': {
        if (config.brokerId === 'demo') return NextResponse.json({ success: false, error: 'Demo mode tidak punya saldo broker' });
        const balance = await getAccountBalance(config);
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

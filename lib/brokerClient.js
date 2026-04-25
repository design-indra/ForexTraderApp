/**
 * lib/brokerClient.js — Multi-Broker Client
 *
 * Mendukung 3 broker:
 *  1. OANDA       — REST API publik, terbaik untuk algo trading
 *  2. MetaApi     — Bridge ke MT4/MT5 (termasuk MIFX, GKInvest, dll)
 *  3. MIFX/Demo   — Mode demo internal (tanpa API key)
 *
 * Semua fungsi return format yang sama sehingga tradingEngine
 * tidak perlu tahu broker mana yang aktif.
 */

// ─── Konstanta ────────────────────────────────────────────────────────────────
export const BROKER_LIST = [
  {
    id         : 'demo',
    name       : 'Demo Internal',
    shortName  : 'DEMO',
    logo       : '🤖',
    color      : '#10b981',
    description: 'Simulasi trading tanpa API key — cocok untuk testing strategi',
    fields     : [],
    bappebti   : false,
    apiDocs    : null,
  },
  {
    id         : 'oanda',
    name       : 'OANDA',
    shortName  : 'OANDA',
    logo       : '🌐',
    color      : '#f59e0b',
    description: 'REST API terlengkap untuk algo trading. Regulasi FCA/CFTC. Akun Forex global.',
    fields     : [
      { key: 'accountId',   label: 'Account ID',   placeholder: '001-001-XXXXXXX-001', type: 'text',     required: true  },
      { key: 'apiKey',      label: 'API Key',       placeholder: 'Bearer token dari OANDA portal',        type: 'password', required: true  },
      { key: 'environment', label: 'Environment',   placeholder: '',                    type: 'select',   required: true,
        options: [{ value: 'practice', label: '🟢 Practice (Demo)' }, { value: 'live', label: '🔴 Live' }] },
    ],
    bappebti   : false,
    apiDocs    : 'https://developer.oanda.com/rest-live-v20/introduction/',
    guide      : [
      'Daftar akun di oanda.com',
      'Login → My Account → Manage API Access',
      'Klik "Generate" untuk buat API Key baru',
      'Copy Account ID dari halaman Account Summary',
    ],
  },
  {
    id         : 'metaapi',
    name       : 'MetaApi (MT4/MT5 Bridge)',
    shortName  : 'MetaApi',
    logo       : '🔗',
    color      : '#6366f1',
    description: 'Hubungkan bot ke akun MT4/MT5 broker manapun termasuk MIFX. Butuh akun MetaApi.cloud.',
    fields     : [
      { key: 'apiKey',     label: 'MetaApi Token',    placeholder: 'Token dari metaapi.cloud/token',   type: 'password', required: true  },
      { key: 'accountId', label: 'MetaApi Account ID', placeholder: 'UUID akun MT dari MetaApi dashboard', type: 'text', required: true },
    ],
    bappebti   : false,
    apiDocs    : 'https://metaapi.cloud/docs/client/restApi/',
    guide      : [
      'Daftar gratis di metaapi.cloud',
      'Tambah akun MT4/MT5 (masukkan login MIFX/GKInvest dll)',
      'Pergi ke menu "API → Tokens" → Generate token',
      'Copy Account ID dari halaman Accounts',
      'MetaApi akan sync otomatis ke akun MT Anda',
    ],
  },
];

export function getBrokerById(id) {
  return BROKER_LIST.find(b => b.id === id) || BROKER_LIST[0];
}

// ─── OANDA Client ─────────────────────────────────────────────────────────────
const OANDA_BASE = {
  practice : 'https://api-fxpractice.oanda.com',
  live     : 'https://api-fxtrade.oanda.com',
};

const OANDA_STREAM = {
  practice : 'https://stream-fxpractice.oanda.com',
  live     : 'https://stream-fxtrade.oanda.com',
};

async function oandaFetch(path, opts = {}, creds = {}) {
  const env  = creds.environment || 'practice';
  const base = OANDA_BASE[env] || OANDA_BASE.practice;
  const res  = await fetch(`${base}${path}`, {
    ...opts,
    headers: {
      'Authorization' : `Bearer ${creds.apiKey}`,
      'Content-Type'  : 'application/json',
      'Accept-Datetime-Format': 'UNIX',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.errorMessage || j.message || ''; } catch {}
    throw new Error(`OANDA ${res.status}: ${msg || res.statusText}`);
  }
  return res.json();
}

const TF_OANDA = { '1m':'M1','5m':'M5','15m':'M15','30m':'M30','1h':'H1','4h':'H4','1d':'D' };

async function oandaGetCandles(instrument, tf = '5m', count = 100, creds = {}) {
  const gran = TF_OANDA[tf] || 'M5';
  const sym  = instrument.replace('/', '_');
  const data = await oandaFetch(
    `/v3/instruments/${sym}/candles?granularity=${gran}&count=${count}&price=M`,
    {}, creds
  );
  return (data.candles || []).map(c => ({
    time  : Math.round(parseFloat(c.time) * 1000),
    open  : parseFloat(c.mid.o),
    high  : parseFloat(c.mid.h),
    low   : parseFloat(c.mid.l),
    close : parseFloat(c.mid.c),
    volume: c.volume || 0,
  }));
}

async function oandaGetBalance(creds = {}) {
  const data = await oandaFetch(`/v3/accounts/${creds.accountId}/summary`, {}, creds);
  const acc  = data.account || {};
  return {
    balance     : parseFloat(acc.balance      || 0),
    equity      : parseFloat(acc.NAV          || acc.balance || 0),
    unrealizedPL: parseFloat(acc.unrealizedPL || 0),
    marginUsed  : parseFloat(acc.marginUsed   || 0),
    marginFree  : parseFloat(acc.marginAvailable || 0),
    currency    : acc.currency || 'USD',
    leverage    : 50,
  };
}

async function oandaOpenTrade(instrument, units, stopLoss, takeProfit, creds = {}) {
  const sym  = instrument.replace('_', '').replace('/', '');
  const body = {
    order: {
      type       : 'MARKET',
      instrument : instrument.includes('/') ? instrument.replace('/', '_') : instrument,
      units      : String(units),
      timeInForce: 'FOK',
      positionFill: 'DEFAULT',
      ...(stopLoss   ? { stopLossOnFill   : { price: stopLoss.toFixed(5)   } } : {}),
      ...(takeProfit ? { takeProfitOnFill : { price: takeProfit.toFixed(5) } } : {}),
    }
  };
  return oandaFetch(`/v3/accounts/${creds.accountId}/orders`, {
    method: 'POST',
    body  : JSON.stringify(body),
  }, creds);
}

async function oandaCloseTrade(positionId, creds = {}) {
  return oandaFetch(
    `/v3/accounts/${creds.accountId}/trades/${positionId}/close`,
    { method: 'PUT', body: JSON.stringify({ units: 'ALL' }) },
    creds
  );
}

async function oandaGetTrades(creds = {}) {
  const data = await oandaFetch(`/v3/accounts/${creds.accountId}/openTrades`, {}, creds);
  return (data.trades || []).map(t => ({
    id          : t.id,
    instrument  : t.instrument,
    units       : parseInt(t.currentUnits),
    entryPrice  : parseFloat(t.price),
    openTime    : t.openTime,
    unrealizedPL: parseFloat(t.unrealizedPL || 0),
  }));
}

async function oandaTestConn(creds = {}) {
  const balance = await oandaGetBalance(creds);
  return { success: true, balance, message: `OANDA terhubung! Saldo: $${balance.balance.toFixed(2)}` };
}

// ─── MetaApi Client ───────────────────────────────────────────────────────────
const META_BASE = 'https://mt-client-api-v1.agiliumtrade.ai';

async function metaFetch(path, opts = {}, creds = {}) {
  const res = await fetch(`${META_BASE}${path}`, {
    ...opts,
    headers: {
      'auth-token'  : creds.apiKey,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.message || ''; } catch {}
    throw new Error(`MetaApi ${res.status}: ${msg || res.statusText}`);
  }
  return res.json();
}

const TF_META = { '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1d':'1d' };

async function metaGetCandles(instrument, tf = '5m', count = 100, creds = {}) {
  const sym  = instrument.replace('_', '').replace('/', '');
  const data = await metaFetch(
    `/users/current/accounts/${creds.accountId}/historical-market-data/symbols/${sym}/timeframes/${TF_META[tf]||'5m'}/candles?limit=${count}`,
    {}, creds
  );
  return (data || []).map(c => ({
    time  : new Date(c.time).getTime(),
    open  : parseFloat(c.open),
    high  : parseFloat(c.high),
    low   : parseFloat(c.low),
    close : parseFloat(c.close),
    volume: c.tickVolume || 0,
  })).reverse();
}

async function metaGetBalance(creds = {}) {
  const data = await metaFetch(`/users/current/accounts/${creds.accountId}/account-information`, {}, creds);
  return {
    balance     : parseFloat(data.balance      || 0),
    equity      : parseFloat(data.equity       || 0),
    unrealizedPL: parseFloat(data.profit       || 0),
    marginUsed  : parseFloat(data.margin       || 0),
    marginFree  : parseFloat(data.freeMargin   || 0),
    currency    : data.currency || 'USD',
    leverage    : parseInt(data.leverage || 100),
  };
}

async function metaOpenTrade(instrument, units, stopLoss, takeProfit, creds = {}) {
  const sym    = instrument.replace('_', '').replace('/', '');
  const isLong = units > 0;
  const body   = {
    symbol         : sym,
    actionType     : isLong ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
    volume         : Math.abs(units),
    comment        : 'ForexTraderBot',
    ...(stopLoss   ? { stopLoss   } : {}),
    ...(takeProfit ? { takeProfit } : {}),
  };
  return metaFetch(`/users/current/accounts/${creds.accountId}/trade`, {
    method: 'POST',
    body  : JSON.stringify(body),
  }, creds);
}

async function metaCloseTrade(positionId, creds = {}) {
  return metaFetch(`/users/current/accounts/${creds.accountId}/trade`, {
    method: 'POST',
    body  : JSON.stringify({ actionType: 'POSITION_CLOSE_ID', positionId }),
  }, creds);
}

async function metaGetTrades(creds = {}) {
  const data = await metaFetch(`/users/current/accounts/${creds.accountId}/positions`, {}, creds);
  return (data || []).map(t => ({
    id          : t.id,
    instrument  : t.symbol,
    units       : t.type === 'POSITION_TYPE_BUY' ? t.volume : -t.volume,
    entryPrice  : parseFloat(t.openPrice),
    openTime    : t.time,
    unrealizedPL: parseFloat(t.profit || 0),
  }));
}

async function metaTestConn(creds = {}) {
  const balance = await metaGetBalance(creds);
  return {
    success: true,
    balance,
    message: `MetaApi terhubung! Broker: ${balance.currency} akun. Saldo: $${balance.balance.toFixed(2)}`,
  };
}

// ─── Public API — dipanggil dari route.js & tradingEngine ────────────────────
/**
 * getCandles(instrument, tf, count, brokerConfig)
 * brokerConfig = { brokerId, credentials }
 */
export async function getCandles(instrument, tf = '5m', count = 100, brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaGetCandles(instrument, tf, count, credentials);
    case 'metaapi' : return metaGetCandles(instrument, tf, count, credentials);
    default        : return null; // demo → caller pakai demoStore candles
  }
}

export async function getAccountBalance(brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaGetBalance(credentials);
    case 'metaapi' : return metaGetBalance(credentials);
    default        : return null;
  }
}

export async function openTrade(instrument, units, stopLoss, takeProfit, brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaOpenTrade(instrument, units, stopLoss, takeProfit, credentials);
    case 'metaapi' : return metaOpenTrade(instrument, units, stopLoss, takeProfit, credentials);
    default        : throw new Error('Demo mode — gunakan demoStore.demoOpen()');
  }
}

export async function closeTrade(positionId, brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaCloseTrade(positionId, credentials);
    case 'metaapi' : return metaCloseTrade(positionId, credentials);
    default        : throw new Error('Demo mode — gunakan demoStore.demoClose()');
  }
}

export async function getOpenTrades(brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaGetTrades(credentials);
    case 'metaapi' : return metaGetTrades(credentials);
    default        : return [];
  }
}

export async function testConnection(brokerConfig = {}) {
  const { brokerId = 'demo', credentials = {} } = brokerConfig;
  switch (brokerId) {
    case 'oanda'   : return oandaTestConn(credentials);
    case 'metaapi' : return metaTestConn(credentials);
    default        : return { success: true, balance: null, message: 'Mode Demo aktif — tidak butuh API Key' };
  }
}

/**
 * lib/monex.js — MONEX / MIFX (MNC Investindo Futures) API Client
 *
 * Broker : MONEX Investindo Futures (mifx.com)
 * Platform: REST API dengan autentikasi API Key + Account ID
 *
 * Credentials dikirim dari frontend per-request (tidak perlu .env untuk broker)
 * Simpan di localStorage frontend: ft_monex_creds
 *
 * Format credentials:
 * {
 *   apiKey     : string   — API Key dari MONEX/MIFX dashboard
 *   accountId  : string   — Account Number / Login ID
 *   apiSecret  : string   — API Secret (optional, untuk HMAC signing)
 *   environment: 'live' | 'demo'   — tipe akun
 *   baseUrl    : string   — override base URL (default: https://api.mifx.com)
 * }
 */

// Pip values per instrument
export const PIP_VALUES = {
  'EUR_USD': 0.0001, 'GBP_USD': 0.0001, 'AUD_USD': 0.0001, 'NZD_USD': 0.0001,
  'USD_CAD': 0.0001, 'USD_CHF': 0.0001, 'EUR_GBP': 0.0001, 'EUR_JPY': 0.01,
  'GBP_JPY': 0.01,  'USD_JPY': 0.01,   'AUD_JPY': 0.01,   'CHF_JPY': 0.01,
  'EUR_CHF': 0.0001,'EUR_AUD': 0.0001, 'GBP_AUD': 0.0001, 'GBP_NZD': 0.0001,
  'XAU_USD': 0.01,  'XAG_USD': 0.001,
};

// Map instrument ke format MONEX (misal EUR_USD → EURUSD)
export function toMonexSymbol(instrument) {
  return instrument.replace('_', '');
}

// Format balik dari MONEX ke internal (EURUSD → EUR_USD)
export function fromMonexSymbol(symbol) {
  if (symbol.length === 6) return symbol.slice(0, 3) + '_' + symbol.slice(3);
  return symbol;
}

export function toInstrument(pair) {
  return pair.replace('/', '_').toUpperCase();
}

export function priceToPips(price, instrument) {
  const pip = PIP_VALUES[instrument] || 0.0001;
  return Math.round(price / pip);
}

export function pipsToPrice(pips, instrument) {
  const pip = PIP_VALUES[instrument] || 0.0001;
  return parseFloat((pips * pip).toFixed(5));
}

// ── HTTP helper ────────────────────────────────────────────────────────────────
async function monexFetch(path, options = {}, credentials = {}) {
  const {
    apiKey     = '',
    accountId  = '',
    apiSecret  = '',
    environment= 'demo',
    baseUrl    = 'https://api.mifx.com',
  } = credentials;

  if (!apiKey || !accountId) {
    throw new Error('MONEX credentials belum dikonfigurasi — isi di menu Setup');
  }

  const url = `${baseUrl}${path}`;

  const headers = {
    'Content-Type'  : 'application/json',
    'X-API-Key'     : apiKey,
    'X-Account-ID'  : accountId,
    'X-Environment' : environment,
    ...(apiSecret ? { 'X-API-Secret': apiSecret } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch {}
    throw new Error(`MONEX API error ${res.status}: ${errText || res.statusText}`);
  }

  return res.json();
}

// ── Granularity mapping ────────────────────────────────────────────────────────
// MONEX menggunakan format period dalam detik atau string
const GRANULARITY_MAP = {
  M1: '60',    M5: '300',   M15: '900',
  M30: '1800', H1: '3600',  H4: '14400', D: '86400',
};

// ─────────────────────────────────────────────────────────────────────────────
// OHLCV (candle data)
// ─────────────────────────────────────────────────────────────────────────────
export async function getOHLCV(instrument, granularity = 'M5', count = 100, credentials = {}) {
  try {
    const symbol  = toMonexSymbol(instrument);
    const period  = GRANULARITY_MAP[granularity] || '300';
    const data    = await monexFetch(
      `/v1/market/candles?symbol=${symbol}&period=${period}&count=${count}`,
      {},
      credentials,
    );

    // Normalisasi response — berbagai broker mungkin format berbeda
    const candles = (data.candles || data.data || data.result || []);
    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error('Empty candles response');
    }

    return candles.map(c => ({
      time  : typeof c.time === 'number' ? c.time * 1000 : new Date(c.time).getTime(),
      open  : parseFloat(c.open  || c.o),
      high  : parseFloat(c.high  || c.h),
      low   : parseFloat(c.low   || c.l),
      close : parseFloat(c.close || c.c),
      volume: parseInt(c.volume  || c.v || 0),
    }));
  } catch (err) {
    console.warn('[MONEX] getOHLCV fallback demo:', err.message);
    return generateDemoCandles(instrument, count);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Current price (ticker)
// ─────────────────────────────────────────────────────────────────────────────
export async function getTicker(instrument, credentials = {}) {
  try {
    const symbol = toMonexSymbol(instrument);
    const data   = await monexFetch(`/v1/market/price/${symbol}`, {}, credentials);
    const price  = data.price || data.data || data;
    const bid    = parseFloat(price.bid || price.Bid || 0);
    const ask    = parseFloat(price.ask || price.Ask || 0);
    return { bid, ask, mid: (bid + ask) / 2, spread: ask - bid, instrument };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account balance & info
// ─────────────────────────────────────────────────────────────────────────────
export async function getAccountBalance(credentials = {}) {
  try {
    const data = await monexFetch(`/v1/account/summary`, {}, credentials);
    const acc  = data.account || data.data || data;
    return {
      balance      : parseFloat(acc.balance      || acc.Balance      || 0),
      equity       : parseFloat(acc.equity        || acc.Equity        || acc.nav || 0),
      unrealizedPL : parseFloat(acc.unrealizedPL  || acc.FloatingPL    || 0),
      marginUsed   : parseFloat(acc.marginUsed    || acc.Margin        || 0),
      marginFree   : parseFloat(acc.marginFree    || acc.FreeMargin    || 0),
      currency     : acc.currency || acc.Currency || 'USD',
      leverage     : parseInt(acc.leverage        || acc.Leverage      || 100),
    };
  } catch (err) {
    console.error('[MONEX] getAccountBalance error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Buka market order
// ─────────────────────────────────────────────────────────────────────────────
export async function openTrade(instrument, units, stopLoss, takeProfit, credentials = {}) {
  const symbol    = toMonexSymbol(instrument);
  const direction = units > 0 ? 'buy' : 'sell';
  const volume    = Math.abs(units);

  const body = {
    symbol,
    direction,
    volume,
    orderType   : 'market',
    stopLoss    : stopLoss   ? parseFloat(stopLoss.toFixed(5))   : undefined,
    takeProfit  : takeProfit ? parseFloat(takeProfit.toFixed(5)) : undefined,
    timeInForce : 'FOK',
  };

  return monexFetch('/v1/order/create', {
    method: 'POST',
    body  : JSON.stringify(body),
  }, credentials);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutup posisi
// ─────────────────────────────────────────────────────────────────────────────
export async function closeTrade(positionId, credentials = {}) {
  return monexFetch(`/v1/order/close/${positionId}`, {
    method: 'PUT',
    body  : JSON.stringify({ volume: 'all' }),
  }, credentials);
}

// ─────────────────────────────────────────────────────────────────────────────
// Posisi terbuka
// ─────────────────────────────────────────────────────────────────────────────
export async function getOpenTrades(credentials = {}) {
  try {
    const data   = await monexFetch('/v1/order/open', {}, credentials);
    const trades = data.positions || data.orders || data.data || [];
    return trades.map(t => ({
      id          : t.id        || t.positionId || t.ticket,
      instrument  : fromMonexSymbol(t.symbol || t.Symbol),
      units       : parseInt(t.volume || t.Volume || 0),
      entryPrice  : parseFloat(t.openPrice || t.OpenPrice || t.entryPrice || 0),
      openTime    : t.openTime  || t.OpenTime,
      unrealizedPL: parseFloat(t.profit    || t.Profit    || 0),
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test koneksi — untuk tombol "Test Connection" di settings
// ─────────────────────────────────────────────────────────────────────────────
export async function testConnection(credentials = {}) {
  try {
    const balance = await getAccountBalance(credentials);
    if (!balance) return { success: false, error: 'Tidak dapat membaca saldo akun' };
    return { success: true, balance, message: 'Koneksi berhasil!' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Demo candle generator (fallback tanpa API key) ─────────────────────────────
function generateDemoCandles(instrument, count) {
  const pip    = PIP_VALUES[instrument] || 0.0001;
  const prices = {
    EUR_USD: 1.0850, GBP_USD: 1.2650, USD_JPY: 149.50,
    AUD_USD: 0.6550, XAU_USD: 2320.0, USD_CAD: 1.3600,
    GBP_JPY: 189.50, EUR_JPY: 162.10, USD_CHF: 0.8950,
  };
  let base   = prices[instrument] || 1.1000;
  const candles = [];
  const now     = Date.now();
  for (let i = count; i >= 0; i--) {
    const vol   = (Math.random() - 0.5) * pip * 30;
    const open  = base;
    const close = open + vol;
    const high  = Math.max(open, close) + Math.random() * pip * 10;
    const low   = Math.min(open, close) - Math.random() * pip * 10;
    candles.push({
      time  : now - i * 5 * 60000,
      open,
      high,
      low,
      close : parseFloat(close.toFixed(5)),
      volume: Math.floor(Math.random() * 1000) + 100,
    });
    base = parseFloat(close.toFixed(5));
  }
  return candles;
}

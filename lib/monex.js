/**
 * lib/monex.js — MONEX / MIFX API Client
 * Fix: generateDemoCandles harga realistis untuk semua pair
 */

export const PIP_VALUES = {
  'EUR_USD':0.0001,'GBP_USD':0.0001,'AUD_USD':0.0001,'NZD_USD':0.0001,
  'USD_CAD':0.0001,'USD_CHF':0.0001,'EUR_GBP':0.0001,'EUR_AUD':0.0001,
  'GBP_AUD':0.0001,'GBP_NZD':0.0001,'EUR_CHF':0.0001,
  'EUR_JPY':0.01,'GBP_JPY':0.01,'USD_JPY':0.01,'AUD_JPY':0.01,'CHF_JPY':0.01,
  'XAU_USD':0.10,'XAG_USD':0.01,
};

export function toMonexSymbol(i)    { return i.replace('_',''); }
export function fromMonexSymbol(s)  { return s.length===6 ? s.slice(0,3)+'_'+s.slice(3) : s; }
export function toInstrument(pair)  { return pair.replace('/','_').toUpperCase(); }
export function priceToPips(price,i){ return Math.round(price/(PIP_VALUES[i]||0.0001)); }
export function pipsToPrice(pips,i) { return parseFloat((pips*(PIP_VALUES[i]||0.0001)).toFixed(5)); }

async function monexFetch(path, options={}, credentials={}) {
  const { apiKey='', accountId='', apiSecret='', environment='demo', baseUrl='https://api.mifx.com' } = credentials;
  if (!apiKey || !accountId) throw new Error('MONEX credentials belum dikonfigurasi — isi di menu Setup');
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type':'application/json',
      'X-API-Key':apiKey,'X-Account-ID':accountId,'X-Environment':environment,
      ...(apiSecret?{'X-API-Secret':apiSecret}:{}),
      ...(options.headers||{}),
    },
  });
  if (!res.ok) { let t=''; try{t=await res.text();}catch{} throw new Error(`MONEX ${res.status}: ${t||res.statusText}`); }
  return res.json();
}

const GRAN = { M1:'60',M5:'300',M15:'900',M30:'1800',H1:'3600',H4:'14400',D:'86400' };

export async function getOHLCV(instrument, granularity='M5', count=100, credentials={}) {
  try {
    const data = await monexFetch(
      `/v1/market/candles?symbol=${toMonexSymbol(instrument)}&period=${GRAN[granularity]||'300'}&count=${count}`,
      {}, credentials,
    );
    const candles = data.candles || data.data || data.result || [];
    if (!Array.isArray(candles) || !candles.length) throw new Error('Empty candles');
    return candles.map(c => ({
      time  : typeof c.time==='number' ? c.time*1000 : new Date(c.time).getTime(),
      open  : parseFloat(c.open  ||c.o),
      high  : parseFloat(c.high  ||c.h),
      low   : parseFloat(c.low   ||c.l),
      close : parseFloat(c.close ||c.c),
      volume: parseInt(c.volume  ||c.v||0),
    }));
  } catch(err) {
    console.warn('[MONEX] getOHLCV fallback demo:', err.message);
    return generateDemoCandles(instrument, count);
  }
}

export async function getTicker(instrument, credentials={}) {
  try {
    const data  = await monexFetch(`/v1/market/price/${toMonexSymbol(instrument)}`,{},credentials);
    const price = data.price||data.data||data;
    const bid   = parseFloat(price.bid||price.Bid||0);
    const ask   = parseFloat(price.ask||price.Ask||0);
    return { bid,ask,mid:(bid+ask)/2,spread:ask-bid,instrument };
  } catch { return null; }
}

export async function getAccountBalance(credentials={}) {
  try {
    const data = await monexFetch('/v1/account/summary',{},credentials);
    const acc  = data.account||data.data||data;
    return {
      balance     : parseFloat(acc.balance      ||acc.Balance      ||0),
      equity      : parseFloat(acc.equity        ||acc.Equity       ||acc.nav||0),
      unrealizedPL: parseFloat(acc.unrealizedPL  ||acc.FloatingPL   ||0),
      marginUsed  : parseFloat(acc.marginUsed    ||acc.Margin       ||0),
      marginFree  : parseFloat(acc.marginFree    ||acc.FreeMargin   ||0),
      currency    : acc.currency||acc.Currency||'USD',
      leverage    : parseInt(acc.leverage||acc.Leverage||100),
    };
  } catch(err) { console.error('[MONEX] balance error:',err.message); return null; }
}

export async function openTrade(instrument, units, stopLoss, takeProfit, credentials={}) {
  return monexFetch('/v1/order/create',{
    method:'POST',
    body:JSON.stringify({
      symbol:toMonexSymbol(instrument),
      direction:units>0?'buy':'sell',
      volume:Math.abs(units),
      orderType:'market',
      stopLoss:stopLoss?parseFloat(stopLoss.toFixed(5)):undefined,
      takeProfit:takeProfit?parseFloat(takeProfit.toFixed(5)):undefined,
      timeInForce:'FOK',
    }),
  }, credentials);
}

export async function closeTrade(positionId, credentials={}) {
  return monexFetch(`/v1/order/close/${positionId}`,{method:'PUT',body:JSON.stringify({volume:'all'})},credentials);
}

export async function getOpenTrades(credentials={}) {
  try {
    const data  = await monexFetch('/v1/order/open',{},credentials);
    const trades= data.positions||data.orders||data.data||[];
    return trades.map(t=>({
      id          : t.id||t.positionId||t.ticket,
      instrument  : fromMonexSymbol(t.symbol||t.Symbol),
      units       : parseInt(t.volume||t.Volume||0),
      entryPrice  : parseFloat(t.openPrice||t.OpenPrice||t.entryPrice||0),
      openTime    : t.openTime||t.OpenTime,
      unrealizedPL: parseFloat(t.profit||t.Profit||0),
    }));
  } catch { return []; }
}

export async function testConnection(credentials={}) {
  try {
    const balance = await getAccountBalance(credentials);
    if (!balance) return { success:false, error:'Tidak dapat membaca saldo akun' };
    return { success:true, balance, message:'Koneksi berhasil!' };
  } catch(err) { return { success:false, error:err.message }; }
}

// ── Demo candle generator — harga REALISTIS untuk semua pair ──────────────────
const DEMO_PRICES = {
  EUR_USD:1.0850, GBP_USD:1.2650, USD_JPY:149.50, AUD_USD:0.6550,
  NZD_USD:0.6050, USD_CAD:1.3600, USD_CHF:0.8950, EUR_GBP:0.8550,
  EUR_JPY:162.10, GBP_JPY:189.50, AUD_JPY:97.80,  NZD_JPY:90.50,
  CHF_JPY:167.20, EUR_AUD:1.6400, EUR_CHF:0.9350,  GBP_AUD:1.9200,
  GBP_NZD:2.0900, EUR_NZD:1.7900, XAU_USD:2320.0, XAG_USD:27.50,
};

function generateDemoCandles(instrument, count) {
  const pip  = PIP_VALUES[instrument] || 0.0001;
  // Gunakan harga realistis — fallback 1.1000 hanya untuk pair tak dikenal
  let base   = DEMO_PRICES[instrument] || 1.1000;
  const candles = [];
  const now  = Date.now();
  // Volatilitas proporsional dengan harga pair
  const volatility = instrument.includes('JPY') ? pip * 80 :
                     instrument === 'XAU_USD'   ? 2.0       :
                     instrument === 'XAG_USD'   ? 0.05      : pip * 30;

  for (let i = count; i >= 0; i--) {
    const vol   = (Math.random() - 0.5) * volatility;
    const open  = base;
    const close = parseFloat((open + vol).toFixed(instrument.includes('JPY') ? 3 : 5));
    const high  = parseFloat((Math.max(open,close) + Math.random() * volatility * 0.5).toFixed(instrument.includes('JPY') ? 3 : 5));
    const low   = parseFloat((Math.min(open,close) - Math.random() * volatility * 0.5).toFixed(instrument.includes('JPY') ? 3 : 5));
    candles.push({ time:now-i*5*60000, open, high, low, close, volume:Math.floor(Math.random()*1000)+100 });
    base = close;
  }
  return candles;
}

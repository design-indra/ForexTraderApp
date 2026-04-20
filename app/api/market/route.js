import { NextResponse } from 'next/server';
import { getOHLCV, getTicker } from '../../../lib/monex.js';
import {
  getLatestRSI, getLatestEMA, calculateMACD, calculateBollingerBands,
  detectMarketTrend, calculateATR, calculateMomentumScore, calculateStochRSI,
} from '../../../lib/indicators.js';

const TF_MAP = {
  '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
  '1h': 'H1', '4h': 'H4', '1d': 'D',
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const instrument  = searchParams.get('instrument') || 'EUR_USD';
  const tf          = searchParams.get('tf') || '5m';
  const count       = parseInt(searchParams.get('count') || '100');
  const granularity = TF_MAP[tf] || 'M5';

  // Credentials bisa dikirim via header (opsional, untuk market data live)
  // Jika tidak ada, fallback ke demo candles otomatis di monex.js
  const credentials = {};

  try {
    const [candles, ticker] = await Promise.all([
      getOHLCV(instrument, granularity, count, credentials),
      getTicker(instrument, credentials),
    ]);

    if (!candles || candles.length < 2) {
      return NextResponse.json({ success: false, error: 'Data tidak cukup' });
    }

    const closes  = candles.map(c => c.close);
    const rsi14    = getLatestRSI(closes, 14);
    const ema9     = getLatestEMA(closes, 9);
    const ema21    = getLatestEMA(closes, 21);
    const ema50    = getLatestEMA(closes, 50);
    const macd     = calculateMACD(closes);
    const bb       = calculateBollingerBands(closes);
    const atr      = calculateATR(candles);
    const trend    = detectMarketTrend(closes);
    const momentum = calculateMomentumScore(candles);
    const stochRSI = calculateStochRSI(closes);

    const close      = closes[closes.length - 1];
    const prev       = closes[closes.length - 2];
    const change     = prev > 0 ? ((close - prev) / prev) * 100 : 0;
    const firstClose = closes[0];
    const dayChange  = firstClose > 0 ? ((close - firstClose) / firstClose) * 100 : 0;

    return NextResponse.json({
      success: true,
      instrument, tf, granularity,
      candles: candles.slice(-100),
      ticker: ticker || {
        bid: close - (close * 0.00005),
        ask: close + (close * 0.00005),
        mid: close,
        spread: close * 0.0001,
        instrument,
        last: close,
        change24h: dayChange,
      },
      indicators: {
        rsi14, ema9, ema21, ema50,
        macd:     macd.latest,
        bb:       bb.latest,
        atr:      atr ? parseFloat(atr.toFixed(5)) : null,
        trend, momentum, stochRSI, close,
        change:   parseFloat(change.toFixed(4)),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

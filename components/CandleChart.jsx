'use client';
import { useEffect, useRef } from 'react';

export default function CandleChart({ candles = [], indicators = {}, instrument = 'EUR_USD' }) {
  const chartRef = useRef(null);
  const chartObj = useRef(null);

  useEffect(() => {
    if (!candles.length || !chartRef.current) return;

    const init = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        if (chartObj.current) { chartObj.current.remove(); chartObj.current = null; }

        const chart = createChart(chartRef.current, {
          width:  chartRef.current.clientWidth,
          height: 240,
          layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
          grid:   { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: '#334155' },
          timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
        });
        chartObj.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor: '#10b981', downColor: '#ef4444',
          borderUpColor: '#10b981', borderDownColor: '#ef4444',
          wickUpColor: '#10b981', wickDownColor: '#ef4444',
        });

        const data = candles
          .filter(c => c.time && c.open && c.high && c.low && c.close)
          .map(c => ({
            time:  Math.floor(c.time / 1000),
            open:  c.open, high: c.high, low: c.low, close: c.close,
          }))
          .sort((a, b) => a.time - b.time);

        // Deduplicate by time
        const seen = new Set();
        const unique = data.filter(d => { if (seen.has(d.time)) return false; seen.add(d.time); return true; });
        if (unique.length > 0) candleSeries.setData(unique);

        // EMA 9
        if (indicators.ema9 && unique.length > 0) {
          const emaSeries = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          emaSeries.setData([{ time: unique[unique.length - 1].time, value: indicators.ema9 }]);
        }
        // EMA 21
        if (indicators.ema21 && unique.length > 0) {
          const emaSeries = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          emaSeries.setData([{ time: unique[unique.length - 1].time, value: indicators.ema21 }]);
        }

        chart.timeScale().fitContent();
        const ro = new ResizeObserver(() => chart.applyOptions({ width: chartRef.current?.clientWidth || 300 }));
        ro.observe(chartRef.current);
        return () => ro.disconnect();
      } catch (err) {
        console.error('Chart error:', err);
      }
    };

    init();
    return () => { if (chartObj.current) { chartObj.current.remove(); chartObj.current = null; } };
  }, [candles, indicators]);

  return (
    <div className="relative">
      <div ref={chartRef} style={{ width: '100%', height: 240 }} />
      {!candles.length && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
          Memuat chart...
        </div>
      )}
    </div>
  );
}

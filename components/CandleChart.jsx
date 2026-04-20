'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, TrendingUp, BarChart2 } from 'lucide-react';

// TradingView symbol map
const TV_SYMBOL = {
  EUR_USD:'FX:EURUSD', GBP_USD:'FX:GBPUSD', USD_JPY:'FX:USDJPY',
  AUD_USD:'FX:AUDUSD', USD_CAD:'FX:USDCAD', USD_CHF:'FX:USDCHF',
  NZD_USD:'FX:NZDUSD', EUR_GBP:'FX:EURGBP', EUR_JPY:'FX:EURJPY',
  GBP_JPY:'FX:GBPJPY', AUD_JPY:'FX:AUDJPY', EUR_AUD:'FX:EURAUD',
  GBP_AUD:'FX:GBPAUD', EUR_CHF:'FX:EURCHF', GBP_NZD:'FX:GBPNZD',
  XAU_USD:'TVC:GOLD',  XAG_USD:'TVC:SILVER',
};

const TV_TF = {
  '1m':'1','5m':'5','15m':'15','30m':'30',
  '1h':'60','4h':'240','1d':'D',
};

// ─── TradingView Widget ────────────────────────────────────────────────────────
function TradingViewWidget({ instrument = 'EUR_USD', tf = '5m' }) {
  const containerRef = useRef(null);
  const symbol   = TV_SYMBOL[instrument] || 'FX:EURUSD';
  const interval = TV_TF[tf] || '5';

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const divId = 'tv_chart_' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.id = divId;
    wrapper.style.cssText = 'width:100%;height:420px;';
    containerRef.current.appendChild(wrapper);

    const initWidget = () => {
      if (!window.TradingView || !document.getElementById(divId)) return;
      new window.TradingView.widget({
        autosize           : true,
        symbol,
        interval,
        timezone           : 'Asia/Jakarta',
        theme              : 'dark',
        style              : '1',
        locale             : 'id',
        toolbar_bg         : '#0f172a',
        enable_publishing  : false,
        hide_top_toolbar   : false,
        save_image         : true,
        container_id       : divId,
        withdateranges     : true,
        allow_symbol_change: true,
        studies            : ['MASimple@tv-basicstudies','RSI@tv-basicstudies','MACD@tv-basicstudies'],
        show_popup_button  : true,
        popup_width        : '1000',
        popup_height       : '650',
        backgroundColor    : '#0f172a',
        gridColor          : '#1e293b',
        hide_side_toolbar  : false,
      });
    };

    const scriptId = 'tv-widget-script';
    if (!document.getElementById(scriptId)) {
      const script  = document.createElement('script');
      script.id     = scriptId;
      script.src    = 'https://s3.tradingview.com/tv.js';
      script.async  = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    } else {
      setTimeout(initWidget, 200);
    }

    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
  }, [symbol, interval]);

  return <div ref={containerRef} style={{ width:'100%', minHeight:420 }}/>;
}

// ─── Bot Chart (lightweight-charts) ───────────────────────────────────────────
function BotChart({ candles = [], indicators = {}, instrument = 'EUR_USD', openPositions = [] }) {
  const chartRef = useRef(null);
  const chartObj = useRef(null);

  useEffect(() => {
    if (!candles.length || !chartRef.current) return;
    const init = async () => {
      try {
        const { createChart } = await import('lightweight-charts');
        if (chartObj.current) { chartObj.current.remove(); chartObj.current = null; }

        const chart = createChart(chartRef.current, {
          width  : chartRef.current.clientWidth,
          height : 320,
          layout : { background:{ color:'transparent' }, textColor:'#94a3b8' },
          grid   : { vertLines:{ color:'#1e293b' }, horzLines:{ color:'#1e293b' } },
          crosshair      : { mode:1 },
          rightPriceScale: { borderColor:'#334155' },
          timeScale      : { borderColor:'#334155', timeVisible:true, secondsVisible:false },
        });
        chartObj.current = chart;

        const candleSeries = chart.addCandlestickSeries({
          upColor:'#10b981', downColor:'#ef4444',
          borderUpColor:'#10b981', borderDownColor:'#ef4444',
          wickUpColor:'#10b981', wickDownColor:'#ef4444',
        });

        const data = candles
          .filter(c => c.time && c.open && c.high && c.low && c.close)
          .map(c => ({ time:Math.floor(c.time/1000), open:c.open, high:c.high, low:c.low, close:c.close }))
          .sort((a,b) => a.time - b.time);
        const seen   = new Set();
        const unique = data.filter(d => { if(seen.has(d.time)) return false; seen.add(d.time); return true; });
        if (!unique.length) return;
        candleSeries.setData(unique);

        const last = unique[unique.length - 1];

        // EMAs
        const emaLines = [
          { key:'ema9',  color:'#f59e0b', title:'EMA9'  },
          { key:'ema21', color:'#8b5cf6', title:'EMA21' },
          { key:'ema50', color:'#64748b', title:'EMA50' },
        ];
        for (const { key, color, title } of emaLines) {
          if (indicators[key]) {
            const s = chart.addLineSeries({ color, lineWidth:1, priceLineVisible:false, lastValueVisible:true, title });
            s.setData([{ time:last.time, value:indicators[key] }]);
          }
        }

        // Bollinger Bands
        if (indicators.bb) {
          for (const [k, title] of [['upper','BB↑'],['middle','BB Mid'],['lower','BB↓']]) {
            if (indicators.bb[k]) {
              const s = chart.addLineSeries({ color:'#0ea5e9', lineWidth:1, lineStyle:2, priceLineVisible:false, lastValueVisible:false, title });
              s.setData([{ time:last.time, value:indicators.bb[k] }]);
            }
          }
        }

        // Open position lines + markers
        const markers = [];
        for (const pos of openPositions) {
          if (pos.instrument !== instrument) continue;
          const isBuy = pos.direction === 'buy';
          markers.push({
            time    : Math.floor(pos.openTime / 1000),
            position: isBuy ? 'belowBar' : 'aboveBar',
            color   : isBuy ? '#10b981' : '#ef4444',
            shape   : isBuy ? 'arrowUp' : 'arrowDown',
            text    : `${isBuy ? '▲ BUY' : '▼ SELL'} ${pos.lots}lot`,
          });
          // SL line
          if (pos.stopLoss) {
            const s = chart.addLineSeries({ color:'#ef4444', lineWidth:1, lineStyle:1, priceLineVisible:true, lastValueVisible:true, title:'SL' });
            s.setData(unique.slice(-20).map(c => ({ time:c.time, value:pos.stopLoss })));
          }
          // TP line
          if (pos.takeProfit) {
            const s = chart.addLineSeries({ color:'#10b981', lineWidth:1, lineStyle:1, priceLineVisible:true, lastValueVisible:true, title:'TP' });
            s.setData(unique.slice(-20).map(c => ({ time:c.time, value:pos.takeProfit })));
          }
        }
        if (markers.length) candleSeries.setMarkers(markers);

        chart.timeScale().fitContent();

        const ro = new ResizeObserver(() => {
          if (chartRef.current) chart.applyOptions({ width:chartRef.current.clientWidth });
        });
        ro.observe(chartRef.current);
        return () => ro.disconnect();
      } catch (err) { console.error('BotChart error:', err); }
    };
    init();
    return () => { if (chartObj.current) { chartObj.current.remove(); chartObj.current = null; } };
  }, [candles, indicators, instrument, openPositions]);

  return (
    <div className="relative">
      <div ref={chartRef} style={{ width:'100%', height:320 }}/>
      {!candles.length && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
          Memuat data...
        </div>
      )}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
export default function CandleChart({
  candles = [], indicators = {}, instrument = 'EUR_USD',
  tf = '5m', openPositions = [], onRefresh,
}) {
  const [mode, setMode] = useState('tradingview');

  return (
    <div>
      {/* ── Mode switcher ── */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-slate-700/50">
        <button onClick={() => setMode('tradingview')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${mode === 'tradingview' ? 'bg-blue-600 text-white' : 'bg-slate-700/50 text-slate-400'}`}>
          <BarChart2 size={12}/> TradingView
        </button>
        <button onClick={() => setMode('bot')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${mode === 'bot' ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400'}`}>
          <TrendingUp size={12}/> Bot Chart
        </button>
        <div className="flex-1"/>
        {mode === 'bot' && onRefresh && (
          <button onClick={onRefresh} className="text-slate-500 hover:text-slate-300"><RefreshCw size={14}/></button>
        )}
        <span className="text-xs text-slate-600">{instrument.replace('_','/')} · {tf}</span>
      </div>

      {/* ── TradingView ── */}
      {mode === 'tradingview' && (
        <div>
          <TradingViewWidget instrument={instrument} tf={tf}/>
          <div className="px-3 py-2 bg-blue-900/20 border-t border-blue-800/30">
            <p className="text-xs text-blue-400 font-semibold mb-0.5">💡 Tips Analisa Manual</p>
            <p className="text-xs text-slate-500">
              Toolbar kiri: garis, Fibonacci, support/resistance, channel, text.
              Tap <strong className="text-slate-400">⛶</strong> untuk fullscreen.
              Pair & timeframe sync otomatis dari bot.
            </p>
          </div>
        </div>
      )}

      {/* ── Bot Chart ── */}
      {mode === 'bot' && (
        <div>
          <BotChart candles={candles} indicators={indicators} instrument={instrument} openPositions={openPositions}/>
          <div className="px-3 py-2 flex flex-wrap gap-3 border-t border-slate-700/50">
            {[
              { color:'#f59e0b', label:'EMA 9'  },
              { color:'#8b5cf6', label:'EMA 21' },
              { color:'#64748b', label:'EMA 50' },
              { color:'#0ea5e9', label:'BB'     },
              { color:'#10b981', label:'TP/Buy' },
              { color:'#ef4444', label:'SL/Sell'},
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-4 h-0.5 rounded-full" style={{ background:color }}/>
                <span className="text-xs text-slate-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

#!/data/data/com.termux/files/usr/bin/bash
set -e
REPO="$HOME/ForexTraderApp"

# --- Backup ---
cp "$REPO/lib/demoStore.js" "$REPO/lib/demoStore.js.bak"
cp "$REPO/app/api/bot/route.js" "$REPO/app/api/bot/route.js.bak"
cp "$REPO/components/Dashboard.jsx" "$REPO/components/Dashboard.jsx.bak"

# --- Fix 1: export saveState di demoStore.js ---
sed -i 's/^function saveState()/export function saveState()/' "$REPO/lib/demoStore.js"

# --- Fix 2: import saveState di bot/route.js ---
sed -i 's/updatePositions, setStartBalance,/updatePositions, setStartBalance, saveState as saveDemoState,/' "$REPO/app/api/bot/route.js"

# --- Fix 3: patch via python ---
python3 << 'PYEOF'
import os
REPO = os.path.expanduser('~/ForexTraderApp')

# ── bot/route.js ──────────────────────────────────────────
p = REPO + '/app/api/bot/route.js'
s = open(p).read()

s = s.replace(
  "          demo.totalPnl     = demo.closedTrades.reduce((s, t) => s + (t.pnlUSD || 0), 0);\n"
  "          demo.tradeCount   = demo.closedTrades.length;\n"
  "          demo.totalPnlPct  = demo.startBalance > 0 ? (demo.totalPnl / demo.startBalance) * 100 : 0;\n"
  "        }\n"
  "        return NextResponse.json({ success: true, demo: getDemoState() });\n"
  "      }",
  "          demo.totalPnl     = parseFloat(demo.closedTrades.reduce((s,t)=>s+(t.pnlUSD||0),0).toFixed(2));\n"
  "          demo.tradeCount   = demo.closedTrades.length;\n"
  "          demo.totalPnlPct  = demo.startBalance > 0 ? parseFloat(((demo.totalPnl/demo.startBalance)*100).toFixed(2)) : 0;\n"
  "          demo.usdBalance   = parseFloat((demo.startBalance + demo.totalPnl).toFixed(2));\n"
  "          saveDemoState();\n"
  "        }\n"
  "        return NextResponse.json({ success: true, demo: getDemoState() });\n"
  "      }"
)

s = s.replace(
  "        demo.closedTrades = []; demo.totalPnl = 0;\n"
  "        demo.totalPnlPct  = 0;  demo.tradeCount = 0;\n"
  "        return NextResponse.json({ success: true, demo: getDemoState() });",
  "        demo.closedTrades      = [];\n"
  "        demo.totalPnl          = 0;\n"
  "        demo.totalPnlPct       = 0;\n"
  "        demo.tradeCount        = 0;\n"
  "        demo.consecutiveWins   = 0;\n"
  "        demo.consecutiveLosses = 0;\n"
  "        demo.usdBalance        = demo.startBalance;\n"
  "        saveDemoState();\n"
  "        return NextResponse.json({ success: true, demo: getDemoState() });"
)
open(p,'w').write(s)
print("✅ bot/route.js patched")

# ── Dashboard.jsx ─────────────────────────────────────────
p = REPO + '/components/Dashboard.jsx'
s = open(p).read()

s = s.replace(
  "      if (d.requireConfirmation) { setLiveConfirm(true); return; }\n"
  "      if (d.demo) saveDemoState(d.demo);",
  "      if (d.requireConfirmation) { setLiveConfirm(true); return; }\n"
  "      if (action === 'reset') {\n"
  "        try { localStorage.removeItem('ft_demo'); } catch {}\n"
  "        setLocalDemo(null);\n"
  "      }\n"
  "      if (d.demo) saveDemoState(d.demo);"
)

s = s.replace(
  "    if (d.success && d.demo) { saveDemoState(d.demo); setBotData(prev => prev ? { ...prev, demo: d.demo } : prev); if (d.scanResult) setScanResult(d.scanResult); }",
  "    if (d.success && d.demo) {\n"
  "      try { localStorage.removeItem('ft_demo'); } catch {}\n"
  "      setLocalDemo(null);\n"
  "      saveDemoState(d.demo);\n"
  "      setBotData(prev => prev ? { ...prev, demo: d.demo } : prev);\n"
  "      if (d.scanResult) setScanResult(d.scanResult);\n"
  "    }"
)
open(p,'w').write(s)
print("✅ Dashboard.jsx patched")
PYEOF

echo ""
echo "🚀 Git commit & push..."
cd "$REPO"
git add lib/demoStore.js app/api/bot/route.js components/Dashboard.jsx
git commit -m "fix: P&L saldo sinkron setelah reset/clearHistory v3"
git push

echo "✅ SELESAI! Railway auto-redeploy."

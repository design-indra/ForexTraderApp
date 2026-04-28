-- ════════════════════════════════════════════════
--  ForexTrader — User States Table
--  Jalankan di: Supabase SQL Editor → New Query
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_states (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  usd_balance    FLOAT   NOT NULL DEFAULT 31.25,
  start_balance  FLOAT   NOT NULL DEFAULT 31.25,
  total_pnl      FLOAT   NOT NULL DEFAULT 0,
  total_pnl_pct  FLOAT   NOT NULL DEFAULT 0,
  trade_count    INT     NOT NULL DEFAULT 0,
  win_count      INT     NOT NULL DEFAULT 0,
  loss_count     INT     NOT NULL DEFAULT 0,
  consec_losses  INT     NOT NULL DEFAULT 0,
  consec_wins    INT     NOT NULL DEFAULT 0,
  open_positions JSONB   NOT NULL DEFAULT '[]',
  closed_trades  JSONB   NOT NULL DEFAULT '[]',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_user_states_user_id ON user_states(user_id);
CREATE INDEX IF NOT EXISTS idx_user_states_updated ON user_states(updated_at DESC);

-- Disable RLS (server-side access only via service_role)
ALTER TABLE user_states DISABLE ROW LEVEL SECURITY;

-- Verifikasi
SELECT 'user_states table created successfully!' as status;

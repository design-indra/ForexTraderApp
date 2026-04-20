'use client';
import { useState } from 'react';
import { TrendingUp, Lock, Mail, Eye, EyeOff } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('ft_token', data.token);
        sessionStorage.setItem('ft_email', data.email);
        onLogin(data.email);
      } else {
        setError(data.error || 'Login gagal');
      }
    } catch { setError('Koneksi gagal'); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl flex items-center justify-center shadow-2xl"
               style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            <TrendingUp size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            Forex<span className="text-emerald-400">Trader</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">AI-Powered Auto Trading Bot</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-slate-700 p-6 shadow-xl" style={{ background: 'var(--surface-2)' }}>
          <div className="space-y-4">
            {/* Email */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1.5 block">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="admin@forextrader.app"
                  className="w-full bg-slate-800/60 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-1.5 block">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={e => e.key === 'Enter' && handleLogin(e)}
                  className="w-full bg-slate-800/60 border border-slate-600 rounded-xl pl-9 pr-10 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-xs text-red-400">{error}</div>
            )}

            <button
              onClick={handleLogin} disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              {loading ? 'Masuk...' : 'Masuk'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Default: admin@forextrader.app / forextrader123
        </p>
        <p className="text-center text-xs text-slate-700 mt-1">
          Ganti di .env sebelum deploy
        </p>
      </div>
    </div>
  );
}

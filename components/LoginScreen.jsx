'use client';
import { useState } from 'react';
import { TrendingUp, Lock, Mail, Eye, EyeOff, User, CheckCircle } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [tab, setTab] = useState('login');

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

        {/* Tab switcher */}
        <div className="flex rounded-xl overflow-hidden border border-slate-700 mb-4">
          <button onClick={() => setTab('login')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === 'login' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
            Masuk
          </button>
          <button onClick={() => setTab('register')}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === 'register' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
            Daftar
          </button>
        </div>

        {tab === 'login'
          ? <LoginForm onLogin={onLogin} />
          : <RegisterForm onSuccess={() => setTab('login')} />
        }
      </div>
    </div>
  );
}

function LoginForm({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('ft_token',      data.token);
        localStorage.setItem('ft_email',      data.email);
        localStorage.setItem('ft_name',       data.name || '');
        localStorage.setItem('ft_role',       data.role || 'user');
        localStorage.setItem('ft_sub_active', data.subscriptionActive ? '1' : '0');
        localStorage.setItem('ft_sub_end',    data.subscriptionEnd || '');
        localStorage.setItem('ft_sub_days',   String(data.daysRemaining || 0));
        onLogin(data.email, data.subscriptionActive, data.role);
      } else {
        setError(data.error || 'Login gagal');
      }
    } catch { setError('Koneksi gagal. Periksa internet Anda.'); }
    finally  { setLoading(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-700 p-6 shadow-xl" style={{ background: 'var(--surface-2)' }}>
      <div className="space-y-4">
        <InputField icon={<Mail size={16}/>} type="email" placeholder="Email" value={email} onChange={setEmail}/>
        <PasswordField value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(p=>!p)} onEnter={handleLogin}/>
        {error && <ErrorBox msg={error}/>}
        <button onClick={handleLogin} disabled={loading || !email || !password}
          className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
          {loading ? 'Masuk...' : 'Masuk'}
        </button>
      </div>
    </div>
  );
}

function RegisterForm({ onSuccess }) {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const handleRegister = async () => {
    if (!name || !email || !password) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const res  = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(data.message);
        setTimeout(onSuccess, 2500);
      } else {
        setError(data.error || 'Pendaftaran gagal');
      }
    } catch { setError('Koneksi gagal. Periksa internet Anda.'); }
    finally  { setLoading(false); }
  };

  return (
    <div className="rounded-2xl border border-slate-700 p-6 shadow-xl" style={{ background: 'var(--surface-2)' }}>
      <div className="space-y-4">
        <InputField icon={<User size={16}/>} type="text" placeholder="Nama Lengkap" value={name} onChange={setName}/>
        <InputField icon={<Mail size={16}/>} type="email" placeholder="Email" value={email} onChange={setEmail}/>
        <PasswordField value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(p=>!p)} placeholder="Password (min. 8 karakter)"/>
        {error   && <ErrorBox msg={error}/>}
        {success && (
          <div className="flex items-start gap-2 bg-emerald-900/30 border border-emerald-700/50 rounded-xl p-3">
            <CheckCircle size={15} className="text-emerald-400 mt-0.5 shrink-0"/>
            <p className="text-xs text-emerald-400">{success}</p>
          </div>
        )}
        <button onClick={handleRegister} disabled={loading || !email || !password || !name}
          className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 active:scale-95 transition-all"
          style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
          {loading ? 'Mendaftar...' : 'Daftar Sekarang'}
        </button>
        <p className="text-center text-xs text-slate-500 leading-relaxed">
          Setelah daftar, hubungi admin untuk aktivasi akses trading.
        </p>
      </div>
    </div>
  );
}

function InputField({ icon, type, placeholder, value, onChange }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">{icon}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-slate-800/60 border border-slate-600 rounded-xl pl-9 pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"/>
    </div>
  );
}

function PasswordField({ value, onChange, show, onToggle, onEnter, placeholder = '••••••••' }) {
  return (
    <div className="relative">
      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
      <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        className="w-full bg-slate-800/60 border border-slate-600 rounded-xl pl-9 pr-10 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"/>
      <button type="button" onClick={onToggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
        {show ? <EyeOff size={15}/> : <Eye size={15}/>}
      </button>
    </div>
  );
}

function ErrorBox({ msg }) {
  return (
    <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-xs text-red-400">{msg}</div>
  );
}

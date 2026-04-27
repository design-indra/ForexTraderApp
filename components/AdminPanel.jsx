'use client';
/**
 * components/AdminPanel.jsx
 * Panel admin untuk melihat semua user + aktifkan subscription
 *
 * Cara pakai di Dashboard.jsx:
 *   import AdminPanel from './AdminPanel';
 *   // lalu render jika role === 'admin':
 *   {role === 'admin' && <AdminPanel />}
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Users, CheckCircle, XCircle, Clock, RefreshCw,
  ShieldCheck, AlertTriangle, ChevronDown,
} from 'lucide-react';

const PLANS = [
  { label: '1 Bulan',  months: 1 },
  { label: '3 Bulan',  months: 3 },
  { label: '6 Bulan',  months: 6 },
  { label: '12 Bulan', months: 12 },
];

export default function AdminPanel() {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [toast,    setToast]    = useState('');
  const [acting,   setActing]   = useState(null); // userId yang sedang diproses

  const token = typeof window !== 'undefined' ? localStorage.getItem('ft_token') : '';

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/subscription', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setUsers(data.users || []);
      else setError(data.error || 'Gagal memuat data');
    } catch {
      setError('Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const activateSub = async (userId, planMonths) => {
    setActing(userId);
    try {
      const res  = await fetch('/api/admin/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, planMonths }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message);
        fetchUsers();
      } else {
        showToast('❌ ' + (data.error || 'Gagal'));
      }
    } catch {
      showToast('❌ Koneksi gagal');
    } finally {
      setActing(null);
    }
  };

  const deactivateSub = async (userId) => {
    if (!confirm('Yakin nonaktifkan subscription user ini?')) return;
    setActing(userId);
    try {
      const res  = await fetch('/api/admin/subscription', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      showToast(data.success ? '✅ Subscription dinonaktifkan' : '❌ ' + data.error);
      fetchUsers();
    } catch {
      showToast('❌ Koneksi gagal');
    } finally {
      setActing(null);
    }
  };

  const subColor = (status) => {
    if (status === 'active')   return 'text-emerald-400';
    if (status === 'expired')  return 'text-red-400';
    return 'text-slate-500';
  };

  const subIcon = (status) => {
    if (status === 'active')  return <CheckCircle size={13} className="text-emerald-400" />;
    if (status === 'expired') return <XCircle     size={13} className="text-red-400" />;
    return <Clock size={13} className="text-slate-500" />;
  };

  const formatDate = (iso) => {
    if (!iso) return '–';
    return new Date(iso).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
  };

  // Summary counts
  const counts = {
    total:    users.length,
    active:   users.filter(u => u.subscription_status === 'active').length,
    inactive: users.filter(u => u.subscription_status !== 'active').length,
  };

  return (
    <div className="space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-100 shadow-xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-400" />
          <h2 className="text-base font-bold text-slate-100">Admin Panel</h2>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total User',  value: counts.total,    color: 'text-slate-100' },
          { label: 'Aktif',       value: counts.active,   color: 'text-emerald-400' },
          { label: 'Tidak Aktif', value: counts.inactive, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-700 p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* User list */}
      {loading ? (
        <div className="text-center py-8 text-slate-500 text-sm">Memuat data user...</div>
      ) : (
        <div className="space-y-2">
          {users.filter(u => u.role !== 'admin').map(user => (
            <UserCard
              key={user.id}
              user={user}
              acting={acting === user.id}
              subColor={subColor}
              subIcon={subIcon}
              formatDate={formatDate}
              onActivate={(months) => activateSub(user.id, months)}
              onDeactivate={() => deactivateSub(user.id)}
            />
          ))}
          {users.filter(u => u.role !== 'admin').length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              <Users size={32} className="mx-auto mb-2 opacity-30" />
              Belum ada user yang mendaftar
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserCard({ user, acting, subColor, subIcon, formatDate, onActivate, onDeactivate }) {
  const [expanded, setExpanded] = useState(false);
  const [selPlan,  setSelPlan]  = useState(1);

  const isActive = user.subscription_status === 'active';

  return (
    <div className="rounded-xl border border-slate-700 overflow-hidden" style={{ background: 'var(--surface-2)' }}>
      {/* Row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/20 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
            {(user.name || user.email)[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{user.name || '–'}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {subIcon(user.subscription_status)}
            <span className={`text-xs font-medium ${subColor(user.subscription_status)}`}>
              {isActive ? formatDate(user.subscription_end) : user.subscription_status}
            </span>
          </div>
          <ChevronDown size={14} className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-700 p-3 space-y-3">
          {/* Info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-500">Daftar</p>
              <p className="text-slate-300">{formatDate(user.created_at)}</p>
            </div>
            <div>
              <p className="text-slate-500">Login Terakhir</p>
              <p className="text-slate-300">{formatDate(user.last_login)}</p>
            </div>
            <div>
              <p className="text-slate-500">Status</p>
              <p className={`font-semibold ${subColor(user.subscription_status)}`}>
                {user.subscription_status}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Plan</p>
              <p className="text-slate-300">{user.subscription_plan || '–'}</p>
            </div>
          </div>

          {/* Activate */}
          <div className="space-y-2">
            <p className="text-xs text-slate-400 font-medium">Aktifkan / Perpanjang Subscription:</p>
            <div className="grid grid-cols-4 gap-1.5">
              {PLANS.map(p => (
                <button
                  key={p.months}
                  onClick={() => setSelPlan(p.months)}
                  className={`py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    selPlan === p.months
                      ? 'bg-emerald-700 border-emerald-600 text-white'
                      : 'border-slate-600 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => onActivate(selPlan)}
              disabled={acting}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              {acting ? 'Memproses...' : `✅ Aktifkan ${PLANS.find(p=>p.months===selPlan)?.label}`}
            </button>
          </div>

          {/* Deactivate */}
          {isActive && (
            <button
              onClick={onDeactivate}
              disabled={acting}
              className="w-full py-2 rounded-xl text-xs font-semibold text-red-400 border border-red-900/50 hover:border-red-700 transition-colors disabled:opacity-50"
            >
              Nonaktifkan Subscription
            </button>
          )}
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import LoginScreen         from '../components/LoginScreen';
import Dashboard           from '../components/Dashboard';
import SubscriptionExpired from '../components/SubscriptionExpired';

export default function Home() {
  const [authed,    setAuthed]    = useState(false);
  const [subActive, setSubActive] = useState(false);
  const [email,     setEmail]     = useState('');
  const [role,      setRole]      = useState('user');
  const [checking,  setChecking]  = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('ft_token');
    const user  = localStorage.getItem('ft_email');
    const sub   = localStorage.getItem('ft_sub_active') === '1';
    const r     = localStorage.getItem('ft_role') || 'user';
    if (token) {
      setAuthed(true);
      setEmail(user || '');
      setSubActive(sub);
      setRole(r);
    }
    setChecking(false);
  }, []);

  const handleLogin = (em, sub, r) => {
    setAuthed(true);
    setEmail(em);
    setSubActive(sub);
    setRole(r || 'user');
  };

  const handleLogout = () => {
    localStorage.clear();
    setAuthed(false);
    setSubActive(false);
    setRole('user');
    setEmail('');
  };

  if (checking)  return null;
  if (!authed)   return <LoginScreen onLogin={handleLogin} />;
  if (!subActive && role !== 'admin') return <SubscriptionExpired email={email} onLogout={handleLogout} />;
  return <Dashboard userEmail={email} onLogout={handleLogout} userRole={role} />;
}

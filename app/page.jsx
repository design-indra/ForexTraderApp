'use client';
import { useState, useEffect } from 'react';
import LoginScreen from '../components/LoginScreen';
import Dashboard   from '../components/Dashboard';

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [email,  setEmail]  = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('ft_token');
    const user  = sessionStorage.getItem('ft_email');
    if (token) { setAuthed(true); setEmail(user || ''); }
    setChecking(false);
  }, []);

  const handleLogin  = (em) => { setAuthed(true); setEmail(em); };
  const handleLogout = ()   => {
    sessionStorage.removeItem('ft_token');
    sessionStorage.removeItem('ft_email');
    setAuthed(false);
  };

  if (checking) return null;
  if (!authed)  return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard userEmail={email} onLogout={handleLogout} />;
}

import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('❌ JWT_SECRET wajib diisi di .env');

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  if (!token) return null;
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

export function isSubscriptionActive(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.subscription_status !== 'active') return false;
  if (!user.subscription_end) return false;
  return new Date(user.subscription_end) > new Date();
}

export function daysRemaining(user) {
  if (!user?.subscription_end) return 0;
  if (user.role === 'admin') return 9999;
  const diff = new Date(user.subscription_end) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

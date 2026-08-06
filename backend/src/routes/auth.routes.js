const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User.model');
const {
  signAccessToken,
  createRefreshTokenFamily,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  hashToken,
} = require('../services/tokenService');
const RefreshToken = require('../models/RefreshToken.model');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/auth';

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
  maxAge: 30 * 24 * 60 * 60 * 1000,
});

function meta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || password.length < 8) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Email and password (min 8 chars) required',
      });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'EMAIL_TAKEN' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash });

    const accessToken = signAccessToken(user);
    const { rawToken } = await createRefreshTokenFamily(user._id, meta(req));

    res.cookie(REFRESH_COOKIE_NAME, rawToken, cookieOptions());
    return res.status(201).json({ accessToken, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error('signup error', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    const accessToken = signAccessToken(user);
    const { rawToken } = await createRefreshTokenFamily(user._id, meta(req));

    res.cookie(REFRESH_COOKIE_NAME, rawToken, cookieOptions());
    return res.json({ accessToken, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error('signin error', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/refresh', async (req, res) => {
  const rawToken = req.cookies[REFRESH_COOKIE_NAME];
  if (!rawToken) return res.status(401).json({ error: 'NO_REFRESH_TOKEN' });

  const result = await rotateRefreshToken(rawToken, meta(req));

  if (result.error === 'REUSE_DETECTED') {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return res.status(401).json({ error: 'REUSE_DETECTED' });
  }

  if (result.error) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return res.status(401).json({ error: result.error });
  }

  const user = await User.findById(result.userId);
  if (!user) {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return res.status(401).json({ error: 'USER_NOT_FOUND' });
  }

  const accessToken = signAccessToken(user);
  res.cookie(REFRESH_COOKIE_NAME, result.rawToken, cookieOptions());
  return res.json({ accessToken });
});

// NEW: exposes refresh-token metadata only — never the raw or hashed value.
// Lets the dashboard show refresh-session expiry without compromising the token.
router.get('/session-info', async (req, res) => {
  const rawToken = req.cookies[REFRESH_COOKIE_NAME];
  if (!rawToken) return res.status(404).json({ error: 'NO_SESSION' });

  const existing = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!existing || existing.revokedAt) {
    return res.status(404).json({ error: 'NO_SESSION' });
  }

  return res.json({
    familyId: existing.familyId,
    issuedAt: existing.createdAt,
    expiresAt: existing.expiresAt,
  });
});

router.post('/logout', async (req, res) => {
  const rawToken = req.cookies[REFRESH_COOKIE_NAME];
  if (rawToken) {
    const existing = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
    if (existing) await revokeFamily(existing.familyId);
  }

  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  return res.json({ message: 'Logged out' });
});

router.post('/logout-all', requireAuth, async (req, res) => {
  await revokeAllForUser(req.user.id);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  return res.json({ message: 'All sessions revoked' });
});

module.exports = router;
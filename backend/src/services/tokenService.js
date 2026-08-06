const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const RefreshToken = require('../models/RefreshToken.model');

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '..', '..', 'keys', 'private.pem'), 'utf8');
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, '..', '..', 'keys', 'public.pem'), 'utf8');

const ACCESS_TOKEN_TTL = '10m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, PUBLIC_KEY, { algorithms: ['RS256'] });
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function createRefreshTokenFamily(userId, meta = {}) {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const familyId = uuidv4();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await RefreshToken.create({
    userId,
    tokenHash,
    familyId,
    expiresAt,
    createdByIp: meta.ip || null,
    userAgent: meta.userAgent || null,
  });

  return { rawToken, familyId, expiresAt };
}

async function rotateRefreshToken(rawToken, meta = {}) {
  const tokenHash = hashToken(rawToken);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) return { error: 'INVALID_TOKEN' };
  if (existing.expiresAt < new Date()) return { error: 'EXPIRED_TOKEN' };

  if (existing.revokedAt) {
    await RefreshToken.updateMany(
      { familyId: existing.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    return { error: 'REUSE_DETECTED', userId: existing.userId };
  }

  const newRawToken = crypto.randomBytes(48).toString('hex');
  const newTokenHash = hashToken(newRawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await RefreshToken.create({
    userId: existing.userId,
    tokenHash: newTokenHash,
    familyId: existing.familyId,
    expiresAt,
    createdByIp: meta.ip || null,
    userAgent: meta.userAgent || null,
  });

  existing.revokedAt = new Date();
  existing.replacedByHash = newTokenHash;
  await existing.save();

  return { rawToken: newRawToken, userId: existing.userId, familyId: existing.familyId };
}

async function revokeFamily(familyId) {
  await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  hashToken,
  createRefreshTokenFamily,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  REFRESH_TOKEN_TTL_MS,
};
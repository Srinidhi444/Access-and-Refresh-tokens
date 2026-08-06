
const { verifyAccessToken } = require('../services/tokenService');

/**
 * Verifies the RS256 access token from the Authorization header.
 * Pure signature + expiry check — no DB hit, so this stays fast even
 * under heavy traffic.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'MISSING_TOKEN' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    // Covers both expired and malformed/tampered tokens.
    return res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
  }
}

module.exports = { requireAuth };
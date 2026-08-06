/**
 * Decodes a JWT payload for DISPLAY purposes only.
 * This does NOT verify the signature — never trust this for security
 * decisions on the client. Verification only ever happens server-side.
 */
export function decodeJwt(token) {
  const payload = token.split('.')[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(normalized)
      .split('')
      .map((char) => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
  );
  return JSON.parse(json);
}

export function maskToken(value) {
  if (!value) return '—';
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}···${value.slice(-8)}`;
}
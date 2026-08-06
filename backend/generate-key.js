/**
 * Run once: `node generate-keys.js`
 * Generates an RS256 keypair used to sign/verify access tokens.
 * In production these come from a secrets manager, not a checked-in file.
 */
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir);

fs.writeFileSync(path.join(keysDir, 'private.pem'), privateKey);
fs.writeFileSync(path.join(keysDir, 'public.pem'), publicKey);

console.log('RSA keypair written to ./keys/private.pem and ./keys/public.pem');
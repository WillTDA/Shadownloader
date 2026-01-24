import type { CryptoAdapter } from '../types.js';
import { getDefaultCrypto } from '../adapters/defaults.js';

/**
 * Check if a hostname is localhost
 */
export function isLocalhostHostname(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Check if the current context allows P2P (HTTPS or localhost)
 */
export function isSecureContextForP2P(
  hostname?: string,
  isSecureContext?: boolean
): boolean {
  return Boolean(isSecureContext) || isLocalhostHostname(hostname || '');
}

/**
 * Generate a P2P sharing code using cryptographically secure random.
 * Format: XXXX-0000 (4 letters + 4 digits)
 */
export function generateP2PCode(cryptoObj?: CryptoAdapter): string {
  const crypto = cryptoObj || getDefaultCrypto();
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluded I and O to avoid confusion

  if (crypto) {
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);

    let letterPart = '';
    for (let i = 0; i < 4; i++) {
      letterPart += letters[randomBytes[i] % letters.length];
    }

    let numberPart = '';
    for (let i = 4; i < 8; i++) {
      numberPart += (randomBytes[i] % 10).toString();
    }

    return `${letterPart}-${numberPart}`;
  }

  // Fallback to Math.random (less secure, but works everywhere)
  let a = '';
  for (let i = 0; i < 4; i++) {
    a += letters[Math.floor(Math.random() * letters.length)];
  }
  let b = '';
  for (let i = 0; i < 4; i++) {
    b += Math.floor(Math.random() * 10);
  }
  return `${a}-${b}`;
}

/**
 * Check if a string looks like a P2P sharing code
 */
export function isP2PCodeLike(code: string): boolean {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || '').trim());
}

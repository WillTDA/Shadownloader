import type { CryptoAdapter } from '../types.js';
import { arrayBufferToBase64 } from '../utils/base64.js';

/**
 * Compute SHA-256 hash of data and return as hex string.
 */
export async function sha256Hex(
  cryptoObj: CryptoAdapter,
  data: ArrayBuffer
): Promise<string> {
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Generate a new AES-GCM 256-bit encryption key.
 */
export async function generateAesGcmKey(
  cryptoObj: CryptoAdapter
): Promise<CryptoKey> {
  return cryptoObj.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a base64-encoded raw key.
 */
export async function exportKeyBase64(
  cryptoObj: CryptoAdapter,
  key: CryptoKey
): Promise<string> {
  const raw = await cryptoObj.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

// Re-export decryption functions
export { importKeyFromBase64, decryptChunk, decryptFilenameFromBase64 } from './decrypt.js';

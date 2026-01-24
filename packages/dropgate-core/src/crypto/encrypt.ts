import { AES_GCM_IV_BYTES } from '../constants.js';
import type { CryptoAdapter } from '../types.js';
import { arrayBufferToBase64 } from '../utils/base64.js';

/**
 * Encrypt data using AES-GCM and return as a Blob with IV prepended.
 * Layout: [IV (12 bytes)] + [ciphertext + tag]
 */
export async function encryptToBlob(
  cryptoObj: CryptoAdapter,
  dataBuffer: ArrayBuffer,
  key: CryptoKey
): Promise<Blob> {
  const iv = cryptoObj.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBuffer
  );
  return new Blob([iv, new Uint8Array(encrypted)]);
}

/**
 * Encrypt a filename using AES-GCM and return as base64.
 */
export async function encryptFilenameToBase64(
  cryptoObj: CryptoAdapter,
  filename: string,
  key: CryptoKey
): Promise<string> {
  const bytes = new TextEncoder().encode(String(filename));
  const blob = await encryptToBlob(cryptoObj, bytes.buffer, key);
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

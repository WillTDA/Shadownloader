import { AES_GCM_IV_BYTES } from '../constants.js';
import type { CryptoAdapter, Base64Adapter } from '../types.js';
import { getDefaultBase64 } from '../adapters/defaults.js';

/**
 * Import a base64-encoded AES-GCM key.
 * @param cryptoObj - Crypto adapter for key import.
 * @param keyB64 - Base64-encoded key bytes.
 * @param base64 - Optional base64 adapter.
 * @returns The imported CryptoKey.
 */
export async function importKeyFromBase64(
  cryptoObj: CryptoAdapter,
  keyB64: string,
  base64?: Base64Adapter
): Promise<CryptoKey> {
  const adapter = base64 || getDefaultBase64();
  const keyBytes = adapter.decode(keyB64);
  // Create a new ArrayBuffer copy to satisfy TypeScript's BufferSource type
  const keyBuffer = new Uint8Array(keyBytes).buffer;
  return cryptoObj.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    true,
    ['decrypt']
  );
}

/**
 * Decrypt an AES-GCM encrypted chunk.
 * Expected layout: [IV (12 bytes)] + [ciphertext + tag]
 * @param cryptoObj - Crypto adapter for decryption.
 * @param encryptedData - The encrypted data with IV prepended.
 * @param key - The AES-GCM decryption key.
 * @returns The decrypted data as ArrayBuffer.
 */
export async function decryptChunk(
  cryptoObj: CryptoAdapter,
  encryptedData: Uint8Array,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const iv = encryptedData.slice(0, AES_GCM_IV_BYTES);
  const ciphertext = encryptedData.slice(AES_GCM_IV_BYTES);
  return cryptoObj.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
}

/**
 * Decrypt a base64-encoded encrypted filename.
 * @param cryptoObj - Crypto adapter for decryption.
 * @param encryptedFilenameB64 - Base64-encoded encrypted filename.
 * @param key - The AES-GCM decryption key.
 * @param base64 - Optional base64 adapter.
 * @returns The decrypted filename string.
 */
export async function decryptFilenameFromBase64(
  cryptoObj: CryptoAdapter,
  encryptedFilenameB64: string,
  key: CryptoKey,
  base64?: Base64Adapter
): Promise<string> {
  const adapter = base64 || getDefaultBase64();
  const encryptedBytes = adapter.decode(encryptedFilenameB64);
  const decryptedBuffer = await decryptChunk(cryptoObj, encryptedBytes, key);
  return new TextDecoder().decode(decryptedBuffer);
}

import type { Base64Adapter } from '../types.js';
import { getDefaultBase64 } from '../adapters/defaults.js';

let defaultAdapter: Base64Adapter | null = null;

function getAdapter(adapter?: Base64Adapter): Base64Adapter {
  if (adapter) return adapter;
  if (!defaultAdapter) {
    defaultAdapter = getDefaultBase64();
  }
  return defaultAdapter;
}

/**
 * Convert a Uint8Array to a base64 string
 */
export function bytesToBase64(bytes: Uint8Array, adapter?: Base64Adapter): string {
  return getAdapter(adapter).encode(bytes);
}

/**
 * Convert an ArrayBuffer to a base64 string
 */
export function arrayBufferToBase64(buf: ArrayBuffer, adapter?: Base64Adapter): string {
  return bytesToBase64(new Uint8Array(buf), adapter);
}

/**
 * Convert a base64 string to a Uint8Array
 */
export function base64ToBytes(b64: string, adapter?: Base64Adapter): Uint8Array {
  return getAdapter(adapter).decode(b64);
}

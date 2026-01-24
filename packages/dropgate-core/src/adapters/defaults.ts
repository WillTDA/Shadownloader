import type { Base64Adapter, CryptoAdapter, FetchFn } from '../types.js';

/**
 * Get the default Base64 adapter for the current environment.
 * Automatically detects Node.js Buffer vs browser btoa/atob.
 */
export function getDefaultBase64(): Base64Adapter {
  // Check for Node.js Buffer (works in Node.js and some bundlers)
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return {
      encode(bytes: Uint8Array): string {
        return Buffer.from(bytes).toString('base64');
      },
      decode(b64: string): Uint8Array {
        return new Uint8Array(Buffer.from(b64, 'base64'));
      },
    };
  }

  // Browser fallback using btoa/atob
  if (typeof btoa === 'function' && typeof atob === 'function') {
    return {
      encode(bytes: Uint8Array): string {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      },
      decode(b64: string): Uint8Array {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          out[i] = binary.charCodeAt(i);
        }
        return out;
      },
    };
  }

  throw new Error(
    'No Base64 implementation available. Provide a Base64Adapter via options.'
  );
}

/**
 * Get the default crypto object for the current environment.
 * Returns globalThis.crypto if available.
 */
export function getDefaultCrypto(): CryptoAdapter | undefined {
  return globalThis.crypto as CryptoAdapter | undefined;
}

/**
 * Get the default fetch function for the current environment.
 * Returns globalThis.fetch if available.
 */
export function getDefaultFetch(): FetchFn | undefined {
  return globalThis.fetch?.bind(globalThis) as FetchFn | undefined;
}

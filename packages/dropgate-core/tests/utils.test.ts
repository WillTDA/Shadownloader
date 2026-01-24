import { describe, it, expect } from 'vitest';
import {
  lifetimeToMs,
  parseSemverMajorMinor,
  validatePlainFilename,
  bytesToBase64,
  base64ToBytes,
  arrayBufferToBase64,
  isLocalhostHostname,
  isSecureContextForP2P,
  generateP2PCode,
  isP2PCodeLike,
} from '../src/index.js';
import { DropgateValidationError } from '../src/errors.js';

describe('lifetimeToMs', () => {
  it('converts minutes to milliseconds', () => {
    expect(lifetimeToMs(1, 'minutes')).toBe(60000);
    expect(lifetimeToMs(5, 'minutes')).toBe(300000);
  });

  it('converts hours to milliseconds', () => {
    expect(lifetimeToMs(1, 'hours')).toBe(3600000);
    expect(lifetimeToMs(24, 'hours')).toBe(86400000);
  });

  it('converts days to milliseconds', () => {
    expect(lifetimeToMs(1, 'days')).toBe(86400000);
    expect(lifetimeToMs(7, 'days')).toBe(604800000);
  });

  it('returns 0 for unlimited', () => {
    expect(lifetimeToMs(999, 'unlimited')).toBe(0);
  });

  it('returns 0 for invalid inputs', () => {
    expect(lifetimeToMs(-1, 'hours')).toBe(0);
    expect(lifetimeToMs(NaN, 'hours')).toBe(0);
    expect(lifetimeToMs(1, 'invalid')).toBe(0);
  });
});

describe('parseSemverMajorMinor', () => {
  it('parses valid semver strings', () => {
    expect(parseSemverMajorMinor('2.0.0')).toEqual({ major: 2, minor: 0 });
    expect(parseSemverMajorMinor('1.5.3')).toEqual({ major: 1, minor: 5 });
  });

  it('handles missing parts', () => {
    expect(parseSemverMajorMinor('2')).toEqual({ major: 2, minor: 0 });
    expect(parseSemverMajorMinor('')).toEqual({ major: 0, minor: 0 });
    expect(parseSemverMajorMinor(null)).toEqual({ major: 0, minor: 0 });
    expect(parseSemverMajorMinor(undefined)).toEqual({ major: 0, minor: 0 });
  });
});

describe('validatePlainFilename', () => {
  it('accepts valid filenames', () => {
    expect(() => validatePlainFilename('test.txt')).not.toThrow();
    expect(() => validatePlainFilename('my-file.pdf')).not.toThrow();
    expect(() => validatePlainFilename('document_v2.docx')).not.toThrow();
  });

  it('rejects empty filenames', () => {
    expect(() => validatePlainFilename('')).toThrow(DropgateValidationError);
    expect(() => validatePlainFilename('   ')).toThrow(DropgateValidationError);
  });

  it('rejects filenames with path separators', () => {
    expect(() => validatePlainFilename('../test.txt')).toThrow(DropgateValidationError);
    expect(() => validatePlainFilename('path/to/file.txt')).toThrow(DropgateValidationError);
    expect(() => validatePlainFilename('path\\to\\file.txt')).toThrow(DropgateValidationError);
  });

  it('rejects filenames that are too long', () => {
    const longName = 'a'.repeat(256);
    expect(() => validatePlainFilename(longName)).toThrow(DropgateValidationError);
  });
});

describe('base64 encoding/decoding', () => {
  it('encodes and decodes bytes correctly', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = bytesToBase64(original);
    expect(encoded).toBe('SGVsbG8=');

    const decoded = base64ToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles empty arrays', () => {
    const empty = new Uint8Array([]);
    const encoded = bytesToBase64(empty);
    expect(encoded).toBe('');

    const decoded = base64ToBytes(encoded);
    expect(decoded.length).toBe(0);
  });

  it('encodes ArrayBuffer correctly', () => {
    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    const encoded = arrayBufferToBase64(buffer);
    expect(encoded).toBe('SGVsbG8=');
  });
});

describe('P2P utilities', () => {
  describe('isLocalhostHostname', () => {
    it('identifies localhost variants', () => {
      expect(isLocalhostHostname('localhost')).toBe(true);
      expect(isLocalhostHostname('127.0.0.1')).toBe(true);
      expect(isLocalhostHostname('::1')).toBe(true);
      expect(isLocalhostHostname('LOCALHOST')).toBe(true);
    });

    it('rejects non-localhost hostnames', () => {
      expect(isLocalhostHostname('dropgate.link')).toBe(false);
      expect(isLocalhostHostname('192.168.1.1')).toBe(false);
      expect(isLocalhostHostname('')).toBe(false);
    });
  });

  describe('isSecureContextForP2P', () => {
    it('returns true for secure context', () => {
      expect(isSecureContextForP2P('dropgate.link', true)).toBe(true);
    });

    it('returns true for localhost even without secure context', () => {
      expect(isSecureContextForP2P('localhost', false)).toBe(true);
      expect(isSecureContextForP2P('127.0.0.1', false)).toBe(true);
    });

    it('returns false for non-localhost without secure context', () => {
      expect(isSecureContextForP2P('dropgate.link', false)).toBe(false);
    });
  });

  describe('generateP2PCode', () => {
    it('generates codes in correct format', () => {
      const code = generateP2PCode();
      expect(code).toMatch(/^[A-Z]{4}-\d{4}$/);
    });

    it('generates different codes each time', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        codes.add(generateP2PCode());
      }
      // With cryptographic randomness, collisions should be extremely rare
      expect(codes.size).toBeGreaterThan(5);
    });
  });

  describe('isP2PCodeLike', () => {
    it('validates correct P2P codes', () => {
      expect(isP2PCodeLike('ABCD-1234')).toBe(true);
      expect(isP2PCodeLike('WXYZ-9876')).toBe(true);
    });

    it('rejects invalid codes', () => {
      expect(isP2PCodeLike('ABC-1234')).toBe(false);  // Too short
      expect(isP2PCodeLike('ABCD-123')).toBe(false);  // Too short
      expect(isP2PCodeLike('abcd-1234')).toBe(false); // Lowercase
      expect(isP2PCodeLike('ABCD1234')).toBe(false);  // No dash
      expect(isP2PCodeLike('')).toBe(false);
    });
  });
});

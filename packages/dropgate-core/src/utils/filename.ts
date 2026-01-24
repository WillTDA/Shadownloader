import { DropgateValidationError } from '../errors.js';

/**
 * Validate a plain (non-encrypted) filename.
 * Throws DropgateValidationError if invalid.
 */
export function validatePlainFilename(filename: string): void {
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new DropgateValidationError(
      'Invalid filename. Must be a non-empty string.'
    );
  }

  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new DropgateValidationError(
      'Invalid filename. Contains illegal characters or is too long.'
    );
  }
}

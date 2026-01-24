export interface DropgateErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * Base error class for all Dropgate errors
 */
export class DropgateError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, opts: DropgateErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code || 'DROPGATE_ERROR';
    this.details = opts.details;
    if (opts.cause !== undefined) {
      // Use Object.defineProperty for cause to maintain compatibility
      Object.defineProperty(this, 'cause', {
        value: opts.cause,
        writable: false,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

/**
 * Validation error for invalid inputs
 */
export class DropgateValidationError extends DropgateError {
  constructor(message: string, opts: DropgateErrorOptions = {}) {
    super(message, { ...opts, code: opts.code || 'VALIDATION_ERROR' });
  }
}

/**
 * Network error for connection issues
 */
export class DropgateNetworkError extends DropgateError {
  constructor(message: string, opts: DropgateErrorOptions = {}) {
    super(message, { ...opts, code: opts.code || 'NETWORK_ERROR' });
  }
}

/**
 * Protocol error for server communication issues
 */
export class DropgateProtocolError extends DropgateError {
  constructor(message: string, opts: DropgateErrorOptions = {}) {
    super(message, { ...opts, code: opts.code || 'PROTOCOL_ERROR' });
  }
}

/**
 * Abort error - replacement for DOMException with AbortError name
 * Used when operations are cancelled
 */
export class DropgateAbortError extends DropgateError {
  constructor(message = 'Operation aborted') {
    super(message, { code: 'ABORT_ERROR' });
    this.name = 'AbortError';
  }
}

/**
 * Timeout error - replacement for DOMException with TimeoutError name
 * Used when operations exceed their time limit
 */
export class DropgateTimeoutError extends DropgateError {
  constructor(message = 'Request timed out') {
    super(message, { code: 'TIMEOUT_ERROR' });
    this.name = 'TimeoutError';
  }
}

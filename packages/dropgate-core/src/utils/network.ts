import { DropgateAbortError, DropgateTimeoutError, DropgateValidationError } from '../errors.js';
import type { FetchFn, ServerTarget } from '../types.js';

/**
 * Parse a server URL string into host, port, and secure components.
 * If no protocol is specified, defaults to HTTPS.
 */
export function parseServerUrl(urlStr: string): ServerTarget {
  let normalized = urlStr.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    secure: url.protocol === 'https:',
  };
}

/**
 * Build a base URL from host, port, and secure options.
 */
export function buildBaseUrl(opts: ServerTarget): string {
  const { host, port, secure } = opts;

  if (!host || typeof host !== 'string') {
    throw new DropgateValidationError('Server host is required.');
  }

  const protocol = secure === false ? 'http' : 'https';
  const portSuffix = port ? `:${port}` : '';

  return `${protocol}://${host}${portSuffix}`;
}

/**
 * Sleep for a specified duration, with optional abort signal support.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new DropgateAbortError());
    }

    const t = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason || new DropgateAbortError());
        },
        { once: true }
      );
    }
  });
}

export interface AbortSignalWithCleanup {
  signal: AbortSignal;
  cleanup: () => void;
}

/**
 * Create an AbortSignal that combines a parent signal with a timeout.
 */
export function makeAbortSignal(
  parentSignal?: AbortSignal | null,
  timeoutMs?: number
): AbortSignalWithCleanup {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const abort = (reason?: unknown): void => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', () => abort(parentSignal.reason), {
        once: true,
      });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs! > 0) {
    timeoutId = setTimeout(() => {
      abort(new DropgateTimeoutError());
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

export interface FetchJsonResult {
  res: Response;
  json: unknown;
  text: string;
}

export interface FetchJsonOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fetch JSON from a URL with timeout and error handling.
 */
export async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  opts: FetchJsonOptions = {}
): Promise<FetchJsonResult> {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);

  try {
    const res = await fetchFn(url, { ...rest, signal: s });
    const text = await res.text();

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Ignore parse errors - json will remain null
    }

    return { res, json, text };
  } finally {
    cleanup();
  }
}

/**
 * Shadownloader Core (ES Module)
 *
 * Server API expectations:
 *  - GET  /api/info
 *  - POST /upload/init
 *  - POST /upload/chunk  (octet-stream) + headers: X-Upload-ID, X-Chunk-Index, X-Chunk-Hash
 *  - POST /upload/complete
 */

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES; // 28

/** @typedef {{ maxSizeMB:number, maxLifetimeHours:number, e2ee:boolean }} UploadCapabilities */
/** @typedef {{ upload?: UploadCapabilities }} ServerCapabilities */
/** @typedef {{ name?:string, version:string, capabilities?: ServerCapabilities }} ServerInfo */

export class ShadownloaderError extends Error {
  /** @param {string} message @param {{code?:string, details?:any, cause?:any}} [opts] */
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    /** @type {string} */
    this.code = opts.code || 'SHADOWNLOADER_ERROR';
    /** @type {any} */
    this.details = opts.details;
    if (opts.cause) this.cause = opts.cause;
  }
}

export class ShadownloaderValidationError extends ShadownloaderError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || 'VALIDATION_ERROR' });
  }
}

export class ShadownloaderNetworkError extends ShadownloaderError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || 'NETWORK_ERROR' });
  }
}

export class ShadownloaderProtocolError extends ShadownloaderError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || 'PROTOCOL_ERROR' });
  }
}

/**
 * Convert a lifetime value/unit to milliseconds (integer).
 * - unit: minutes | hours | days | unlimited
 */
export function lifetimeToMs(value, unit) {
  const u = String(unit || '').toLowerCase();
  const v = Number(value);
  if (u === 'unlimited') return 0;
  if (!Number.isFinite(v) || v <= 0) return 0;
  const multipliers = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };
  const m = multipliers[u];
  if (!m) return 0;
  return Math.round(v * m);
}

export function estimateTotalUploadSizeBytes(fileSizeBytes, totalChunks, isEncrypted) {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}

export function bytesToBase64(bytes) {
  // bytes: Uint8Array
  let binary = '';
  const len = bytes.length;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function arrayBufferToBase64(buf) {
  return bytesToBase64(new Uint8Array(buf));
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isLocalhostHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function isSecureContextForP2P(locationObj = globalThis.location, secureContext = globalThis.isSecureContext) {
  const host = locationObj?.hostname || '';
  return Boolean(secureContext) || isLocalhostHostname(host);
}

export function shouldUseSecurePeerJs(locationObj = globalThis.location) {
  return locationObj?.protocol === 'https:';
}

export function generateP2PCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let a = '';
  for (let i = 0; i < 4; i++) a += letters[Math.floor(Math.random() * letters.length)];
  let b = '';
  for (let i = 0; i < 4; i++) b += Math.floor(Math.random() * 10);
  return `${a}-${b}`;
}

export function isP2PCodeLike(code) {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || '').trim());
}

export async function ensurePeerJsLoaded({ src = '/vendor/peerjs.min.js', documentObj = globalThis.document } = {}) {
  if (globalThis.Peer) return;
  if (!documentObj?.createElement) {
    throw new ShadownloaderValidationError('PeerJS cannot be loaded (document is unavailable).');
  }
  await new Promise((resolve, reject) => {
    const s = documentObj.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new ShadownloaderNetworkError('Could not load PeerJS client.'));
    documentObj.head.appendChild(s);
  });
  if (!globalThis.Peer) throw new ShadownloaderNetworkError('PeerJS client did not initialise.');
}

function buildPeerOptions({ peerjsPath = '/peerjs', iceServers = [], locationObj = globalThis.location } = {}) {
  const opts = {
    host: locationObj?.hostname,
    path: peerjsPath,
    secure: shouldUseSecurePeerJs(locationObj),
    config: { iceServers },
    debug: 0,
  };
  if (locationObj?.port) opts.port = Number(locationObj.port);
  return opts;
}

async function createPeerWithRetries({ code, codeGenerator, maxAttempts, buildPeer, onCode }) {
  let nextCode = code || codeGenerator();
  let peer = null;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onCode?.(nextCode, attempt);
    try {
      peer = await new Promise((resolve, reject) => {
        const instance = buildPeer(nextCode);
        instance.on('open', () => resolve(instance));
        instance.on('error', (err) => {
          try { instance.destroy(); } catch {}
          reject(err);
        });
      });
      return { peer, code: nextCode };
    } catch (err) {
      lastError = err;
      nextCode = codeGenerator();
    }
  }

  throw lastError || new ShadownloaderNetworkError('Could not establish PeerJS connection.');
}

export async function startP2PSend({
  file,
  peerjsPath = '/peerjs',
  iceServers = [],
  locationObj = globalThis.location,
  peerjsScriptSrc = '/vendor/peerjs.min.js',
  codeGenerator = generateP2PCode,
  maxAttempts = 4,
  chunkSize = 256 * 1024,
  readyTimeoutMs = 8000,
  endAckTimeoutMs = 15000,
  bufferHighWaterMark = 8 * 1024 * 1024,
  bufferLowWaterMark = 2 * 1024 * 1024,
  onCode,
  onStatus,
  onProgress,
  onComplete,
  onError,
} = {}) {
  if (!file) throw new ShadownloaderValidationError('File is missing.');
  await ensurePeerJsLoaded({ src: peerjsScriptSrc });

  const peerOpts = buildPeerOptions({ peerjsPath, iceServers, locationObj });
  const buildPeer = (id) => new globalThis.Peer(id, peerOpts);

  const { peer, code } = await createPeerWithRetries({
    code: null,
    codeGenerator,
    maxAttempts,
    buildPeer,
    onCode,
  });

  let stopped = false;
  let activeConn = null;
  let transferActive = false;
  let transferCompleted = false;

  const reportProgress = ({ received, total }) => {
    const safeTotal = Number.isFinite(total) && total > 0 ? total : file.size;
    const safeReceived = Math.min(Number(received) || 0, safeTotal || 0);
    const percent = safeTotal ? (safeReceived / safeTotal) * 100 : 0;
    onProgress?.({ sent: safeReceived, total: safeTotal, percent });
  };

  const stop = () => {
    stopped = true;
    try { activeConn?.close(); } catch {}
    try { peer.destroy(); } catch {}
  };

  peer.on('connection', (conn) => {
    if (stopped) return;
    if (activeConn) {
      try { conn.send({ t: 'error', message: 'Another receiver is already connected.' }); } catch {}
      try { conn.close(); } catch {}
      return;
    }
    activeConn = conn;
    onStatus?.({ phase: 'connected', message: 'Connected. Starting transfer…' });

    let readyResolve = null;
    let ackResolve = null;
    const readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const ackPromise = new Promise((resolve) => {
      ackResolve = resolve;
    });

    conn.on('data', (data) => {
      if (!data || typeof data !== 'object' || data instanceof ArrayBuffer || ArrayBuffer.isView(data) || data instanceof Blob) return;
      if (!data.t) return;
      if (data.t === 'ready') {
        readyResolve?.();
        return;
      }
      if (data.t === 'progress') {
        reportProgress({ received: data.received, total: data.total });
        return;
      }
      if (data.t === 'ack' && data.phase === 'end') {
        ackResolve?.(data);
        return;
      }
      if (data.t === 'error') {
        onError?.(new ShadownloaderNetworkError(data.message || 'Receiver reported an error.'));
        stop();
      }
    });

    conn.on('open', async () => {
      try {
        transferActive = true;
        conn.send({ t: 'meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });

        let sent = 0;
        const total = file.size;
        const dc = conn?._dc;
        if (dc && Number.isFinite(bufferLowWaterMark)) {
          try { dc.bufferedAmountLowThreshold = bufferLowWaterMark; } catch {}
        }

        if (readyPromise) {
          await Promise.race([readyPromise, sleep(readyTimeoutMs).catch(() => null)]);
        }

        for (let offset = 0; offset < total; offset += chunkSize) {
          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          conn.send(buf);
          sent += buf.byteLength;

          if (dc) {
            while (dc.bufferedAmount > bufferHighWaterMark) {
              await new Promise((resolve) => {
                const fallback = setTimeout(resolve, 60);
                try {
                  dc.addEventListener('bufferedamountlow', () => {
                    clearTimeout(fallback);
                    resolve();
                  }, { once: true });
                } catch {
                  // fallback only
                }
              });
            }
          }

        }

        conn.send({ t: 'end' });

        const ackTimeoutMs = Number.isFinite(endAckTimeoutMs)
          ? Math.max(endAckTimeoutMs, Math.ceil(file.size / (1024 * 1024)) * 1000)
          : null;
        const ackResult = ackPromise
          ? await Promise.race([ackPromise, sleep(ackTimeoutMs).catch(() => null)])
          : null;
        if (!ackResult || typeof ackResult !== 'object') {
          throw new ShadownloaderNetworkError('Receiver did not confirm completion.');
        }
        const ackTotal = Number(ackResult.total) || file.size;
        const ackReceived = Number(ackResult.received) || 0;
        if (ackTotal && ackReceived < ackTotal) {
          throw new ShadownloaderNetworkError('Receiver reported an incomplete transfer.');
        }
        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        transferCompleted = true;
        transferActive = false;
        onComplete?.();
        stop();
      } catch (err) {
        onError?.(err);
        stop();
      }
    });

    conn.on('error', (err) => {
      onError?.(err);
      stop();
    });

    conn.on('close', () => {
      if (!transferCompleted && transferActive && !stopped) {
        onError?.(new ShadownloaderNetworkError('Receiver disconnected before transfer completed.'));
      }
      stop();
    });
  });

  return { peer, code, stop };
}

export async function startP2PReceive({
  code,
  peerjsPath = '/peerjs',
  iceServers = [],
  locationObj = globalThis.location,
  peerjsScriptSrc = '/vendor/peerjs.min.js',
  streamSaverObj = globalThis.streamSaver,
  onStatus,
  onMeta,
  onProgress,
  onComplete,
  onError,
  onDisconnect,
} = {}) {
  if (!code) throw new ShadownloaderValidationError('No sharing code was provided.');
  await ensurePeerJsLoaded({ src: peerjsScriptSrc });

  const peerOpts = buildPeerOptions({ peerjsPath, iceServers, locationObj });
  const peer = new globalThis.Peer(undefined, peerOpts);

  let writer = null;
  let total = 0;
  let received = 0;
  let lastProgressSentAt = 0;
  const progressIntervalMs = 120;
  let writeQueue = Promise.resolve();

  const stop = () => {
    try { writer?.abort(); } catch {}
    try { peer.destroy(); } catch {}
  };

  peer.on('error', (err) => {
    onError?.(err);
    stop();
  });

  peer.on('open', () => {
    const conn = peer.connect(code, { reliable: true });

    conn.on('open', () => {
      onStatus?.({ phase: 'connected', message: 'Waiting for file details…' });
    });

    conn.on('data', async (data) => {
      try {
        if (data && typeof data === 'object' && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && data.t) {
          if (data.t === 'meta') {
            const name = String(data.name || 'file');
            total = Number(data.size) || 0;
            received = 0;
            writeQueue = Promise.resolve();
            onMeta?.({ name, total });

            if (!streamSaverObj?.createWriteStream) {
              throw new ShadownloaderValidationError('Streaming is unavailable in this browser.');
            }
            const stream = streamSaverObj.createWriteStream(name, total ? { size: total } : undefined);
            writer = stream.getWriter();
            onProgress?.({ received, total, percent: 0 });
            try { conn.send({ t: 'ready' }); } catch {}
            return;
          }

          if (data.t === 'end') {
            await writeQueue;
            if (total && received < total) {
              const err = new ShadownloaderNetworkError('Transfer ended before the full file was received.');
              try { conn.send({ t: 'error', message: err.message }); } catch {}
              throw err;
            }
            if (writer) await writer.close();
            onComplete?.({ received, total });
            try { conn.send({ t: 'ack', phase: 'end', received, total }); } catch {}
            return;
          }

          if (data.t === 'error') {
            throw new ShadownloaderNetworkError(data.message || 'Sender reported an error.');
          }
          return;
        }

        if (!writer) return;

        let buf;
        if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
        else if (ArrayBuffer.isView(data)) buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        else if (data instanceof Blob) buf = new Uint8Array(await data.arrayBuffer());
        else return;

        writeQueue = writeQueue.then(async () => {
          await writer.write(buf);
          received += buf.byteLength;
          const percent = total ? Math.min(100, (received / total) * 100) : 0;
          onProgress?.({ received, total, percent });
          const now = Date.now();
          if (received === total || now - lastProgressSentAt >= progressIntervalMs) {
            lastProgressSentAt = now;
            try { conn.send({ t: 'progress', received, total }); } catch {}
          }
        });
      } catch (err) {
        onError?.(err);
        stop();
      }
    });

    conn.on('close', () => {
      if (received > 0 && total > 0 && received < total) {
        onDisconnect?.();
      }
    });
  });

  return { peer, stop };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    }
  });
}

function makeAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timeoutId = null;

  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) abort(parentSignal.reason);
    else parentSignal.addEventListener('abort', () => abort(parentSignal.reason), { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => timeoutId && clearTimeout(timeoutId),
  };
}

async function fetchJson(fetchFn, url, opts = {}) {
  const { timeoutMs, signal, ...rest } = opts;
  const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
  try {
    const res = await fetchFn(url, { ...rest, signal: s });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore parse error
    }
    return { res, json, text };
  } finally {
    cleanup();
  }
}

export async function sha256Hex(cryptoObj, data) {
  // data: ArrayBuffer
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(hashBuffer);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

export async function generateAesGcmKey(cryptoObj) {
  return cryptoObj.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyBase64(cryptoObj, key) {
  const raw = await cryptoObj.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

export async function encryptToBlob(cryptoObj, dataBuffer, key) {
  const iv = cryptoObj.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv }, key, dataBuffer);
  // Layout: [IV (12 bytes)] + [ciphertext + tag]
  return new Blob([iv, new Uint8Array(encrypted)]);
}

export async function encryptFilenameToBase64(cryptoObj, filename, key) {
  const bytes = new TextEncoder().encode(String(filename));
  const blob = await encryptToBlob(cryptoObj, bytes.buffer, key);
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export function validatePlainFilename(filename) {
  if (typeof filename !== 'string' || filename.trim().length === 0) {
    throw new ShadownloaderValidationError('Invalid filename. Must be a non-empty string.');
  }
  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new ShadownloaderValidationError('Invalid filename. Contains illegal characters or is too long.');
  }
}

export function parseSemverMajorMinor(version) {
  const parts = String(version || '').split('.').map((p) => Number(p));
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  return { major, minor };
}

/**
 * Minimal, UI-agnostic client for Shadownloader uploads.
 */
export class ShadownloaderClient {
  /**
   * @param {{
   *  clientVersion: string,
   *  chunkSize?: number,
   *  fetchFn?: typeof fetch,
   *  cryptoObj?: Crypto,
   *  logger?: (level:'debug'|'info'|'warn'|'error', message:string, meta?:any) => void
   * }} opts
   */
  constructor(opts) {
    if (!opts || typeof opts.clientVersion !== 'string') {
      throw new ShadownloaderValidationError('ShadownloaderClient requires clientVersion (string).');
    }
    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize) ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    this.fetchFn = opts.fetchFn || globalThis.fetch?.bind(globalThis);
    this.cryptoObj = opts.cryptoObj || globalThis.crypto;
    this.logger = opts.logger || null;

    if (!this.fetchFn) throw new ShadownloaderValidationError('No fetch() implementation found.');
  }

  log(level, message, meta) {
    try {
      if (this.logger) this.logger(level, message, meta);
    } catch {
      // ignore logger failures
    }
  }

  /**
   * Normalises URL:
   *  - trims
   *  - removes trailing slashes
   *  - adds scheme if missing (defaults to https)
   *  - optionally probes https and falls back to http
   */
  async cleanServerUrl(url, opts = {}) {
    const {
      probeHttps = true,
      probeTimeoutMs = 3000,
    } = opts;

    if (!url || typeof url !== 'string') {
      throw new ShadownloaderValidationError('Server URL is missing.');
    }

    let clean = url.trim().replace(/\/+$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://' + clean;
    }

    if (!probeHttps) return clean;

    // If already http, do not try https.
    if (clean.startsWith('http://')) return clean;

    // Probe https with a HEAD (server has CORS enabled in server.js).
    try {
      const { signal, cleanup } = makeAbortSignal(null, probeTimeoutMs);
      try {
        const res = await this.fetchFn(clean, { method: 'HEAD', signal });
        if (res.ok) return clean;
      } finally {
        cleanup();
      }
    } catch {
      // fallthrough
    }

    this.log('warn', 'HTTPS probe failed; falling back to HTTP.', { url: clean });
    return clean.replace(/^https:\/\//, 'http://');
  }

  /**
   * Fetch server info from /api/info.
   * Falls back to GET / (legacy) only if /api/info is missing.
   * @returns {Promise<{cleanUrl:string, serverInfo:ServerInfo}>}
   */
  async getServerInfo(serverUrl, opts = {}) {
    const {
      timeoutMs = 5000,
      signal,
    } = opts;

    const cleanUrl = await this.cleanServerUrl(serverUrl, { probeHttps: true });

    try {
      const { res, json } = await fetchJson(this.fetchFn, `${cleanUrl}/api/info`, {
        method: 'GET',
        timeoutMs,
        signal,
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok && json?.version) {
        return { cleanUrl, serverInfo: json };
      }

      throw new ShadownloaderProtocolError(`Server info request failed (status ${res.status}).`);
    } catch (err) {
      throw new ShadownloaderNetworkError('Could not reach server /api/info.', { cause: err });
    }
  }

  /**
   * Resolve a user-entered sharing code via the server.
   * @returns {Promise<{valid:boolean, type?:string, target?:string, reason?:string}>}
   */
  async resolveShareTarget(serverUrl, value, opts = {}) {
    const {
      timeoutMs = 5000,
      signal,
    } = opts;

    const cleanUrl = await this.cleanServerUrl(serverUrl, { probeHttps: false });

    const { res, json } = await fetchJson(this.fetchFn, `${cleanUrl}/api/resolve`, {
      method: 'POST',
      timeoutMs,
      signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ value }),
    });

    if (!res.ok) {
      const msg = json?.error || `Share lookup failed (status ${res.status}).`;
      throw new ShadownloaderProtocolError(msg, { details: json });
    }

    return json || { valid: false, reason: 'Unknown response.' };
  }

  /**
   * @returns {{compatible:boolean, message:string, clientVersion:string, serverVersion:string}}
   */
  checkCompatibility(serverInfo) {
    const serverVersion = String(serverInfo?.version || '0.0.0');
    const clientVersion = String(this.clientVersion || '0.0.0');

    const c = parseSemverMajorMinor(clientVersion);
    const s = parseSemverMajorMinor(serverVersion);

    if (c.major !== s.major) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        message: `Incompatible versions. Client v${clientVersion}, Server v${serverVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ''}.`,
      };
    }

    if (c.minor > s.minor) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        message: `Client (v${clientVersion}) is newer than Server (v${serverVersion})${serverInfo?.name ? ` (${serverInfo.name})` : ''}. Some features may not work.`,
      };
    }

    return {
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Server: v${serverVersion}, Client: v${clientVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ''}.`,
    };
  }

  /**
   * Validates file + settings against server capabilities.
   * Throws ShadownloaderValidationError on failure.
   */
  validateUploadInputs({ file, lifetimeMs, encrypt, serverInfo }) {
    const caps = serverInfo?.capabilities?.upload;
    if (!caps || !caps.enabled) {
      // The server does not support uploads.
      throw new ShadownloaderValidationError('Server does not support file uploads.');
    }

    if (!(file instanceof File) && !(file instanceof Blob)) {
      throw new ShadownloaderValidationError('File is missing or invalid.');
    }

    // If it is a Blob without a name, the caller should provide filename separately.
    const fileSize = Number(file.size || 0);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      throw new ShadownloaderValidationError('Cannot upload empty (0 byte) files.');
    }

    // maxSizeMB: 0 means unlimited
    // Server compares against *reserved totalSize* (includes encryption overhead), so we mirror that here.
    const maxMB = Number(caps.maxSizeMB);
    if (Number.isFinite(maxMB) && maxMB > 0) {
      const limitBytes = maxMB * 1000 * 1000;
      const totalChunks = Math.ceil(fileSize / this.chunkSize);
      const estimatedBytes = estimateTotalUploadSizeBytes(fileSize, totalChunks, Boolean(encrypt));
      if (estimatedBytes > limitBytes) {
        const msg = encrypt
          ? `File too large once encryption overhead is included. Server limit: ${maxMB} MB.`
          : `File too large. Server limit: ${maxMB} MB.`;
        throw new ShadownloaderValidationError(msg);
      }
    }

    // maxLifetimeHours: 0 means unlimited is allowed
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new ShadownloaderValidationError('Invalid lifetime. Must be a non-negative integer (milliseconds).');
    }

    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1000);
      if (lt === 0) {
        throw new ShadownloaderValidationError(`Server does not allow unlimited file lifetime. Max: ${maxHours} hours.`);
      }
      if (lt > limitMs) {
        throw new ShadownloaderValidationError(`File lifetime too long. Server limit: ${maxHours} hours.`);
      }
    }

    // encryption support
    if (encrypt && !caps.e2ee) {
      throw new ShadownloaderValidationError('Server does not support end-to-end encryption.');
    }

    return true;
  }

  /**
   * Upload a file.
   *
   * @param {{
   *  serverUrl: string,
   *  file: File,
   *  lifetimeMs: number,
   *  encrypt: boolean,
   *  filenameOverride?: string,
   *  onProgress?: (evt: {phase:string, text?:string, percent?:number, chunkIndex?:number, totalChunks?:number}) => void,
   *  signal?: AbortSignal,
   *  timeouts?: {
   *    serverInfoMs?: number,
   *    initMs?: number,
   *    chunkMs?: number,
   *    completeMs?: number,
   *  },
   *  retry?: {
   *    retries?: number,
   *    backoffMs?: number,
   *    maxBackoffMs?: number,
   *  }
   * }} opts
   *
   * @returns {Promise<{downloadUrl:string, fileId:string, uploadId:string, cleanUrl:string, keyB64?:string}>}
   */
  async uploadFile(opts) {
    const {
      serverUrl,
      file,
      lifetimeMs,
      encrypt,
      filenameOverride,
      onProgress,
      signal,
      timeouts = {},
      retry = {},
    } = opts || {};

    const progress = (evt) => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
        // ignore UI callback failures
      }
    };

    if (!this.cryptoObj?.subtle) {
      throw new ShadownloaderValidationError('Web Crypto API not available (crypto.subtle).');
    }

    // 0) get server info + compat
    progress({ phase: 'server-info', text: 'Checking server...' });

    let cleanUrl, serverInfo;
    try {
      const res = await this.getServerInfo(serverUrl, { timeoutMs: timeouts.serverInfoMs ?? 5000, signal });
      cleanUrl = res.cleanUrl;
      serverInfo = res.serverInfo;
    } catch (err) {
      throw new ShadownloaderNetworkError('Could not connect to the server.', { cause: err });
    }

    const compat = this.checkCompatibility(serverInfo);
    progress({ phase: 'server-compat', text: compat.message });
    if (!compat.compatible) {
      throw new ShadownloaderValidationError(compat.message);
    }

    // 1) validate inputs
    const filename = filenameOverride ?? file.name ?? 'file';

    if (!encrypt) {
      validatePlainFilename(filename);
    }

    this.validateUploadInputs({ file, lifetimeMs, encrypt, serverInfo });

    // 2) encryption prep
    let cryptoKey = null;
    let keyB64 = null;
    let transmittedFilename = filename;

    if (encrypt) {
      progress({ phase: 'crypto', text: 'Generating encryption key...' });
      try {
        cryptoKey = await generateAesGcmKey(this.cryptoObj);
        keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
        transmittedFilename = await encryptFilenameToBase64(this.cryptoObj, filename, cryptoKey);
      } catch (err) {
        throw new ShadownloaderError('Failed to prepare encryption.', { code: 'CRYPTO_PREP_FAILED', cause: err });
      }
    }

    // 3) compute reservation sizes
    const totalChunks = Math.ceil(file.size / this.chunkSize);
    const totalUploadSize = estimateTotalUploadSizeBytes(file.size, totalChunks, encrypt);

    // 4) init
    progress({ phase: 'init', text: 'Reserving server storage...' });

    const initPayload = {
      filename: transmittedFilename,
      lifetime: lifetimeMs,
      isEncrypted: Boolean(encrypt),
      totalSize: totalUploadSize,
      totalChunks,
    };

    const initRes = await fetchJson(this.fetchFn, `${cleanUrl}/upload/init`, {
      method: 'POST',
      timeoutMs: timeouts.initMs ?? 15000,
      signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(initPayload),
    });

    if (!initRes.res.ok) {
      const msg = initRes.json?.error || `Server initialisation failed: ${initRes.res.status}`;
      throw new ShadownloaderProtocolError(msg, { details: initRes.json || initRes.text });
    }

    const uploadId = initRes.json?.uploadId;
    if (!uploadId || typeof uploadId !== 'string') {
      throw new ShadownloaderProtocolError('Server did not return a valid uploadId.');
    }

    // 5) chunks
    const retries = Number.isFinite(retry.retries) ? retry.retries : 5;
    const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs : 1000;
    const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs : 30000;

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');

      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      let chunkBlob = file.slice(start, end);

      const percentComplete = (i / totalChunks) * 100;
      progress({
        phase: 'chunk',
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: percentComplete,
        chunkIndex: i,
        totalChunks,
      });

      // encrypt (produces a Blob)
      if (encrypt) {
        const buf = await chunkBlob.arrayBuffer();
        chunkBlob = await encryptToBlob(this.cryptoObj, buf, cryptoKey);
      }

      // server validates: chunk <= 5MB + 1024, so keep chunkSize at 5MB.
      if (chunkBlob.size > (DEFAULT_CHUNK_SIZE + 1024)) {
        throw new ShadownloaderValidationError('Chunk too large (client-side). Check chunk size settings.');
      }

      // hash encrypted/plain payload
      const toHash = await chunkBlob.arrayBuffer();
      const hashHex = await sha256Hex(this.cryptoObj, toHash);

      const headers = {
        'Content-Type': 'application/octet-stream',
        'X-Upload-ID': uploadId,
        'X-Chunk-Index': String(i),
        'X-Chunk-Hash': hashHex,
      };

      const chunkUrl = `${cleanUrl}/upload/chunk`;
      await this.#attemptChunkUpload(chunkUrl, {
        method: 'POST',
        headers,
        body: chunkBlob,
      }, {
        retries,
        backoffMs: baseBackoffMs,
        maxBackoffMs,
        timeoutMs: timeouts.chunkMs ?? 60000,
        signal,
        progress,
        chunkIndex: i,
        totalChunks,
      });
    }

    // 6) complete
    progress({ phase: 'complete', text: 'Finalising upload...', percent: 100 });

    const completeRes = await fetchJson(this.fetchFn, `${cleanUrl}/upload/complete`, {
      method: 'POST',
      timeoutMs: timeouts.completeMs ?? 30000,
      signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });

    if (!completeRes.res.ok) {
      const msg = completeRes.json?.error || 'Finalisation failed.';
      throw new ShadownloaderProtocolError(msg, { details: completeRes.json || completeRes.text });
    }

    const fileId = completeRes.json?.id;
    if (!fileId || typeof fileId !== 'string') {
      throw new ShadownloaderProtocolError('Server did not return a valid file id.');
    }

    let downloadUrl = `${cleanUrl}/${fileId}`;
    if (encrypt) downloadUrl += `#${keyB64}`;

    progress({ phase: 'done', text: 'Upload successful!', percent: 100 });

    return {
      downloadUrl,
      fileId,
      uploadId,
      cleanUrl,
      ...(encrypt ? { keyB64 } : {}),
    };
  }

  async #attemptChunkUpload(url, fetchOptions, opts) {
    const {
      retries,
      backoffMs,
      maxBackoffMs,
      timeoutMs,
      signal,
      progress,
      chunkIndex,
      totalChunks,
    } = opts;

    let attemptsLeft = retries;
    let currentBackoff = backoffMs;
    const maxRetries = retries;

    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');

      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        const res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        if (res.ok) return;

        // non-ok => maybe retriable, but let retries handle it
        const text = await res.text().catch(() => '');
        const err = new ShadownloaderProtocolError(`Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`, {
          details: { status: res.status, bodySnippet: text.slice(0, 120) },
        });
        throw err;
      } catch (err) {
        cleanup();

        // AbortError should not retry.
        if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') throw err;
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');

        if (attemptsLeft <= 0) {
          throw err instanceof ShadownloaderError ? err : new ShadownloaderNetworkError('Chunk upload failed.', { cause: err });
        }

        const attemptNumber = (maxRetries - attemptsLeft) + 1;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1000).toFixed(1);
          progress?.({
            phase: 'retry-wait',
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`,
            chunkIndex,
            totalChunks,
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }

        progress?.({
          phase: 'retry',
          text: `Chunk upload failed. Retrying now... (${attemptNumber}/${maxRetries})`,
          chunkIndex,
          totalChunks,
        });

        attemptsLeft -= 1;
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        continue;
      } finally {
        cleanup();
      }
    }
  }
}

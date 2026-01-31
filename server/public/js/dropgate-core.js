var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/constants.ts
var DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
var AES_GCM_IV_BYTES = 12;
var AES_GCM_TAG_BYTES = 16;
var ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
var MAX_IN_MEMORY_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// src/errors.ts
var DropgateError = class extends Error {
  constructor(message, opts = {}) {
    super(message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    __publicField(this, "code");
    __publicField(this, "details");
    this.name = this.constructor.name;
    this.code = opts.code || "DROPGATE_ERROR";
    this.details = opts.details;
  }
};
var DropgateValidationError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "VALIDATION_ERROR" });
  }
};
var DropgateNetworkError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "NETWORK_ERROR" });
  }
};
var DropgateProtocolError = class extends DropgateError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code || "PROTOCOL_ERROR" });
  }
};
var DropgateAbortError = class extends DropgateError {
  constructor(message = "Operation aborted") {
    super(message, { code: "ABORT_ERROR" });
    this.name = "AbortError";
  }
};
var DropgateTimeoutError = class extends DropgateError {
  constructor(message = "Request timed out") {
    super(message, { code: "TIMEOUT_ERROR" });
    this.name = "TimeoutError";
  }
};

// src/adapters/defaults.ts
function getDefaultBase64() {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return {
      encode(bytes) {
        return Buffer.from(bytes).toString("base64");
      },
      decode(b64) {
        return new Uint8Array(Buffer.from(b64, "base64"));
      }
    };
  }
  if (typeof btoa === "function" && typeof atob === "function") {
    return {
      encode(bytes) {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      },
      decode(b64) {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          out[i] = binary.charCodeAt(i);
        }
        return out;
      }
    };
  }
  throw new Error(
    "No Base64 implementation available. Provide a Base64Adapter via options."
  );
}
function getDefaultCrypto() {
  return globalThis.crypto;
}
function getDefaultFetch() {
  return globalThis.fetch?.bind(globalThis);
}

// src/utils/base64.ts
var defaultAdapter = null;
function getAdapter(adapter) {
  if (adapter) return adapter;
  if (!defaultAdapter) {
    defaultAdapter = getDefaultBase64();
  }
  return defaultAdapter;
}
function bytesToBase64(bytes, adapter) {
  return getAdapter(adapter).encode(bytes);
}
function arrayBufferToBase64(buf, adapter) {
  return bytesToBase64(new Uint8Array(buf), adapter);
}
function base64ToBytes(b64, adapter) {
  return getAdapter(adapter).decode(b64);
}

// src/utils/lifetime.ts
var MULTIPLIERS = {
  minutes: 60 * 1e3,
  hours: 60 * 60 * 1e3,
  days: 24 * 60 * 60 * 1e3
};
function lifetimeToMs(value, unit) {
  const u = String(unit || "").toLowerCase();
  const v = Number(value);
  if (u === "unlimited") return 0;
  if (!Number.isFinite(v) || v <= 0) return 0;
  const m = MULTIPLIERS[u];
  if (!m) return 0;
  return Math.round(v * m);
}

// src/utils/semver.ts
function parseSemverMajorMinor(version) {
  const parts = String(version || "").split(".").map((p) => Number(p));
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  return { major, minor };
}

// src/utils/filename.ts
function validatePlainFilename(filename) {
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw new DropgateValidationError(
      "Invalid filename. Must be a non-empty string."
    );
  }
  if (filename.length > 255 || /[\/\\]/.test(filename)) {
    throw new DropgateValidationError(
      "Invalid filename. Contains illegal characters or is too long."
    );
  }
}

// src/utils/network.ts
function parseServerUrl(urlStr) {
  let normalized = urlStr.trim();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : void 0,
    secure: url.protocol === "https:"
  };
}
function buildBaseUrl(opts) {
  const { host, port, secure } = opts;
  if (!host || typeof host !== "string") {
    throw new DropgateValidationError("Server host is required.");
  }
  const protocol = secure === false ? "http" : "https";
  const portSuffix = port ? `:${port}` : "";
  return `${protocol}://${host}${portSuffix}`;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new DropgateAbortError());
    }
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason || new DropgateAbortError());
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
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", () => abort(parentSignal.reason), {
        once: true
      });
    }
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      abort(new DropgateTimeoutError());
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
    }
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
    }
    return { res, json, text };
  } finally {
    cleanup();
  }
}

// src/crypto/sha256-fallback.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha256Fallback(data) {
  const bytes = new Uint8Array(data);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(
    Math.ceil((bytes.length + 9) / 64) * 64
  );
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen / 4294967296 >>> 0, false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  let h0 = 1779033703;
  let h1 = 3144134277;
  let h2 = 1013904242;
  let h3 = 2773480762;
  let h4 = 1359893119;
  let h5 = 2600822924;
  let h6 = 528734635;
  let h7 = 1541459225;
  const W = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ W[i - 15] >>> 3;
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ W[i - 2] >>> 10;
      W[i] = W[i - 16] + s0 + W[i - 7] + s1 | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = h + S1 + ch + K[i] + W[i] | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj | 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 | 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 | 0;
    }
    h0 = h0 + a | 0;
    h1 = h1 + b | 0;
    h2 = h2 + c | 0;
    h3 = h3 + d | 0;
    h4 = h4 + e | 0;
    h5 = h5 + f | 0;
    h6 = h6 + g | 0;
    h7 = h7 + h | 0;
  }
  const result = new ArrayBuffer(32);
  const out = new DataView(result);
  out.setUint32(0, h0, false);
  out.setUint32(4, h1, false);
  out.setUint32(8, h2, false);
  out.setUint32(12, h3, false);
  out.setUint32(16, h4, false);
  out.setUint32(20, h5, false);
  out.setUint32(24, h6, false);
  out.setUint32(28, h7, false);
  return result;
}

// src/crypto/decrypt.ts
async function importKeyFromBase64(cryptoObj, keyB64, base64) {
  const adapter = base64 || getDefaultBase64();
  const keyBytes = adapter.decode(keyB64);
  const keyBuffer = new Uint8Array(keyBytes).buffer;
  return cryptoObj.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    true,
    ["decrypt"]
  );
}
async function decryptChunk(cryptoObj, encryptedData, key) {
  const iv = encryptedData.slice(0, AES_GCM_IV_BYTES);
  const ciphertext = encryptedData.slice(AES_GCM_IV_BYTES);
  return cryptoObj.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
}
async function decryptFilenameFromBase64(cryptoObj, encryptedFilenameB64, key, base64) {
  const adapter = base64 || getDefaultBase64();
  const encryptedBytes = adapter.decode(encryptedFilenameB64);
  const decryptedBuffer = await decryptChunk(cryptoObj, encryptedBytes, key);
  return new TextDecoder().decode(decryptedBuffer);
}

// src/crypto/index.ts
function digestToHex(hashBuffer) {
  const arr = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}
async function sha256Hex(cryptoObj, data) {
  if (cryptoObj?.subtle) {
    const hashBuffer = await cryptoObj.subtle.digest("SHA-256", data);
    return digestToHex(hashBuffer);
  }
  return digestToHex(sha256Fallback(data));
}
async function generateAesGcmKey(cryptoObj) {
  return cryptoObj.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}
async function exportKeyBase64(cryptoObj, key) {
  const raw = await cryptoObj.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

// src/crypto/encrypt.ts
async function encryptToBlob(cryptoObj, dataBuffer, key) {
  const iv = cryptoObj.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const encrypted = await cryptoObj.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    dataBuffer
  );
  return new Blob([iv, new Uint8Array(encrypted)]);
}
async function encryptFilenameToBase64(cryptoObj, filename, key) {
  const bytes = new TextEncoder().encode(String(filename));
  const blob = await encryptToBlob(cryptoObj, bytes.buffer, key);
  const buf = await blob.arrayBuffer();
  return arrayBufferToBase64(buf);
}

// src/p2p/utils.ts
function isLocalhostHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function isSecureContextForP2P(hostname, isSecureContext) {
  return Boolean(isSecureContext) || isLocalhostHostname(hostname || "");
}
function generateP2PCode(cryptoObj) {
  const crypto2 = cryptoObj || getDefaultCrypto();
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  if (crypto2) {
    const randomBytes = new Uint8Array(8);
    crypto2.getRandomValues(randomBytes);
    let letterPart = "";
    for (let i = 0; i < 4; i++) {
      letterPart += letters[randomBytes[i] % letters.length];
    }
    let numberPart = "";
    for (let i = 4; i < 8; i++) {
      numberPart += (randomBytes[i] % 10).toString();
    }
    return `${letterPart}-${numberPart}`;
  }
  let a = "";
  for (let i = 0; i < 4; i++) {
    a += letters[Math.floor(Math.random() * letters.length)];
  }
  let b = "";
  for (let i = 0; i < 4; i++) {
    b += Math.floor(Math.random() * 10);
  }
  return `${a}-${b}`;
}
function isP2PCodeLike(code) {
  return /^[A-Z]{4}-\d{4}$/.test(String(code || "").trim());
}

// src/p2p/helpers.ts
function resolvePeerConfig(userConfig, serverCaps) {
  return {
    path: userConfig.peerjsPath ?? serverCaps?.peerjsPath ?? "/peerjs",
    iceServers: userConfig.iceServers ?? serverCaps?.iceServers ?? []
  };
}
function buildPeerOptions(config = {}) {
  const { host, port, peerjsPath = "/peerjs", secure = false, iceServers = [] } = config;
  const peerOpts = {
    host,
    path: peerjsPath,
    secure,
    config: { iceServers },
    debug: 0
  };
  if (port) {
    peerOpts.port = port;
  }
  return peerOpts;
}
async function createPeerWithRetries(opts) {
  const { code, codeGenerator, maxAttempts, buildPeer, onCode } = opts;
  let nextCode = code || codeGenerator();
  let peer = null;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onCode?.(nextCode, attempt);
    try {
      peer = await new Promise((resolve, reject) => {
        const instance = buildPeer(nextCode);
        instance.on("open", () => resolve(instance));
        instance.on("error", (err) => {
          try {
            instance.destroy();
          } catch {
          }
          reject(err);
        });
      });
      return { peer, code: nextCode };
    } catch (err) {
      lastError = err;
      nextCode = codeGenerator();
    }
  }
  throw lastError || new DropgateNetworkError("Could not establish PeerJS connection.");
}

// src/p2p/protocol.ts
var P2P_PROTOCOL_VERSION = 2;
function isP2PMessage(value) {
  if (!value || typeof value !== "object") return false;
  const msg = value;
  return typeof msg.t === "string" && [
    "hello",
    "meta",
    "ready",
    "chunk",
    "chunk_ack",
    "end",
    "end_ack",
    "ping",
    "pong",
    "error",
    "cancelled",
    "resume",
    "resume_ack"
  ].includes(msg.t);
}
var P2P_CHUNK_SIZE = 64 * 1024;
var P2P_MAX_UNACKED_CHUNKS = 32;
var P2P_END_ACK_TIMEOUT_MS = 15e3;
var P2P_END_ACK_RETRIES = 3;
var P2P_END_ACK_RETRY_DELAY_MS = 100;
var P2P_CLOSE_GRACE_PERIOD_MS = 2e3;

// src/p2p/send.ts
function generateSessionId() {
  return crypto.randomUUID();
}
var ALLOWED_TRANSITIONS = {
  initializing: ["listening", "closed"],
  listening: ["handshaking", "closed", "cancelled"],
  handshaking: ["negotiating", "closed", "cancelled"],
  negotiating: ["transferring", "closed", "cancelled"],
  transferring: ["finishing", "closed", "cancelled"],
  finishing: ["awaiting_ack", "closed", "cancelled"],
  awaiting_ack: ["completed", "closed", "cancelled"],
  completed: ["closed"],
  cancelled: ["closed"],
  closed: []
};
async function startP2PSend(opts) {
  const {
    file,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    codeGenerator,
    cryptoObj,
    maxAttempts = 4,
    chunkSize = P2P_CHUNK_SIZE,
    endAckTimeoutMs = P2P_END_ACK_TIMEOUT_MS,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    heartbeatIntervalMs = 5e3,
    chunkAcknowledgments = true,
    maxUnackedChunks = P2P_MAX_UNACKED_CHUNKS,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel,
    onConnectionHealth
  } = opts;
  if (!file) {
    throw new DropgateValidationError("File is missing.");
  }
  if (!Peer) {
    throw new DropgateValidationError(
      "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    );
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError("Direct transfer is disabled on this server.");
  }
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers
  });
  const finalCodeGenerator = codeGenerator || (() => generateP2PCode(cryptoObj));
  const buildPeer = (id) => new Peer(id, peerOpts);
  const { peer, code } = await createPeerWithRetries({
    code: null,
    codeGenerator: finalCodeGenerator,
    maxAttempts,
    buildPeer,
    onCode
  });
  const sessionId = generateSessionId();
  let state = "listening";
  let activeConn = null;
  let sentBytes = 0;
  let heartbeatTimer = null;
  let healthCheckTimer = null;
  let lastActivityTime = Date.now();
  const unackedChunks = /* @__PURE__ */ new Map();
  let nextSeq = 0;
  let ackResolvers = [];
  const transitionTo = (newState) => {
    if (!ALLOWED_TRANSITIONS[state].includes(newState)) {
      console.warn(`[P2P Send] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };
  const reportProgress = (data) => {
    const safeTotal = Number.isFinite(data.total) && data.total > 0 ? data.total : file.size;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    const percent = safeTotal ? safeReceived / safeTotal * 100 : 0;
    onProgress?.({ processedBytes: safeReceived, totalBytes: safeTotal, percent });
  };
  const safeError = (err) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err);
    cleanup();
  };
  const safeComplete = () => {
    if (state !== "awaiting_ack" && state !== "finishing") return;
    transitionTo("completed");
    onComplete?.();
    cleanup();
  };
  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    ackResolvers.forEach((resolve) => resolve());
    ackResolvers = [];
    unackedChunks.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleUnload);
    }
    try {
      activeConn?.close();
    } catch {
    }
    try {
      peer.destroy();
    } catch {
    }
  };
  const handleUnload = () => {
    try {
      activeConn?.send({ t: "error", message: "Sender closed the connection." });
    } catch {
    }
    stop();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleUnload);
  }
  const stop = () => {
    if (state === "closed" || state === "cancelled") return;
    const wasActive = state === "transferring" || state === "finishing" || state === "awaiting_ack";
    transitionTo("cancelled");
    try {
      if (activeConn && activeConn.open) {
        activeConn.send({ t: "cancelled", message: "Sender cancelled the transfer." });
      }
    } catch {
    }
    if (wasActive && onCancel) {
      onCancel({ cancelledBy: "sender" });
    }
    cleanup();
  };
  const isStopped = () => state === "closed" || state === "cancelled";
  const startHealthMonitoring = (conn) => {
    if (!onConnectionHealth) return;
    healthCheckTimer = setInterval(() => {
      const dc = conn._dc;
      if (!dc) return;
      const health = {
        iceConnectionState: dc.readyState === "open" ? "connected" : "disconnected",
        bufferedAmount: dc.bufferedAmount,
        lastActivityMs: Date.now() - lastActivityTime
      };
      onConnectionHealth(health);
    }, 2e3);
  };
  const handleChunkAck = (msg) => {
    lastActivityTime = Date.now();
    unackedChunks.delete(msg.seq);
    reportProgress({ received: msg.received, total: file.size });
    const resolver = ackResolvers.shift();
    if (resolver) resolver();
  };
  const waitForAck = () => {
    return new Promise((resolve) => {
      ackResolvers.push(resolve);
    });
  };
  const sendChunk = async (conn, data, offset) => {
    if (chunkAcknowledgments) {
      while (unackedChunks.size >= maxUnackedChunks) {
        await Promise.race([
          waitForAck(),
          sleep(1e3)
          // Timeout to prevent deadlock
        ]);
        if (isStopped()) return;
      }
    }
    const seq = nextSeq++;
    if (chunkAcknowledgments) {
      unackedChunks.set(seq, { offset, size: data.byteLength, sentAt: Date.now() });
    }
    conn.send({ t: "chunk", seq, offset, size: data.byteLength, total: file.size });
    conn.send(data);
    sentBytes += data.byteLength;
    const dc = conn._dc;
    if (dc && bufferHighWaterMark > 0) {
      while (dc.bufferedAmount > bufferHighWaterMark) {
        await new Promise((resolve) => {
          const fallback = setTimeout(resolve, 60);
          try {
            dc.addEventListener(
              "bufferedamountlow",
              () => {
                clearTimeout(fallback);
                resolve();
              },
              { once: true }
            );
          } catch {
          }
        });
        if (isStopped()) return;
      }
    }
  };
  const waitForEndAck = async (conn, ackPromise) => {
    const baseTimeout = endAckTimeoutMs;
    for (let attempt = 0; attempt < P2P_END_ACK_RETRIES; attempt++) {
      conn.send({ t: "end", attempt });
      const timeout = baseTimeout * Math.pow(1.5, attempt);
      const result = await Promise.race([
        ackPromise,
        sleep(timeout).then(() => null)
      ]);
      if (result && result.t === "end_ack") {
        return result;
      }
      if (isStopped()) {
        throw new DropgateNetworkError("Connection closed during completion.");
      }
    }
    throw new DropgateNetworkError("Receiver did not confirm completion after retries.");
  };
  peer.on("connection", (conn) => {
    if (state === "closed") return;
    if (activeConn) {
      const isOldConnOpen = activeConn.open !== false;
      if (isOldConnOpen && state === "transferring") {
        try {
          conn.send({ t: "error", message: "Transfer already in progress." });
        } catch {
        }
        try {
          conn.close();
        } catch {
        }
        return;
      } else if (!isOldConnOpen) {
        try {
          activeConn.close();
        } catch {
        }
        activeConn = null;
        state = "listening";
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
      } else {
        try {
          conn.send({ t: "error", message: "Another receiver is already connected." });
        } catch {
        }
        try {
          conn.close();
        } catch {
        }
        return;
      }
    }
    activeConn = conn;
    transitionTo("handshaking");
    onStatus?.({ phase: "connected", message: "Receiver connected." });
    lastActivityTime = Date.now();
    let helloResolve = null;
    let readyResolve = null;
    let endAckResolve = null;
    const helloPromise = new Promise((resolve) => {
      helloResolve = resolve;
    });
    const readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const endAckPromise = new Promise((resolve) => {
      endAckResolve = resolve;
    });
    conn.on("data", (data) => {
      lastActivityTime = Date.now();
      if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return;
      }
      if (!isP2PMessage(data)) return;
      const msg = data;
      switch (msg.t) {
        case "hello":
          helloResolve?.(msg.protocolVersion);
          break;
        case "ready":
          onStatus?.({ phase: "transferring", message: "Receiver accepted. Starting transfer..." });
          readyResolve?.();
          break;
        case "chunk_ack":
          handleChunkAck(msg);
          break;
        case "end_ack":
          endAckResolve?.(msg);
          break;
        case "pong":
          break;
        case "error":
          safeError(new DropgateNetworkError(msg.message || "Receiver reported an error."));
          break;
        case "cancelled":
          if (state === "cancelled" || state === "closed" || state === "completed") return;
          transitionTo("cancelled");
          onCancel?.({ cancelledBy: "receiver", message: msg.reason });
          cleanup();
          break;
      }
    });
    conn.on("open", async () => {
      try {
        if (isStopped()) return;
        startHealthMonitoring(conn);
        conn.send({
          t: "hello",
          protocolVersion: P2P_PROTOCOL_VERSION,
          sessionId
        });
        const receiverVersion = await Promise.race([
          helloPromise,
          sleep(1e4).then(() => null)
        ]);
        if (isStopped()) return;
        if (receiverVersion === null) {
          throw new DropgateNetworkError("Receiver did not respond to handshake.");
        } else if (receiverVersion !== P2P_PROTOCOL_VERSION) {
          throw new DropgateNetworkError(
            `Protocol version mismatch: sender v${P2P_PROTOCOL_VERSION}, receiver v${receiverVersion}`
          );
        }
        transitionTo("negotiating");
        onStatus?.({ phase: "waiting", message: "Connected. Waiting for receiver to accept..." });
        conn.send({
          t: "meta",
          sessionId,
          name: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream"
        });
        const total = file.size;
        const dc = conn._dc;
        if (dc && Number.isFinite(bufferLowWaterMark)) {
          try {
            dc.bufferedAmountLowThreshold = bufferLowWaterMark;
          } catch {
          }
        }
        await readyPromise;
        if (isStopped()) return;
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (state === "transferring" || state === "finishing" || state === "awaiting_ack") {
              try {
                conn.send({ t: "ping", timestamp: Date.now() });
              } catch {
              }
            }
          }, heartbeatIntervalMs);
        }
        transitionTo("transferring");
        for (let offset = 0; offset < total; offset += chunkSize) {
          if (isStopped()) return;
          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          if (isStopped()) return;
          await sendChunk(conn, buf, offset);
        }
        if (isStopped()) return;
        transitionTo("finishing");
        transitionTo("awaiting_ack");
        const ackResult = await waitForEndAck(conn, endAckPromise);
        if (isStopped()) return;
        const ackTotal = Number(ackResult.total) || file.size;
        const ackReceived = Number(ackResult.received) || 0;
        if (ackTotal && ackReceived < ackTotal) {
          throw new DropgateNetworkError("Receiver reported an incomplete transfer.");
        }
        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        safeComplete();
      } catch (err) {
        safeError(err);
      }
    });
    conn.on("error", (err) => {
      safeError(err);
    });
    conn.on("close", () => {
      if (state === "closed" || state === "completed" || state === "cancelled") {
        cleanup();
        return;
      }
      if (state === "awaiting_ack") {
        setTimeout(() => {
          if (state === "awaiting_ack") {
            safeError(new DropgateNetworkError("Connection closed while awaiting confirmation."));
          }
        }, P2P_CLOSE_GRACE_PERIOD_MS);
        return;
      }
      if (state === "transferring" || state === "finishing") {
        transitionTo("cancelled");
        onCancel?.({ cancelledBy: "receiver" });
        cleanup();
      } else {
        activeConn = null;
        state = "listening";
        sentBytes = 0;
        nextSeq = 0;
        unackedChunks.clear();
        onDisconnect?.();
      }
    });
  });
  return {
    peer,
    code,
    sessionId,
    stop,
    getStatus: () => state,
    getBytesSent: () => sentBytes,
    getConnectedPeerId: () => {
      if (!activeConn) return null;
      return activeConn.peer || null;
    }
  };
}

// src/p2p/receive.ts
var ALLOWED_TRANSITIONS2 = {
  initializing: ["connecting", "closed"],
  connecting: ["handshaking", "closed", "cancelled"],
  handshaking: ["negotiating", "closed", "cancelled"],
  negotiating: ["transferring", "closed", "cancelled"],
  transferring: ["completed", "closed", "cancelled"],
  completed: ["closed"],
  cancelled: ["closed"],
  closed: []
};
async function startP2PReceive(opts) {
  const {
    code,
    Peer,
    serverInfo,
    host,
    port,
    peerjsPath,
    secure = false,
    iceServers,
    autoReady = true,
    watchdogTimeoutMs = 15e3,
    onStatus,
    onMeta,
    onData,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel
  } = opts;
  if (!code) {
    throw new DropgateValidationError("No sharing code was provided.");
  }
  if (!Peer) {
    throw new DropgateValidationError(
      "PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option."
    );
  }
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError("Direct transfer is disabled on this server.");
  }
  const normalizedCode = String(code).trim().replace(/\s+/g, "").toUpperCase();
  if (!isP2PCodeLike(normalizedCode)) {
    throw new DropgateValidationError("Invalid direct transfer code.");
  }
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers
  });
  const peer = new Peer(void 0, peerOpts);
  let state = "initializing";
  let total = 0;
  let received = 0;
  let currentSessionId = null;
  let writeQueue = Promise.resolve();
  let watchdogTimer = null;
  let activeConn = null;
  let pendingChunk = null;
  const transitionTo = (newState) => {
    if (!ALLOWED_TRANSITIONS2[state].includes(newState)) {
      console.warn(`[P2P Receive] Invalid state transition: ${state} -> ${newState}`);
      return false;
    }
    state = newState;
    return true;
  };
  const resetWatchdog = () => {
    if (watchdogTimeoutMs <= 0) return;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }
    watchdogTimer = setTimeout(() => {
      if (state === "transferring") {
        safeError(new DropgateNetworkError("Connection timed out (no data received)."));
      }
    }, watchdogTimeoutMs);
  };
  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };
  const safeError = (err) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    transitionTo("closed");
    onError?.(err);
    cleanup();
  };
  const safeComplete = (completeData) => {
    if (state !== "transferring") return;
    transitionTo("completed");
    onComplete?.(completeData);
  };
  const cleanup = () => {
    clearWatchdog();
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleUnload);
    }
    try {
      peer.destroy();
    } catch {
    }
  };
  const handleUnload = () => {
    try {
      activeConn?.send({ t: "error", message: "Receiver closed the connection." });
    } catch {
    }
    stop();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", handleUnload);
  }
  const stop = () => {
    if (state === "closed" || state === "cancelled") return;
    const wasActive = state === "transferring";
    transitionTo("cancelled");
    try {
      if (activeConn && activeConn.open) {
        activeConn.send({ t: "cancelled", reason: "Receiver cancelled the transfer." });
      }
    } catch {
    }
    if (wasActive && onCancel) {
      onCancel({ cancelledBy: "receiver" });
    }
    cleanup();
  };
  const sendChunkAck = (conn, seq) => {
    try {
      conn.send({ t: "chunk_ack", seq, received });
    } catch {
    }
  };
  peer.on("error", (err) => {
    safeError(err);
  });
  peer.on("open", () => {
    transitionTo("connecting");
    const conn = peer.connect(normalizedCode, { reliable: true });
    activeConn = conn;
    conn.on("open", () => {
      transitionTo("handshaking");
      onStatus?.({ phase: "connected", message: "Connected." });
      conn.send({
        t: "hello",
        protocolVersion: P2P_PROTOCOL_VERSION,
        sessionId: ""
      });
    });
    conn.on("data", async (data) => {
      try {
        resetWatchdog();
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || typeof Blob !== "undefined" && data instanceof Blob) {
          let bufPromise;
          if (data instanceof ArrayBuffer) {
            bufPromise = Promise.resolve(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            bufPromise = Promise.resolve(
              new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            );
          } else if (typeof Blob !== "undefined" && data instanceof Blob) {
            bufPromise = data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
          } else {
            return;
          }
          const chunkSeq = pendingChunk?.seq ?? -1;
          pendingChunk = null;
          writeQueue = writeQueue.then(async () => {
            const buf = await bufPromise;
            if (onData) {
              await onData(buf);
            }
            received += buf.byteLength;
            const percent = total ? Math.min(100, received / total * 100) : 0;
            onProgress?.({ processedBytes: received, totalBytes: total, percent });
            if (chunkSeq >= 0) {
              sendChunkAck(conn, chunkSeq);
            }
          }).catch((err) => {
            try {
              conn.send({
                t: "error",
                message: err?.message || "Receiver write failed."
              });
            } catch {
            }
            safeError(err);
          });
          return;
        }
        if (!isP2PMessage(data)) return;
        const msg = data;
        switch (msg.t) {
          case "hello":
            currentSessionId = msg.sessionId || null;
            transitionTo("negotiating");
            onStatus?.({ phase: "waiting", message: "Waiting for file details..." });
            break;
          case "meta": {
            if (state !== "negotiating") {
              return;
            }
            if (currentSessionId && msg.sessionId && msg.sessionId !== currentSessionId) {
              try {
                conn.send({ t: "error", message: "Busy with another session." });
              } catch {
              }
              return;
            }
            if (msg.sessionId) {
              currentSessionId = msg.sessionId;
            }
            const name = String(msg.name || "file");
            total = Number(msg.size) || 0;
            received = 0;
            writeQueue = Promise.resolve();
            const sendReady = () => {
              transitionTo("transferring");
              resetWatchdog();
              try {
                conn.send({ t: "ready" });
              } catch {
              }
            };
            if (autoReady) {
              onMeta?.({ name, total });
              onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              sendReady();
            } else {
              onMeta?.({ name, total, sendReady });
              onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
            }
            break;
          }
          case "chunk":
            pendingChunk = msg;
            break;
          case "ping":
            try {
              conn.send({ t: "pong", timestamp: Date.now() });
            } catch {
            }
            break;
          case "end":
            clearWatchdog();
            await writeQueue;
            if (total && received < total) {
              const err = new DropgateNetworkError(
                "Transfer ended before the full file was received."
              );
              try {
                conn.send({ t: "error", message: err.message });
              } catch {
              }
              throw err;
            }
            try {
              conn.send({ t: "end_ack", received, total });
            } catch {
            }
            safeComplete({ received, total });
            (async () => {
              for (let i = 0; i < 2; i++) {
                await sleep(P2P_END_ACK_RETRY_DELAY_MS);
                try {
                  conn.send({ t: "end_ack", received, total });
                } catch {
                  break;
                }
              }
            })().catch(() => {
            });
            break;
          case "error":
            throw new DropgateNetworkError(msg.message || "Sender reported an error.");
          case "cancelled":
            if (state === "cancelled" || state === "closed" || state === "completed") return;
            transitionTo("cancelled");
            onCancel?.({ cancelledBy: "sender", message: msg.reason });
            cleanup();
            break;
        }
      } catch (err) {
        safeError(err);
      }
    });
    conn.on("close", () => {
      if (state === "closed" || state === "completed" || state === "cancelled") {
        cleanup();
        return;
      }
      if (state === "transferring") {
        transitionTo("cancelled");
        onCancel?.({ cancelledBy: "sender" });
        cleanup();
      } else if (state === "negotiating") {
        transitionTo("closed");
        cleanup();
        onDisconnect?.();
      } else {
        safeError(new DropgateNetworkError("Sender disconnected before file details were received."));
      }
    });
  });
  return {
    peer,
    stop,
    getStatus: () => state,
    getBytesReceived: () => received,
    getTotalBytes: () => total,
    getSessionId: () => currentSessionId
  };
}

// src/client/DropgateClient.ts
function resolveServerToBaseUrl(server) {
  if (typeof server === "string") {
    return buildBaseUrl(parseServerUrl(server));
  }
  return buildBaseUrl(server);
}
function estimateTotalUploadSizeBytes(fileSizeBytes, totalChunks, isEncrypted) {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}
async function getServerInfo(opts) {
  const { server, timeoutMs = 5e3, signal, fetchFn: customFetch } = opts;
  const fetchFn = customFetch || getDefaultFetch();
  if (!fetchFn) {
    throw new DropgateValidationError("No fetch() implementation found.");
  }
  const baseUrl = resolveServerToBaseUrl(server);
  try {
    const { res, json } = await fetchJson(
      fetchFn,
      `${baseUrl}/api/info`,
      {
        method: "GET",
        timeoutMs,
        signal,
        headers: { Accept: "application/json" }
      }
    );
    if (res.ok && json && typeof json === "object" && "version" in json) {
      return { baseUrl, serverInfo: json };
    }
    throw new DropgateProtocolError(
      `Server info request failed (status ${res.status}).`
    );
  } catch (err) {
    if (err instanceof DropgateError) throw err;
    throw new DropgateNetworkError("Could not reach server /api/info.", {
      cause: err
    });
  }
}
var DropgateClient = class {
  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options including server URL.
   * @throws {DropgateValidationError} If clientVersion or server is missing or invalid.
   */
  constructor(opts) {
    /** Client version string for compatibility checking. */
    __publicField(this, "clientVersion");
    /** Chunk size in bytes for upload splitting. */
    __publicField(this, "chunkSize");
    /** Fetch implementation used for HTTP requests. */
    __publicField(this, "fetchFn");
    /** Crypto implementation for encryption operations. */
    __publicField(this, "cryptoObj");
    /** Base64 encoder/decoder for binary data. */
    __publicField(this, "base64");
    /** Resolved base URL (e.g. 'https://dropgate.link'). May change during HTTP fallback. */
    __publicField(this, "baseUrl");
    /** Whether to automatically retry with HTTP when HTTPS fails. */
    __publicField(this, "_fallbackToHttp");
    /** Cached compatibility result (null until first connect()). */
    __publicField(this, "_compat", null);
    /** In-flight connect promise to deduplicate concurrent calls. */
    __publicField(this, "_connectPromise", null);
    if (!opts || typeof opts.clientVersion !== "string") {
      throw new DropgateValidationError(
        "DropgateClient requires clientVersion (string)."
      );
    }
    if (!opts.server) {
      throw new DropgateValidationError(
        "DropgateClient requires server (URL string or ServerTarget object)."
      );
    }
    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize) ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateValidationError("No fetch() implementation found.");
    }
    this.fetchFn = fetchFn;
    const cryptoObj = opts.cryptoObj || getDefaultCrypto();
    if (!cryptoObj) {
      throw new DropgateValidationError("No crypto implementation found.");
    }
    this.cryptoObj = cryptoObj;
    this.base64 = opts.base64 || getDefaultBase64();
    this._fallbackToHttp = Boolean(opts.fallbackToHttp);
    this.baseUrl = resolveServerToBaseUrl(opts.server);
  }
  /**
   * Get the server target (host, port, secure) derived from the current baseUrl.
   * Useful for passing to standalone functions that still need a ServerTarget.
   */
  get serverTarget() {
    const url = new URL(this.baseUrl);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : void 0,
      secure: url.protocol === "https:"
    };
  }
  /**
   * Connect to the server: fetch server info and check version compatibility.
   * Results are cached — subsequent calls return instantly without network requests.
   * Concurrent calls are deduplicated.
   *
   * @param opts - Optional timeout and abort signal.
   * @returns Compatibility result with server info.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an invalid response.
   */
  async connect(opts) {
    if (this._compat) return this._compat;
    if (!this._connectPromise) {
      this._connectPromise = this._fetchAndCheckCompat(opts).finally(() => {
        this._connectPromise = null;
      });
    }
    return this._connectPromise;
  }
  async _fetchAndCheckCompat(opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    let baseUrl = this.baseUrl;
    let serverInfo;
    try {
      const result = await getServerInfo({
        server: baseUrl,
        timeoutMs,
        signal,
        fetchFn: this.fetchFn
      });
      baseUrl = result.baseUrl;
      serverInfo = result.serverInfo;
    } catch (err) {
      if (this._fallbackToHttp && this.baseUrl.startsWith("https://")) {
        const httpBaseUrl = this.baseUrl.replace("https://", "http://");
        try {
          const result = await getServerInfo({
            server: httpBaseUrl,
            timeoutMs,
            signal,
            fetchFn: this.fetchFn
          });
          this.baseUrl = httpBaseUrl;
          baseUrl = result.baseUrl;
          serverInfo = result.serverInfo;
        } catch {
          if (err instanceof DropgateError) throw err;
          throw new DropgateNetworkError("Could not connect to the server.", { cause: err });
        }
      } else {
        if (err instanceof DropgateError) throw err;
        throw new DropgateNetworkError("Could not connect to the server.", { cause: err });
      }
    }
    const compat = this._checkVersionCompat(serverInfo);
    this._compat = { ...compat, serverInfo, baseUrl };
    return this._compat;
  }
  /**
   * Pure version compatibility check (no network calls).
   */
  _checkVersionCompat(serverInfo) {
    const serverVersion = String(serverInfo?.version || "0.0.0");
    const clientVersion = String(this.clientVersion || "0.0.0");
    const c = parseSemverMajorMinor(clientVersion);
    const s = parseSemverMajorMinor(serverVersion);
    if (c.major !== s.major) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        message: `Incompatible versions. Client v${clientVersion}, Server v${serverVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`
      };
    }
    if (c.minor > s.minor) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        message: `Client (v${clientVersion}) is newer than Server (v${serverVersion})${serverInfo?.name ? ` (${serverInfo.name})` : ""}. Some features may not work.`
      };
    }
    return {
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Server: v${serverVersion}, Client: v${clientVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`
    };
  }
  /**
   * Resolve a user-entered sharing code or URL via the server.
   * @param value - The sharing code or URL to resolve.
   * @param opts - Optional timeout and abort signal.
   * @returns The resolved share target information.
   * @throws {DropgateProtocolError} If the share lookup fails.
   */
  async resolveShareTarget(value, opts) {
    const { timeoutMs = 5e3, signal } = opts ?? {};
    const compat = await this.connect(opts);
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { baseUrl } = compat;
    const { res, json } = await fetchJson(
      this.fetchFn,
      `${baseUrl}/api/resolve`,
      {
        method: "POST",
        timeoutMs,
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ value })
      }
    );
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "error" in json ? json.error : null) || `Share lookup failed (status ${res.status}).`;
      throw new DropgateProtocolError(msg, { details: json });
    }
    return json || { valid: false, reason: "Unknown response." };
  }
  /**
   * Validate file and upload settings against server capabilities.
   * @param opts - Validation options containing file, settings, and server info.
   * @returns True if validation passes.
   * @throws {DropgateValidationError} If any validation check fails.
   */
  validateUploadInputs(opts) {
    const { file, lifetimeMs, encrypt, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;
    if (!caps || !caps.enabled) {
      throw new DropgateValidationError("Server does not support file uploads.");
    }
    const fileSize = Number(file?.size || 0);
    if (!file || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DropgateValidationError("File is missing or invalid.");
    }
    const maxMB = Number(caps.maxSizeMB);
    if (Number.isFinite(maxMB) && maxMB > 0) {
      const limitBytes = maxMB * 1e3 * 1e3;
      const validationChunkSize = Number.isFinite(caps.chunkSize) && caps.chunkSize > 0 ? caps.chunkSize : this.chunkSize;
      const totalChunks = Math.ceil(fileSize / validationChunkSize);
      const estimatedBytes = estimateTotalUploadSizeBytes(
        fileSize,
        totalChunks,
        Boolean(encrypt)
      );
      if (estimatedBytes > limitBytes) {
        const msg = encrypt ? `File too large once encryption overhead is included. Server limit: ${maxMB} MB.` : `File too large. Server limit: ${maxMB} MB.`;
        throw new DropgateValidationError(msg);
      }
    }
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new DropgateValidationError(
        "Invalid lifetime. Must be a non-negative integer (milliseconds)."
      );
    }
    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1e3);
      if (lt === 0) {
        throw new DropgateValidationError(
          `Server does not allow unlimited file lifetime. Max: ${maxHours} hours.`
        );
      }
      if (lt > limitMs) {
        throw new DropgateValidationError(
          `File lifetime too long. Server limit: ${maxHours} hours.`
        );
      }
    }
    if (encrypt && !caps.e2ee) {
      throw new DropgateValidationError(
        "End-to-end encryption is not supported on this server."
      );
    }
    return true;
  }
  /**
   * Upload a file to the server with optional encryption.
   * @param opts - Upload options including file and settings (no server target needed).
   * @returns Upload session with result promise and cancellation support.
   * @throws {DropgateValidationError} If input validation fails.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an error.
   * @throws {DropgateAbortError} If the upload is cancelled.
   */
  async uploadFile(opts) {
    const {
      file,
      lifetimeMs,
      encrypt,
      maxDownloads,
      filenameOverride,
      onProgress,
      onCancel,
      signal,
      timeouts = {},
      retry = {}
    } = opts;
    const internalController = signal ? null : new AbortController();
    const effectiveSignal = signal || internalController?.signal;
    let uploadState = "initializing";
    let currentUploadId = null;
    const uploadPromise = (async () => {
      try {
        const progress = (evt) => {
          try {
            if (onProgress) onProgress(evt);
          } catch {
          }
        };
        const fileSizeBytes = file.size;
        progress({ phase: "server-info", text: "Checking server...", percent: 0, processedBytes: 0, totalBytes: fileSizeBytes });
        const compat = await this.connect({
          timeoutMs: timeouts.serverInfoMs ?? 5e3,
          signal: effectiveSignal
        });
        const { baseUrl, serverInfo } = compat;
        progress({ phase: "server-compat", text: compat.message, percent: 0, processedBytes: 0, totalBytes: fileSizeBytes });
        if (!compat.compatible) {
          throw new DropgateValidationError(compat.message);
        }
        const filename = filenameOverride ?? file.name ?? "file";
        const serverSupportsE2EE = Boolean(serverInfo?.capabilities?.upload?.e2ee);
        const effectiveEncrypt = encrypt ?? serverSupportsE2EE;
        if (!effectiveEncrypt) {
          validatePlainFilename(filename);
        }
        this.validateUploadInputs({ file, lifetimeMs, encrypt: effectiveEncrypt, serverInfo });
        let cryptoKey = null;
        let keyB64 = null;
        let transmittedFilename = filename;
        if (effectiveEncrypt) {
          if (!this.cryptoObj?.subtle) {
            throw new DropgateValidationError(
              "Web Crypto API not available (crypto.subtle). Encryption requires a secure context (HTTPS or localhost)."
            );
          }
          progress({ phase: "crypto", text: "Generating encryption key...", percent: 0, processedBytes: 0, totalBytes: fileSizeBytes });
          try {
            cryptoKey = await generateAesGcmKey(this.cryptoObj);
            keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
            transmittedFilename = await encryptFilenameToBase64(
              this.cryptoObj,
              filename,
              cryptoKey
            );
          } catch (err) {
            throw new DropgateError("Failed to prepare encryption.", {
              code: "CRYPTO_PREP_FAILED",
              cause: err
            });
          }
        }
        const serverChunkSize = serverInfo?.capabilities?.upload?.chunkSize;
        const effectiveChunkSize = Number.isFinite(serverChunkSize) && serverChunkSize > 0 ? serverChunkSize : this.chunkSize;
        const totalChunks = Math.ceil(file.size / effectiveChunkSize);
        const totalUploadSize = estimateTotalUploadSizeBytes(
          file.size,
          totalChunks,
          effectiveEncrypt
        );
        progress({ phase: "init", text: "Reserving server storage...", percent: 0, processedBytes: 0, totalBytes: fileSizeBytes });
        const initPayload = {
          filename: transmittedFilename,
          lifetime: lifetimeMs,
          isEncrypted: effectiveEncrypt,
          totalSize: totalUploadSize,
          totalChunks,
          ...maxDownloads !== void 0 ? { maxDownloads } : {}
        };
        const initRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init`, {
          method: "POST",
          timeoutMs: timeouts.initMs ?? 15e3,
          signal: effectiveSignal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(initPayload)
        });
        if (!initRes.res.ok) {
          const errorJson = initRes.json;
          const msg = errorJson?.error || `Server initialisation failed: ${initRes.res.status}`;
          throw new DropgateProtocolError(msg, {
            details: initRes.json || initRes.text
          });
        }
        const initJson = initRes.json;
        const uploadId = initJson?.uploadId;
        if (!uploadId || typeof uploadId !== "string") {
          throw new DropgateProtocolError(
            "Server did not return a valid uploadId."
          );
        }
        currentUploadId = uploadId;
        uploadState = "uploading";
        const retries = Number.isFinite(retry.retries) ? retry.retries : 5;
        const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs : 1e3;
        const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs : 3e4;
        for (let i = 0; i < totalChunks; i++) {
          if (effectiveSignal?.aborted) {
            throw effectiveSignal.reason || new DropgateAbortError();
          }
          const start = i * effectiveChunkSize;
          const end = Math.min(start + effectiveChunkSize, file.size);
          let chunkBlob = file.slice(start, end);
          const percentComplete = i / totalChunks * 100;
          const processedBytes = i * effectiveChunkSize;
          progress({
            phase: "chunk",
            text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
            percent: percentComplete,
            processedBytes,
            totalBytes: fileSizeBytes,
            chunkIndex: i,
            totalChunks
          });
          const chunkBuffer = await chunkBlob.arrayBuffer();
          let uploadBlob;
          if (effectiveEncrypt && cryptoKey) {
            uploadBlob = await encryptToBlob(this.cryptoObj, chunkBuffer, cryptoKey);
          } else {
            uploadBlob = new Blob([chunkBuffer]);
          }
          if (uploadBlob.size > effectiveChunkSize + 1024) {
            throw new DropgateValidationError(
              "Chunk too large (client-side). Check chunk size settings."
            );
          }
          const toHash = await uploadBlob.arrayBuffer();
          const hashHex = await sha256Hex(this.cryptoObj, toHash);
          const headers = {
            "Content-Type": "application/octet-stream",
            "X-Upload-ID": uploadId,
            "X-Chunk-Index": String(i),
            "X-Chunk-Hash": hashHex
          };
          const chunkUrl = `${baseUrl}/upload/chunk`;
          await this._attemptChunkUpload(
            chunkUrl,
            {
              method: "POST",
              headers,
              body: uploadBlob
            },
            {
              retries,
              backoffMs: baseBackoffMs,
              maxBackoffMs,
              timeoutMs: timeouts.chunkMs ?? 6e4,
              signal: effectiveSignal,
              progress,
              chunkIndex: i,
              totalChunks,
              chunkSize: effectiveChunkSize,
              fileSizeBytes
            }
          );
        }
        progress({ phase: "complete", text: "Finalising upload...", percent: 100, processedBytes: fileSizeBytes, totalBytes: fileSizeBytes });
        uploadState = "completing";
        const completeRes = await fetchJson(
          this.fetchFn,
          `${baseUrl}/upload/complete`,
          {
            method: "POST",
            timeoutMs: timeouts.completeMs ?? 3e4,
            signal: effectiveSignal,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({ uploadId })
          }
        );
        if (!completeRes.res.ok) {
          const errorJson = completeRes.json;
          const msg = errorJson?.error || "Finalisation failed.";
          throw new DropgateProtocolError(msg, {
            details: completeRes.json || completeRes.text
          });
        }
        const completeJson = completeRes.json;
        const fileId = completeJson?.id;
        if (!fileId || typeof fileId !== "string") {
          throw new DropgateProtocolError(
            "Server did not return a valid file id."
          );
        }
        let downloadUrl = `${baseUrl}/${fileId}`;
        if (effectiveEncrypt && keyB64) {
          downloadUrl += `#${keyB64}`;
        }
        progress({ phase: "done", text: "Upload successful!", percent: 100, processedBytes: fileSizeBytes, totalBytes: fileSizeBytes });
        uploadState = "completed";
        return {
          downloadUrl,
          fileId,
          uploadId,
          baseUrl,
          ...effectiveEncrypt && keyB64 ? { keyB64 } : {}
        };
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("abort"))) {
          uploadState = "cancelled";
          onCancel?.();
        } else {
          uploadState = "error";
        }
        throw err;
      }
    })();
    const callCancelEndpoint = async (uploadId) => {
      try {
        await fetchJson(this.fetchFn, `${this.baseUrl}/upload/cancel`, {
          method: "POST",
          timeoutMs: 5e3,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ uploadId })
        });
      } catch {
      }
    };
    return {
      result: uploadPromise,
      cancel: (reason) => {
        if (uploadState === "completed" || uploadState === "cancelled") return;
        uploadState = "cancelled";
        if (currentUploadId) {
          callCancelEndpoint(currentUploadId).catch(() => {
          });
        }
        internalController?.abort(new DropgateAbortError(reason || "Upload cancelled by user."));
      },
      getStatus: () => uploadState
    };
  }
  /**
   * Download a file from the server with optional decryption.
   *
   * **Important:** For large files, you must provide an `onData` callback to stream
   * data incrementally. Without it, the entire file is buffered in memory, which will
   * cause memory exhaustion for large files. Files exceeding 100MB without an `onData`
   * callback will throw a validation error.
   *
   * @param opts - Download options including file ID and optional key (no server target needed).
   * @returns Download result containing filename and received bytes.
   * @throws {DropgateValidationError} If input validation fails or file is too large without onData.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an error.
   * @throws {DropgateAbortError} If the download is cancelled.
   */
  async downloadFile(opts) {
    const {
      fileId,
      keyB64,
      onProgress,
      onData,
      signal,
      timeoutMs = 6e4
    } = opts;
    const progress = (evt) => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
      }
    };
    if (!fileId || typeof fileId !== "string") {
      throw new DropgateValidationError("File ID is required.");
    }
    progress({ phase: "server-info", text: "Checking server...", processedBytes: 0, totalBytes: 0, percent: 0 });
    const compat = await this.connect({
      timeoutMs,
      signal
    });
    const { baseUrl } = compat;
    progress({ phase: "server-compat", text: compat.message, processedBytes: 0, totalBytes: 0, percent: 0 });
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    progress({ phase: "metadata", text: "Fetching file info...", processedBytes: 0, totalBytes: 0, percent: 0 });
    const { signal: metaSignal, cleanup: metaCleanup } = makeAbortSignal(signal, timeoutMs);
    let metadata;
    try {
      const metaRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}/meta`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: metaSignal
      });
      if (!metaRes.ok) {
        if (metaRes.status === 404) {
          throw new DropgateProtocolError("File not found or has expired.");
        }
        throw new DropgateProtocolError(`Failed to fetch file metadata (status ${metaRes.status}).`);
      }
      metadata = await metaRes.json();
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new DropgateAbortError("Download cancelled.");
      }
      throw new DropgateNetworkError("Could not fetch file metadata.", { cause: err });
    } finally {
      metaCleanup();
    }
    const isEncrypted = Boolean(metadata.isEncrypted);
    const totalBytes = metadata.sizeBytes || 0;
    if (!onData && totalBytes > MAX_IN_MEMORY_DOWNLOAD_BYTES) {
      const sizeMB = Math.round(totalBytes / (1024 * 1024));
      const limitMB = Math.round(MAX_IN_MEMORY_DOWNLOAD_BYTES / (1024 * 1024));
      throw new DropgateValidationError(
        `File is too large (${sizeMB}MB) to download without streaming. Provide an onData callback to stream files larger than ${limitMB}MB.`
      );
    }
    let filename;
    let cryptoKey;
    if (isEncrypted) {
      if (!keyB64) {
        throw new DropgateValidationError("Decryption key is required for encrypted files.");
      }
      if (!this.cryptoObj?.subtle) {
        throw new DropgateValidationError("Web Crypto API not available for decryption.");
      }
      progress({ phase: "decrypting", text: "Preparing decryption...", processedBytes: 0, totalBytes: 0, percent: 0 });
      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);
        filename = await decryptFilenameFromBase64(
          this.cryptoObj,
          metadata.encryptedFilename,
          cryptoKey,
          this.base64
        );
      } catch (err) {
        throw new DropgateError("Failed to decrypt filename. Invalid key or corrupted data.", {
          code: "DECRYPT_FILENAME_FAILED",
          cause: err
        });
      }
    } else {
      filename = metadata.filename || "file";
    }
    progress({ phase: "downloading", text: "Starting download...", percent: 0, processedBytes: 0, totalBytes });
    const { signal: downloadSignal, cleanup: downloadCleanup } = makeAbortSignal(signal, timeoutMs);
    let receivedBytes = 0;
    const dataChunks = [];
    const collectData = !onData;
    try {
      const downloadRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}`, {
        method: "GET",
        signal: downloadSignal
      });
      if (!downloadRes.ok) {
        throw new DropgateProtocolError(`Download failed (status ${downloadRes.status}).`);
      }
      if (!downloadRes.body) {
        throw new DropgateProtocolError("Streaming response not available.");
      }
      const reader = downloadRes.body.getReader();
      if (isEncrypted && cryptoKey) {
        const downloadChunkSize = Number.isFinite(compat.serverInfo?.capabilities?.upload?.chunkSize) && compat.serverInfo.capabilities.upload.chunkSize > 0 ? compat.serverInfo.capabilities.upload.chunkSize : this.chunkSize;
        const ENCRYPTED_CHUNK_SIZE = downloadChunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
        const pendingChunks = [];
        let pendingLength = 0;
        const flushPending = () => {
          if (pendingChunks.length === 0) return new Uint8Array(0);
          if (pendingChunks.length === 1) {
            const result2 = pendingChunks[0];
            pendingChunks.length = 0;
            pendingLength = 0;
            return result2;
          }
          const result = new Uint8Array(pendingLength);
          let offset = 0;
          for (const chunk of pendingChunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          pendingChunks.length = 0;
          pendingLength = 0;
          return result;
        };
        while (true) {
          if (signal?.aborted) {
            throw new DropgateAbortError("Download cancelled.");
          }
          const { done, value } = await reader.read();
          if (done) break;
          pendingChunks.push(value);
          pendingLength += value.length;
          while (pendingLength >= ENCRYPTED_CHUNK_SIZE) {
            const buffer = flushPending();
            const encryptedChunk = buffer.subarray(0, ENCRYPTED_CHUNK_SIZE);
            if (buffer.length > ENCRYPTED_CHUNK_SIZE) {
              const remainder = buffer.subarray(ENCRYPTED_CHUNK_SIZE);
              pendingChunks.push(remainder);
              pendingLength = remainder.length;
            }
            const decryptedBuffer = await decryptChunk(this.cryptoObj, encryptedChunk, cryptoKey);
            const decryptedData = new Uint8Array(decryptedBuffer);
            if (collectData) {
              dataChunks.push(decryptedData);
            } else {
              await onData(decryptedData);
            }
          }
          receivedBytes += value.length;
          const percent = totalBytes > 0 ? Math.round(receivedBytes / totalBytes * 100) : 0;
          progress({
            phase: "decrypting",
            text: `Downloading & decrypting... (${percent}%)`,
            percent,
            processedBytes: receivedBytes,
            totalBytes
          });
        }
        if (pendingLength > 0) {
          const buffer = flushPending();
          const decryptedBuffer = await decryptChunk(this.cryptoObj, buffer, cryptoKey);
          const decryptedData = new Uint8Array(decryptedBuffer);
          if (collectData) {
            dataChunks.push(decryptedData);
          } else {
            await onData(decryptedData);
          }
        }
      } else {
        while (true) {
          if (signal?.aborted) {
            throw new DropgateAbortError("Download cancelled.");
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (collectData) {
            dataChunks.push(value);
          } else {
            await onData(value);
          }
          receivedBytes += value.length;
          const percent = totalBytes > 0 ? Math.round(receivedBytes / totalBytes * 100) : 0;
          progress({
            phase: "downloading",
            text: `Downloading... (${percent}%)`,
            percent,
            processedBytes: receivedBytes,
            totalBytes
          });
        }
      }
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new DropgateAbortError("Download cancelled.");
      }
      throw new DropgateNetworkError("Download failed.", { cause: err });
    } finally {
      downloadCleanup();
    }
    progress({ phase: "complete", text: "Download complete!", percent: 100, processedBytes: receivedBytes, totalBytes });
    let data;
    if (collectData && dataChunks.length > 0) {
      const totalLength = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of dataChunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
    }
    return {
      filename,
      receivedBytes,
      wasEncrypted: isEncrypted,
      ...data ? { data } : {}
    };
  }
  /**
   * Start a P2P send session. Connects to the signalling server and waits for a receiver.
   *
   * Server info, peerjsPath, iceServers, and cryptoObj are provided automatically
   * from the client's cached server info and configuration.
   *
   * @param opts - P2P send options (file, Peer constructor, callbacks, tuning).
   * @returns P2P send session with control methods.
   * @throws {DropgateValidationError} If P2P is not enabled on the server.
   * @throws {DropgateNetworkError} If the signalling server cannot be reached.
   */
  async p2pSend(opts) {
    const compat = await this.connect();
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) {
      throw new DropgateValidationError("Direct transfer is disabled on this server.");
    }
    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    return startP2PSend({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo,
      cryptoObj: this.cryptoObj
    });
  }
  /**
   * Start a P2P receive session. Connects to a sender via their sharing code.
   *
   * Server info, peerjsPath, and iceServers are provided automatically
   * from the client's cached server info.
   *
   * @param opts - P2P receive options (code, Peer constructor, callbacks, tuning).
   * @returns P2P receive session with control methods.
   * @throws {DropgateValidationError} If P2P is not enabled on the server.
   * @throws {DropgateNetworkError} If the signalling server cannot be reached.
   */
  async p2pReceive(opts) {
    const compat = await this.connect();
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }
    const { serverInfo } = compat;
    const p2pCaps = serverInfo?.capabilities?.p2p;
    if (!p2pCaps?.enabled) {
      throw new DropgateValidationError("Direct transfer is disabled on this server.");
    }
    const { host, port, secure } = this.serverTarget;
    const { path: peerjsPath, iceServers } = resolvePeerConfig({}, p2pCaps);
    return startP2PReceive({
      ...opts,
      host,
      port,
      secure,
      peerjsPath,
      iceServers,
      serverInfo
    });
  }
  async _attemptChunkUpload(url, fetchOptions, opts) {
    const {
      retries,
      backoffMs,
      maxBackoffMs,
      timeoutMs,
      signal,
      progress,
      chunkIndex,
      totalChunks,
      chunkSize,
      fileSizeBytes
    } = opts;
    let attemptsLeft = retries;
    let currentBackoff = backoffMs;
    const maxRetries = retries;
    while (true) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateAbortError();
      }
      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        const res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        if (res.ok) return;
        const text = await res.text().catch(() => "");
        const err = new DropgateProtocolError(
          `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`,
          {
            details: { status: res.status, bodySnippet: text.slice(0, 120) }
          }
        );
        throw err;
      } catch (err) {
        cleanup();
        if (err instanceof Error && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
          throw err;
        }
        if (signal?.aborted) {
          throw signal.reason || new DropgateAbortError();
        }
        if (attemptsLeft <= 0) {
          throw err instanceof DropgateError ? err : new DropgateNetworkError("Chunk upload failed.", { cause: err });
        }
        const attemptNumber = maxRetries - attemptsLeft + 1;
        const processedBytes = chunkIndex * chunkSize;
        const percent = chunkIndex / totalChunks * 100;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1e3).toFixed(1);
          progress({
            phase: "retry-wait",
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`,
            percent,
            processedBytes,
            totalBytes: fileSizeBytes,
            chunkIndex,
            totalChunks
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }
        progress({
          phase: "retry",
          text: `Chunk upload failed. Retrying now... (${attemptNumber}/${maxRetries})`,
          percent,
          processedBytes,
          totalBytes: fileSizeBytes,
          chunkIndex,
          totalChunks
        });
        attemptsLeft -= 1;
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        continue;
      } finally {
        cleanup();
      }
    }
  }
};
export {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  DEFAULT_CHUNK_SIZE,
  DropgateAbortError,
  DropgateClient,
  DropgateError,
  DropgateNetworkError,
  DropgateProtocolError,
  DropgateTimeoutError,
  DropgateValidationError,
  ENCRYPTION_OVERHEAD_PER_CHUNK,
  arrayBufferToBase64,
  base64ToBytes,
  buildBaseUrl,
  bytesToBase64,
  decryptChunk,
  decryptFilenameFromBase64,
  encryptFilenameToBase64,
  encryptToBlob,
  estimateTotalUploadSizeBytes,
  exportKeyBase64,
  fetchJson,
  generateAesGcmKey,
  generateP2PCode,
  getDefaultBase64,
  getDefaultCrypto,
  getDefaultFetch,
  getServerInfo,
  importKeyFromBase64,
  isLocalhostHostname,
  isP2PCodeLike,
  isSecureContextForP2P,
  lifetimeToMs,
  makeAbortSignal,
  parseSemverMajorMinor,
  parseServerUrl,
  sha256Hex,
  sleep,
  validatePlainFilename
};
//# sourceMappingURL=index.js.map
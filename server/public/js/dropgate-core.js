// src/constants.ts
var DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
var AES_GCM_IV_BYTES = 12;
var AES_GCM_TAG_BYTES = 16;
var ENCRYPTION_OVERHEAD_PER_CHUNK = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
var MAX_IN_MEMORY_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// src/errors.ts
var DropgateError = class extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = opts.code || "DROPGATE_ERROR";
    this.details = opts.details;
    if (opts.cause !== void 0) {
      Object.defineProperty(this, "cause", {
        value: opts.cause,
        writable: false,
        enumerable: false,
        configurable: true
      });
    }
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
async function sha256Hex(cryptoObj, data) {
  const hashBuffer = await cryptoObj.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
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

// src/client/DropgateClient.ts
function estimateTotalUploadSizeBytes(fileSizeBytes, totalChunks, isEncrypted) {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}
async function getServerInfo(opts) {
  const { host, port, secure, timeoutMs = 5e3, signal, fetchFn: customFetch } = opts;
  const fetchFn = customFetch || getDefaultFetch();
  if (!fetchFn) {
    throw new DropgateValidationError("No fetch() implementation found.");
  }
  const baseUrl = buildBaseUrl({ host, port, secure });
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
   * @param opts - Client configuration options.
   * @throws {DropgateValidationError} If clientVersion is missing or invalid.
   */
  constructor(opts) {
    if (!opts || typeof opts.clientVersion !== "string") {
      throw new DropgateValidationError(
        "DropgateClient requires clientVersion (string)."
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
    this.logger = opts.logger || null;
  }
  /**
   * Resolve a user-entered sharing code or URL via the server.
   * @param value - The sharing code or URL to resolve.
   * @param opts - Server target and request options.
   * @returns The resolved share target information.
   * @throws {DropgateProtocolError} If the share lookup fails.
   */
  async resolveShareTarget(value, opts) {
    const { timeoutMs = 5e3, signal } = opts;
    const compat = await this.checkCompatibility(opts);
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
   * Check version compatibility between this client and a server.
   * Fetches server info internally using getServerInfo.
   * @param opts - Server target and request options.
   * @returns Compatibility result with status, message, and server info.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an invalid response.
   */
  async checkCompatibility(opts) {
    let baseUrl;
    let serverInfo;
    try {
      const result = await getServerInfo({ ...opts, fetchFn: this.fetchFn });
      baseUrl = result.baseUrl;
      serverInfo = result.serverInfo;
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      throw new DropgateNetworkError("Could not connect to the server.", {
        cause: err
      });
    }
    const serverVersion = String(serverInfo?.version || "0.0.0");
    const clientVersion = String(this.clientVersion || "0.0.0");
    const c = parseSemverMajorMinor(clientVersion);
    const s = parseSemverMajorMinor(serverVersion);
    if (c.major !== s.major) {
      return {
        compatible: false,
        clientVersion,
        serverVersion,
        message: `Incompatible versions. Client v${clientVersion}, Server v${serverVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`,
        serverInfo,
        baseUrl
      };
    }
    if (c.minor > s.minor) {
      return {
        compatible: true,
        clientVersion,
        serverVersion,
        message: `Client (v${clientVersion}) is newer than Server (v${serverVersion})${serverInfo?.name ? ` (${serverInfo.name})` : ""}. Some features may not work.`,
        serverInfo,
        baseUrl
      };
    }
    return {
      compatible: true,
      clientVersion,
      serverVersion,
      message: `Server: v${serverVersion}, Client: v${clientVersion}${serverInfo?.name ? ` (${serverInfo.name})` : ""}.`,
      serverInfo,
      baseUrl
    };
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
      const totalChunks = Math.ceil(fileSize / this.chunkSize);
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
   * @param opts - Upload options including file, server target, and settings.
   * @returns Upload result containing the download URL and file identifiers.
   * @throws {DropgateValidationError} If input validation fails.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an error.
   * @throws {DropgateAbortError} If the upload is cancelled.
   */
  async uploadFile(opts) {
    const {
      host,
      port,
      secure,
      file,
      lifetimeMs,
      encrypt,
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
    let currentBaseUrl = null;
    const uploadPromise = (async () => {
      try {
        const progress = (evt) => {
          try {
            if (onProgress) onProgress(evt);
          } catch {
          }
        };
        if (!this.cryptoObj?.subtle) {
          throw new DropgateValidationError(
            "Web Crypto API not available (crypto.subtle)."
          );
        }
        const fileSizeBytes = file.size;
        progress({ phase: "server-info", text: "Checking server...", percent: 0, processedBytes: 0, totalBytes: fileSizeBytes });
        const compat = await this.checkCompatibility({
          host,
          port,
          secure,
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
        const totalChunks = Math.ceil(file.size / this.chunkSize);
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
          totalChunks
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
        currentBaseUrl = baseUrl;
        uploadState = "uploading";
        const retries = Number.isFinite(retry.retries) ? retry.retries : 5;
        const baseBackoffMs = Number.isFinite(retry.backoffMs) ? retry.backoffMs : 1e3;
        const maxBackoffMs = Number.isFinite(retry.maxBackoffMs) ? retry.maxBackoffMs : 3e4;
        for (let i = 0; i < totalChunks; i++) {
          if (effectiveSignal?.aborted) {
            throw effectiveSignal.reason || new DropgateAbortError();
          }
          const start = i * this.chunkSize;
          const end = Math.min(start + this.chunkSize, file.size);
          let chunkBlob = file.slice(start, end);
          const percentComplete = i / totalChunks * 100;
          const processedBytes = i * this.chunkSize;
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
          if (uploadBlob.size > DEFAULT_CHUNK_SIZE + 1024) {
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
          await this.attemptChunkUpload(
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
              chunkSize: this.chunkSize,
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
    const callCancelEndpoint = async (uploadId, baseUrl) => {
      try {
        await fetchJson(this.fetchFn, `${baseUrl}/upload/cancel`, {
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
        if (currentUploadId && currentBaseUrl) {
          callCancelEndpoint(currentUploadId, currentBaseUrl).catch(() => {
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
   * @param opts - Download options including file ID, server target, and optional key.
   * @param opts.onData - Streaming callback that receives data chunks. Required for files > 100MB.
   * @returns Download result containing filename and received bytes.
   * @throws {DropgateValidationError} If input validation fails or file is too large without onData.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an error.
   * @throws {DropgateAbortError} If the download is cancelled.
   */
  async downloadFile(opts) {
    const {
      host,
      port,
      secure,
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
    const compat = await this.checkCompatibility({
      host,
      port,
      secure,
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
        const ENCRYPTED_CHUNK_SIZE = this.chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
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
  async attemptChunkUpload(url, fetchOptions, opts) {
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

// src/p2p/send.ts
function generateSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
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
    chunkSize = 256 * 1024,
    endAckTimeoutMs = 15e3,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    heartbeatIntervalMs = 5e3,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel
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
  const reportProgress = (data) => {
    const safeTotal = Number.isFinite(data.total) && data.total > 0 ? data.total : file.size;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    const percent = safeTotal ? safeReceived / safeTotal * 100 : 0;
    onProgress?.({ processedBytes: safeReceived, totalBytes: safeTotal, percent });
  };
  const safeError = (err) => {
    if (state === "closed" || state === "completed" || state === "cancelled") return;
    state = "closed";
    onError?.(err);
    cleanup();
  };
  const safeComplete = () => {
    if (state !== "finishing") return;
    state = "completed";
    onComplete?.();
    cleanup();
  };
  const cleanup = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
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
    const wasActive = state === "transferring" || state === "finishing";
    state = "cancelled";
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
    state = "negotiating";
    onStatus?.({ phase: "waiting", message: "Connected. Waiting for receiver to accept..." });
    let readyResolve = null;
    let ackResolve = null;
    const readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const ackPromise = new Promise((resolve) => {
      ackResolve = resolve;
    });
    conn.on("data", (data) => {
      if (!data || typeof data !== "object" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        return;
      }
      const msg = data;
      if (!msg.t) return;
      if (msg.t === "ready") {
        onStatus?.({ phase: "transferring", message: "Receiver accepted. Starting transfer..." });
        readyResolve?.();
        return;
      }
      if (msg.t === "progress") {
        reportProgress({ received: msg.received || 0, total: msg.total || 0 });
        return;
      }
      if (msg.t === "ack" && msg.phase === "end") {
        ackResolve?.(msg);
        return;
      }
      if (msg.t === "pong") {
        return;
      }
      if (msg.t === "error") {
        safeError(new DropgateNetworkError(msg.message || "Receiver reported an error."));
        return;
      }
      if (msg.t === "cancelled") {
        if (state === "cancelled" || state === "closed" || state === "completed") return;
        state = "cancelled";
        onCancel?.({ cancelledBy: "receiver", message: msg.message });
        cleanup();
      }
    });
    conn.on("open", async () => {
      try {
        if (isStopped()) return;
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
            if (state === "transferring" || state === "finishing") {
              try {
                conn.send({ t: "ping" });
              } catch {
              }
            }
          }, heartbeatIntervalMs);
        }
        state = "transferring";
        for (let offset = 0; offset < total; offset += chunkSize) {
          if (isStopped()) return;
          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          if (isStopped()) return;
          conn.send(buf);
          sentBytes += buf.byteLength;
          if (dc) {
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
            }
          }
        }
        if (isStopped()) return;
        state = "finishing";
        conn.send({ t: "end" });
        const ackTimeoutMs = Number.isFinite(endAckTimeoutMs) ? Math.max(endAckTimeoutMs, Math.ceil(file.size / (1024 * 1024)) * 1e3) : null;
        const ackResult = await Promise.race([
          ackPromise,
          sleep(ackTimeoutMs || 15e3).catch(() => null)
        ]);
        if (isStopped()) return;
        if (!ackResult || typeof ackResult !== "object") {
          throw new DropgateNetworkError("Receiver did not confirm completion.");
        }
        const ackData = ackResult;
        const ackTotal = Number(ackData.total) || file.size;
        const ackReceived = Number(ackData.received) || 0;
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
      if (state === "transferring" || state === "finishing") {
        state = "cancelled";
        onCancel?.({ cancelledBy: "receiver" });
        cleanup();
      } else {
        activeConn = null;
        state = "listening";
        sentBytes = 0;
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
  let lastProgressSentAt = 0;
  const progressIntervalMs = 120;
  let writeQueue = Promise.resolve();
  let watchdogTimer = null;
  let activeConn = null;
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
    state = "closed";
    onError?.(err);
    cleanup();
  };
  const safeComplete = (completeData) => {
    if (state !== "transferring") return;
    state = "completed";
    onComplete?.(completeData);
    cleanup();
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
    state = "cancelled";
    try {
      if (activeConn && activeConn.open) {
        activeConn.send({ t: "cancelled", message: "Receiver cancelled the transfer." });
      }
    } catch {
    }
    if (wasActive && onCancel) {
      onCancel({ cancelledBy: "receiver" });
    }
    cleanup();
  };
  peer.on("error", (err) => {
    safeError(err);
  });
  peer.on("open", () => {
    state = "connecting";
    const conn = peer.connect(normalizedCode, { reliable: true });
    activeConn = conn;
    conn.on("open", () => {
      state = "negotiating";
      onStatus?.({ phase: "connected", message: "Waiting for file details..." });
    });
    conn.on("data", async (data) => {
      try {
        resetWatchdog();
        if (data && typeof data === "object" && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
          const msg = data;
          if (msg.t === "meta") {
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
              state = "transferring";
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
            return;
          }
          if (msg.t === "ping") {
            try {
              conn.send({ t: "pong" });
            } catch {
            }
            return;
          }
          if (msg.t === "end") {
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
              conn.send({ t: "ack", phase: "end", received, total });
            } catch {
            }
            safeComplete({ received, total });
            return;
          }
          if (msg.t === "error") {
            throw new DropgateNetworkError(msg.message || "Sender reported an error.");
          }
          if (msg.t === "cancelled") {
            if (state === "cancelled" || state === "closed" || state === "completed") return;
            state = "cancelled";
            onCancel?.({ cancelledBy: "sender", message: msg.message });
            cleanup();
            return;
          }
          return;
        }
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
        writeQueue = writeQueue.then(async () => {
          const buf = await bufPromise;
          if (onData) {
            await onData(buf);
          }
          received += buf.byteLength;
          const percent = total ? Math.min(100, received / total * 100) : 0;
          onProgress?.({ processedBytes: received, totalBytes: total, percent });
          const now = Date.now();
          if (received === total || now - lastProgressSentAt >= progressIntervalMs) {
            lastProgressSentAt = now;
            try {
              conn.send({ t: "progress", received, total });
            } catch {
            }
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
        state = "cancelled";
        onCancel?.({ cancelledBy: "sender" });
        cleanup();
      } else if (state === "negotiating") {
        state = "closed";
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
  buildPeerOptions,
  bytesToBase64,
  createPeerWithRetries,
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
  resolvePeerConfig,
  sha256Hex,
  sleep,
  startP2PReceive,
  startP2PSend,
  validatePlainFilename
};
//# sourceMappingURL=index.js.map
import { DEFAULT_CHUNK_SIZE, ENCRYPTION_OVERHEAD_PER_CHUNK, MAX_IN_MEMORY_DOWNLOAD_BYTES } from '../constants.js';
import {
  DropgateError,
  DropgateValidationError,
  DropgateNetworkError,
  DropgateProtocolError,
  DropgateAbortError,
} from '../errors.js';
import type {
  CryptoAdapter,
  FetchFn,
  LoggerFn,
  ServerInfo,
  CompatibilityResult,
  ShareTargetResult,
  UploadResult,
  ProgressEvent,
  DropgateClientOptions,
  UploadOptions,
  GetServerInfoOptions,
  ValidateUploadOptions,
  FileSource,
  Base64Adapter,
  DownloadOptions,
  DownloadResult,
  DownloadProgressEvent,
  FileMetadata,
} from '../types.js';
import { getDefaultCrypto, getDefaultFetch, getDefaultBase64 } from '../adapters/defaults.js';
import { makeAbortSignal, fetchJson, sleep, buildBaseUrl } from '../utils/network.js';
import { parseSemverMajorMinor } from '../utils/semver.js';
import { validatePlainFilename } from '../utils/filename.js';
import { sha256Hex, generateAesGcmKey, exportKeyBase64, importKeyFromBase64, decryptChunk, decryptFilenameFromBase64 } from '../crypto/index.js';
import { encryptToBlob, encryptFilenameToBase64 } from '../crypto/encrypt.js';

/**
 * Estimate total upload size including encryption overhead.
 */
export function estimateTotalUploadSizeBytes(
  fileSizeBytes: number,
  totalChunks: number,
  isEncrypted: boolean
): number {
  const base = Number(fileSizeBytes) || 0;
  if (!isEncrypted) return base;
  return base + (Number(totalChunks) || 0) * ENCRYPTION_OVERHEAD_PER_CHUNK;
}

/**
 * Headless, environment-agnostic client for Dropgate file uploads.
 * Handles server communication, encryption, and chunked uploads.
 */
export class DropgateClient {
  /** Client version string for compatibility checking. */
  readonly clientVersion: string;
  /** Chunk size in bytes for upload splitting. */
  readonly chunkSize: number;
  /** Fetch implementation used for HTTP requests. */
  readonly fetchFn: FetchFn;
  /** Crypto implementation for encryption operations. */
  readonly cryptoObj: CryptoAdapter;
  /** Base64 encoder/decoder for binary data. */
  readonly base64: Base64Adapter;
  /** Optional logger for debug output. */
  readonly logger: LoggerFn | null;

  /**
   * Create a new DropgateClient instance.
   * @param opts - Client configuration options.
   * @throws {DropgateValidationError} If clientVersion is missing or invalid.
   */
  constructor(opts: DropgateClientOptions) {
    if (!opts || typeof opts.clientVersion !== 'string') {
      throw new DropgateValidationError(
        'DropgateClient requires clientVersion (string).'
      );
    }

    this.clientVersion = opts.clientVersion;
    this.chunkSize = Number.isFinite(opts.chunkSize)
      ? opts.chunkSize!
      : DEFAULT_CHUNK_SIZE;

    const fetchFn = opts.fetchFn || getDefaultFetch();
    if (!fetchFn) {
      throw new DropgateValidationError('No fetch() implementation found.');
    }
    this.fetchFn = fetchFn;

    const cryptoObj = opts.cryptoObj || getDefaultCrypto();
    if (!cryptoObj) {
      throw new DropgateValidationError('No crypto implementation found.');
    }
    this.cryptoObj = cryptoObj;

    this.base64 = opts.base64 || getDefaultBase64();
    this.logger = opts.logger || null;
  }

  /**
   * Fetch server information from the /api/info endpoint.
   * @param opts - Server target and request options.
   * @returns The server base URL and server info object.
   * @throws {DropgateNetworkError} If the server cannot be reached.
   * @throws {DropgateProtocolError} If the server returns an invalid response.
   */
  async getServerInfo(
    opts: GetServerInfoOptions
  ): Promise<{ baseUrl: string; serverInfo: ServerInfo }> {
    const { host, port, secure, timeoutMs = 5000, signal } = opts;

    const baseUrl = buildBaseUrl({ host, port, secure });

    try {
      const { res, json } = await fetchJson(
        this.fetchFn,
        `${baseUrl}/api/info`,
        {
          method: 'GET',
          timeoutMs,
          signal,
          headers: { Accept: 'application/json' },
        }
      );

      if (res.ok && json && typeof json === 'object' && 'version' in json) {
        return { baseUrl, serverInfo: json as ServerInfo };
      }

      throw new DropgateProtocolError(
        `Server info request failed (status ${res.status}).`
      );
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      throw new DropgateNetworkError('Could not reach server /api/info.', {
        cause: err,
      });
    }
  }

  /**
   * Resolve a user-entered sharing code or URL via the server.
   * @param value - The sharing code or URL to resolve.
   * @param opts - Server target and request options.
   * @returns The resolved share target information.
   * @throws {DropgateProtocolError} If the share lookup fails.
   */
  async resolveShareTarget(
    value: string,
    opts: GetServerInfoOptions
  ): Promise<ShareTargetResult> {
    const { host, port, secure, timeoutMs = 5000, signal } = opts;

    const baseUrl = buildBaseUrl({ host, port, secure });

    const { res, json } = await fetchJson(
      this.fetchFn,
      `${baseUrl}/api/resolve`,
      {
        method: 'POST',
        timeoutMs,
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ value }),
      }
    );

    if (!res.ok) {
      const msg =
        (json && typeof json === 'object' && 'error' in json
          ? (json as { error: string }).error
          : null) || `Share lookup failed (status ${res.status}).`;
      throw new DropgateProtocolError(msg, { details: json });
    }

    return (json as ShareTargetResult) || { valid: false, reason: 'Unknown response.' };
  }

  /**
   * Check version compatibility between this client and a server.
   * @param serverInfo - Server info containing the version to check against.
   * @returns Compatibility result with status and message.
   */
  checkCompatibility(serverInfo: ServerInfo): CompatibilityResult {
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
   * Validate file and upload settings against server capabilities.
   * @param opts - Validation options containing file, settings, and server info.
   * @returns True if validation passes.
   * @throws {DropgateValidationError} If any validation check fails.
   */
  validateUploadInputs(opts: ValidateUploadOptions): boolean {
    const { file, lifetimeMs, encrypt, serverInfo } = opts;
    const caps = serverInfo?.capabilities?.upload;

    if (!caps || !caps.enabled) {
      throw new DropgateValidationError('Server does not support file uploads.');
    }

    // Check file validity
    const fileSize = Number(file?.size || 0);
    if (!file || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new DropgateValidationError('File is missing or invalid.');
    }

    // maxSizeMB: 0 means unlimited
    const maxMB = Number(caps.maxSizeMB);
    if (Number.isFinite(maxMB) && maxMB > 0) {
      const limitBytes = maxMB * 1000 * 1000;
      const totalChunks = Math.ceil(fileSize / this.chunkSize);
      const estimatedBytes = estimateTotalUploadSizeBytes(
        fileSize,
        totalChunks,
        Boolean(encrypt)
      );
      if (estimatedBytes > limitBytes) {
        const msg = encrypt
          ? `File too large once encryption overhead is included. Server limit: ${maxMB} MB.`
          : `File too large. Server limit: ${maxMB} MB.`;
        throw new DropgateValidationError(msg);
      }
    }

    // maxLifetimeHours: 0 means unlimited is allowed
    const maxHours = Number(caps.maxLifetimeHours);
    const lt = Number(lifetimeMs);
    if (!Number.isFinite(lt) || lt < 0 || !Number.isInteger(lt)) {
      throw new DropgateValidationError(
        'Invalid lifetime. Must be a non-negative integer (milliseconds).'
      );
    }

    if (Number.isFinite(maxHours) && maxHours > 0) {
      const limitMs = Math.round(maxHours * 60 * 60 * 1000);
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

    // Encryption support
    if (encrypt && !caps.e2ee) {
      throw new DropgateValidationError(
        'Server does not support end-to-end encryption.'
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
  async uploadFile(opts: UploadOptions): Promise<UploadResult> {
    const {
      host,
      port,
      secure,
      file,
      lifetimeMs,
      encrypt,
      filenameOverride,
      onProgress,
      signal,
      timeouts = {},
      retry = {},
    } = opts;

    const progress = (evt: ProgressEvent): void => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
        // Ignore UI callback failures
      }
    };

    if (!this.cryptoObj?.subtle) {
      throw new DropgateValidationError(
        'Web Crypto API not available (crypto.subtle).'
      );
    }

    // 0) Get server info + compat
    progress({ phase: 'server-info', text: 'Checking server...' });

    let baseUrl: string;
    let serverInfo: ServerInfo;
    try {
      const res = await this.getServerInfo({
        host,
        port,
        secure,
        timeoutMs: timeouts.serverInfoMs ?? 5000,
        signal,
      });
      baseUrl = res.baseUrl;
      serverInfo = res.serverInfo;
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      throw new DropgateNetworkError('Could not connect to the server.', {
        cause: err,
      });
    }

    const compat = this.checkCompatibility(serverInfo);
    progress({ phase: 'server-compat', text: compat.message });
    if (!compat.compatible) {
      throw new DropgateValidationError(compat.message);
    }

    // 1) Validate inputs
    const filename = filenameOverride ?? file.name ?? 'file';

    if (!encrypt) {
      validatePlainFilename(filename);
    }

    this.validateUploadInputs({ file, lifetimeMs, encrypt, serverInfo });

    // 2) Encryption prep
    let cryptoKey: CryptoKey | null = null;
    let keyB64: string | null = null;
    let transmittedFilename = filename;

    if (encrypt) {
      progress({ phase: 'crypto', text: 'Generating encryption key...' });
      try {
        cryptoKey = await generateAesGcmKey(this.cryptoObj);
        keyB64 = await exportKeyBase64(this.cryptoObj, cryptoKey);
        transmittedFilename = await encryptFilenameToBase64(
          this.cryptoObj,
          filename,
          cryptoKey
        );
      } catch (err) {
        throw new DropgateError('Failed to prepare encryption.', {
          code: 'CRYPTO_PREP_FAILED',
          cause: err,
        });
      }
    }

    // 3) Compute reservation sizes
    const totalChunks = Math.ceil(file.size / this.chunkSize);
    const totalUploadSize = estimateTotalUploadSizeBytes(
      file.size,
      totalChunks,
      encrypt
    );

    // 4) Init
    progress({ phase: 'init', text: 'Reserving server storage...' });

    const initPayload = {
      filename: transmittedFilename,
      lifetime: lifetimeMs,
      isEncrypted: Boolean(encrypt),
      totalSize: totalUploadSize,
      totalChunks,
    };

    const initRes = await fetchJson(this.fetchFn, `${baseUrl}/upload/init`, {
      method: 'POST',
      timeoutMs: timeouts.initMs ?? 15000,
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(initPayload),
    });

    if (!initRes.res.ok) {
      const errorJson = initRes.json as { error?: string } | null;
      const msg =
        errorJson?.error ||
        `Server initialisation failed: ${initRes.res.status}`;
      throw new DropgateProtocolError(msg, {
        details: initRes.json || initRes.text,
      });
    }

    const initJson = initRes.json as { uploadId?: string } | null;
    const uploadId = initJson?.uploadId;
    if (!uploadId || typeof uploadId !== 'string') {
      throw new DropgateProtocolError(
        'Server did not return a valid uploadId.'
      );
    }

    // 5) Chunks
    const retries = Number.isFinite(retry.retries) ? retry.retries! : 5;
    const baseBackoffMs = Number.isFinite(retry.backoffMs)
      ? retry.backoffMs!
      : 1000;
    const maxBackoffMs = Number.isFinite(retry.maxBackoffMs)
      ? retry.maxBackoffMs!
      : 30000;

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) {
        throw signal.reason || new DropgateAbortError();
      }

      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      let chunkBlob: Blob | FileSource = file.slice(start, end);

      const percentComplete = (i / totalChunks) * 100;
      progress({
        phase: 'chunk',
        text: `Uploading chunk ${i + 1} of ${totalChunks}...`,
        percent: percentComplete,
        chunkIndex: i,
        totalChunks,
      });

      // Get ArrayBuffer from the slice
      const chunkBuffer = await chunkBlob.arrayBuffer();

      // Encrypt if needed
      let uploadBlob: Blob;
      if (encrypt && cryptoKey) {
        uploadBlob = await encryptToBlob(this.cryptoObj, chunkBuffer, cryptoKey);
      } else {
        uploadBlob = new Blob([chunkBuffer]);
      }

      // Server validates: chunk <= 5MB + 1024
      if (uploadBlob.size > DEFAULT_CHUNK_SIZE + 1024) {
        throw new DropgateValidationError(
          'Chunk too large (client-side). Check chunk size settings.'
        );
      }

      // Hash encrypted/plain payload
      const toHash = await uploadBlob.arrayBuffer();
      const hashHex = await sha256Hex(this.cryptoObj, toHash);

      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Upload-ID': uploadId,
        'X-Chunk-Index': String(i),
        'X-Chunk-Hash': hashHex,
      };

      const chunkUrl = `${baseUrl}/upload/chunk`;
      await this.attemptChunkUpload(
        chunkUrl,
        {
          method: 'POST',
          headers,
          body: uploadBlob,
        },
        {
          retries,
          backoffMs: baseBackoffMs,
          maxBackoffMs,
          timeoutMs: timeouts.chunkMs ?? 60000,
          signal,
          progress,
          chunkIndex: i,
          totalChunks,
        }
      );
    }

    // 6) Complete
    progress({ phase: 'complete', text: 'Finalising upload...', percent: 100 });

    const completeRes = await fetchJson(
      this.fetchFn,
      `${baseUrl}/upload/complete`,
      {
        method: 'POST',
        timeoutMs: timeouts.completeMs ?? 30000,
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ uploadId }),
      }
    );

    if (!completeRes.res.ok) {
      const errorJson = completeRes.json as { error?: string } | null;
      const msg = errorJson?.error || 'Finalisation failed.';
      throw new DropgateProtocolError(msg, {
        details: completeRes.json || completeRes.text,
      });
    }

    const completeJson = completeRes.json as { id?: string } | null;
    const fileId = completeJson?.id;
    if (!fileId || typeof fileId !== 'string') {
      throw new DropgateProtocolError(
        'Server did not return a valid file id.'
      );
    }

    let downloadUrl = `${baseUrl}/${fileId}`;
    if (encrypt && keyB64) {
      downloadUrl += `#${keyB64}`;
    }

    progress({ phase: 'done', text: 'Upload successful!', percent: 100 });

    return {
      downloadUrl,
      fileId,
      uploadId,
      baseUrl,
      ...(encrypt && keyB64 ? { keyB64 } : {}),
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
  async downloadFile(opts: DownloadOptions): Promise<DownloadResult> {
    const {
      host,
      port,
      secure,
      fileId,
      keyB64,
      onProgress,
      onData,
      signal,
      timeoutMs = 60000,
    } = opts;

    const progress = (evt: DownloadProgressEvent): void => {
      try {
        if (onProgress) onProgress(evt);
      } catch {
        // Ignore UI callback failures
      }
    };

    if (!fileId || typeof fileId !== 'string') {
      throw new DropgateValidationError('File ID is required.');
    }

    const baseUrl = buildBaseUrl({ host, port, secure });

    // 1) Fetch metadata
    progress({ phase: 'metadata', text: 'Fetching file info...', receivedBytes: 0, totalBytes: 0, percent: 0 });

    const { signal: metaSignal, cleanup: metaCleanup } = makeAbortSignal(signal, timeoutMs);
    let metadata: FileMetadata;

    try {
      const metaRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}/meta`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: metaSignal,
      });

      if (!metaRes.ok) {
        if (metaRes.status === 404) {
          throw new DropgateProtocolError('File not found or has expired.');
        }
        throw new DropgateProtocolError(`Failed to fetch file metadata (status ${metaRes.status}).`);
      }

      metadata = await metaRes.json() as FileMetadata;
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DropgateAbortError('Download cancelled.');
      }
      throw new DropgateNetworkError('Could not fetch file metadata.', { cause: err });
    } finally {
      metaCleanup();
    }

    const isEncrypted = Boolean(metadata.isEncrypted);
    const totalBytes = metadata.sizeBytes || 0;

    // Check if file is too large to buffer in memory without streaming
    if (!onData && totalBytes > MAX_IN_MEMORY_DOWNLOAD_BYTES) {
      const sizeMB = Math.round(totalBytes / (1024 * 1024));
      const limitMB = Math.round(MAX_IN_MEMORY_DOWNLOAD_BYTES / (1024 * 1024));
      throw new DropgateValidationError(
        `File is too large (${sizeMB}MB) to download without streaming. ` +
        `Provide an onData callback to stream files larger than ${limitMB}MB.`
      );
    }

    // 2) Decrypt filename if encrypted
    let filename: string;
    let cryptoKey: CryptoKey | undefined;

    if (isEncrypted) {
      if (!keyB64) {
        throw new DropgateValidationError('Decryption key is required for encrypted files.');
      }

      if (!this.cryptoObj?.subtle) {
        throw new DropgateValidationError('Web Crypto API not available for decryption.');
      }

      progress({ phase: 'decrypting', text: 'Preparing decryption...', receivedBytes: 0, totalBytes: 0, percent: 0 });

      try {
        cryptoKey = await importKeyFromBase64(this.cryptoObj, keyB64, this.base64);
        filename = await decryptFilenameFromBase64(
          this.cryptoObj,
          metadata.encryptedFilename!,
          cryptoKey,
          this.base64
        );
      } catch (err) {
        throw new DropgateError('Failed to decrypt filename. Invalid key or corrupted data.', {
          code: 'DECRYPT_FILENAME_FAILED',
          cause: err,
        });
      }
    } else {
      filename = metadata.filename || 'file';
    }

    // 3) Download file content
    progress({ phase: 'downloading', text: 'Starting download...', percent: 0, receivedBytes: 0, totalBytes });

    const { signal: downloadSignal, cleanup: downloadCleanup } = makeAbortSignal(signal, timeoutMs);
    let receivedBytes = 0;
    const dataChunks: Uint8Array[] = [];
    const collectData = !onData;

    try {
      const downloadRes = await this.fetchFn(`${baseUrl}/api/file/${fileId}`, {
        method: 'GET',
        signal: downloadSignal,
      });

      if (!downloadRes.ok) {
        throw new DropgateProtocolError(`Download failed (status ${downloadRes.status}).`);
      }

      if (!downloadRes.body) {
        throw new DropgateProtocolError('Streaming response not available.');
      }

      const reader = downloadRes.body.getReader();

      if (isEncrypted && cryptoKey) {
        // Encrypted: buffer and decrypt chunks
        // Use a chunk array to avoid repeated array copying on each read
        const ENCRYPTED_CHUNK_SIZE = this.chunkSize + ENCRYPTION_OVERHEAD_PER_CHUNK;
        const pendingChunks: Uint8Array[] = [];
        let pendingLength = 0;

        // Helper to concatenate pending chunks into a single buffer
        const flushPending = (): Uint8Array => {
          if (pendingChunks.length === 0) return new Uint8Array(0);
          if (pendingChunks.length === 1) {
            const result = pendingChunks[0];
            pendingChunks.length = 0;
            pendingLength = 0;
            return result;
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
            throw new DropgateAbortError('Download cancelled.');
          }

          const { done, value } = await reader.read();
          if (done) break;

          // Append to pending chunks (no copying yet)
          pendingChunks.push(value);
          pendingLength += value.length;

          // Process complete encrypted chunks when we have enough data
          while (pendingLength >= ENCRYPTED_CHUNK_SIZE) {
            const buffer = flushPending();
            const encryptedChunk = buffer.subarray(0, ENCRYPTED_CHUNK_SIZE);

            // Keep the remainder for next iteration
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
              await onData!(decryptedData);
            }
          }

          receivedBytes += value.length;
          const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          progress({
            phase: 'decrypting',
            text: `Downloading & decrypting... (${percent}%)`,
            percent,
            receivedBytes,
            totalBytes,
          });
        }

        // Process remaining buffer (final chunk)
        if (pendingLength > 0) {
          const buffer = flushPending();
          const decryptedBuffer = await decryptChunk(this.cryptoObj, buffer, cryptoKey);
          const decryptedData = new Uint8Array(decryptedBuffer);

          if (collectData) {
            dataChunks.push(decryptedData);
          } else {
            await onData!(decryptedData);
          }
        }
      } else {
        // Plain: stream through directly
        while (true) {
          if (signal?.aborted) {
            throw new DropgateAbortError('Download cancelled.');
          }

          const { done, value } = await reader.read();
          if (done) break;

          if (collectData) {
            dataChunks.push(value);
          } else {
            await onData!(value);
          }

          receivedBytes += value.length;
          const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          progress({
            phase: 'downloading',
            text: `Downloading... (${percent}%)`,
            percent,
            receivedBytes,
            totalBytes,
          });
        }
      }
    } catch (err) {
      if (err instanceof DropgateError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DropgateAbortError('Download cancelled.');
      }
      throw new DropgateNetworkError('Download failed.', { cause: err });
    } finally {
      downloadCleanup();
    }

    progress({ phase: 'complete', text: 'Download complete!', percent: 100, receivedBytes, totalBytes });

    // Combine collected data if not using callback
    let data: Uint8Array | undefined;
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
      ...(data ? { data } : {}),
    };
  }

  private async attemptChunkUpload(
    url: string,
    fetchOptions: RequestInit,
    opts: {
      retries: number;
      backoffMs: number;
      maxBackoffMs: number;
      timeoutMs: number;
      signal?: AbortSignal;
      progress: (evt: ProgressEvent) => void;
      chunkIndex: number;
      totalChunks: number;
    }
  ): Promise<void> {
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
      if (signal?.aborted) {
        throw signal.reason || new DropgateAbortError();
      }

      const { signal: s, cleanup } = makeAbortSignal(signal, timeoutMs);
      try {
        const res = await this.fetchFn(url, { ...fetchOptions, signal: s });
        if (res.ok) return;

        const text = await res.text().catch(() => '');
        const err = new DropgateProtocolError(
          `Chunk ${chunkIndex + 1} failed (HTTP ${res.status}).`,
          {
            details: { status: res.status, bodySnippet: text.slice(0, 120) },
          }
        );
        throw err;
      } catch (err) {
        cleanup();

        // AbortError should not retry
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
        ) {
          throw err;
        }
        if (signal?.aborted) {
          throw signal.reason || new DropgateAbortError();
        }

        if (attemptsLeft <= 0) {
          throw err instanceof DropgateError
            ? err
            : new DropgateNetworkError('Chunk upload failed.', { cause: err });
        }

        const attemptNumber = maxRetries - attemptsLeft + 1;
        let remaining = currentBackoff;
        const tick = 100;
        while (remaining > 0) {
          const secondsLeft = (remaining / 1000).toFixed(1);
          progress({
            phase: 'retry-wait',
            text: `Chunk upload failed. Retrying in ${secondsLeft}s... (${attemptNumber}/${maxRetries})`,
            chunkIndex,
            totalChunks,
          });
          await sleep(Math.min(tick, remaining), signal);
          remaining -= tick;
        }

        progress({
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

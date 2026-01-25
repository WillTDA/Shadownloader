import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import type { P2PReceiveOptions, P2PReceiveSession, P2PReceiveState, DataConnection } from './types.js';
import { isP2PCodeLike } from './utils.js';
import { buildPeerOptions, resolvePeerConfig } from './helpers.js';

/**
 * Start a direct transfer (P2P) receiver session.
 *
 * IMPORTANT: Consumer must provide the PeerJS Peer constructor and handle file writing.
 * This removes DOM coupling (no streamSaver).
 *
 * Example:
 * ```js
 * import Peer from 'peerjs';
 * import { startP2PReceive } from '@dropgate/core/p2p';
 *
 * let writer;
 * const session = await startP2PReceive({
 *   code: 'ABCD-1234',
 *   Peer,
 *   host: 'dropgate.link',
 *   secure: true,
 *   onMeta: ({ name, total }) => {
 *     // Consumer creates file writer
 *     writer = createWriteStream(name);
 *   },
 *   onData: async (chunk) => {
 *     // Consumer writes data
 *     await writer.write(chunk);
 *   },
 *   onComplete: () => {
 *     writer.close();
 *     console.log('Done!');
 *   },
 * });
 * ```
 */
export async function startP2PReceive(opts: P2PReceiveOptions): Promise<P2PReceiveSession> {
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
    watchdogTimeoutMs = 15000,
    onStatus,
    onMeta,
    onData,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
  } = opts;

  // Validate required options
  if (!code) {
    throw new DropgateValidationError('No sharing code was provided.');
  }

  if (!Peer) {
    throw new DropgateValidationError(
      'PeerJS Peer constructor is required. Install peerjs and pass it as the Peer option.'
    );
  }

  // Check P2P capabilities if serverInfo is provided
  const p2pCaps = serverInfo?.capabilities?.p2p;
  if (serverInfo && !p2pCaps?.enabled) {
    throw new DropgateValidationError('Direct transfer is disabled on this server.');
  }

  // Validate and normalize code
  const normalizedCode = String(code).trim().replace(/\s+/g, '').toUpperCase();
  if (!isP2PCodeLike(normalizedCode)) {
    throw new DropgateValidationError('Invalid direct transfer code.');
  }

  // Resolve config from user options and server capabilities
  const { path: finalPath, iceServers: finalIceServers } = resolvePeerConfig(
    { peerjsPath, iceServers },
    p2pCaps
  );

  // Build peer options
  const peerOpts = buildPeerOptions({
    host,
    port,
    peerjsPath: finalPath,
    secure,
    iceServers: finalIceServers,
  });

  // Create peer (receiver doesn't need a specific ID)
  const peer = new Peer(undefined, peerOpts);

  // State machine - replaces boolean flags to prevent race conditions
  let state: P2PReceiveState = 'initializing';
  let total = 0;
  let received = 0;
  let currentSessionId: string | null = null;
  let lastProgressSentAt = 0;
  const progressIntervalMs = 120;
  let writeQueue = Promise.resolve();
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let activeConn: DataConnection | null = null;

  // Watchdog - detects dead connections during transfer
  const resetWatchdog = (): void => {
    if (watchdogTimeoutMs <= 0) return;

    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
    }

    watchdogTimer = setTimeout(() => {
      if (state === 'transferring') {
        safeError(new DropgateNetworkError('Connection timed out (no data received).'));
      }
    }, watchdogTimeoutMs);
  };

  const clearWatchdog = (): void => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  // Safe error handler - prevents calling onError after completion
  const safeError = (err: Error): void => {
    if (state === 'closed' || state === 'completed') return;
    state = 'closed';
    onError?.(err);
    cleanup();
  };

  // Safe complete handler - only fires from transferring state
  const safeComplete = (completeData: { received: number; total: number }): void => {
    if (state !== 'transferring') return;
    state = 'completed';
    onComplete?.(completeData);
    cleanup();
  };

  // Cleanup all resources
  const cleanup = (): void => {
    clearWatchdog();

    // Remove beforeunload listener if in browser
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleUnload);
    }

    try {
      peer.destroy();
    } catch {
      // Ignore destroy errors
    }
  };

  // Handle browser tab close/refresh
  const handleUnload = (): void => {
    try {
      activeConn?.send({ t: 'error', message: 'Receiver closed the connection.' });
    } catch {
      // Best effort
    }
    stop();
  };

  // Add beforeunload listener if in browser
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', handleUnload);
  }

  const stop = (): void => {
    if (state === 'closed') return;
    state = 'closed';
    cleanup();
  };

  peer.on('error', (err: Error) => {
    safeError(err);
  });

  peer.on('open', () => {
    state = 'connecting';
    const conn = peer.connect(normalizedCode, { reliable: true });
    activeConn = conn;

    conn.on('open', () => {
      state = 'negotiating';
      onStatus?.({ phase: 'connected', message: 'Waiting for file details...' });
    });

    conn.on('data', async (data: unknown) => {
      try {
        // Reset watchdog on any data received
        resetWatchdog();

        // Handle control messages
        if (
          data &&
          typeof data === 'object' &&
          !(data instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(data)
        ) {
          const msg = data as {
            t?: string;
            sessionId?: string;
            name?: string;
            size?: number;
            message?: string;
          };

          if (msg.t === 'meta') {
            // Session ID validation - reject if we're busy with a different session
            if (currentSessionId && msg.sessionId && msg.sessionId !== currentSessionId) {
              try {
                conn.send({ t: 'error', message: 'Busy with another session.' });
              } catch {
                // Ignore send errors
              }
              return;
            }

            // Store the session ID for this transfer
            if (msg.sessionId) {
              currentSessionId = msg.sessionId;
            }

            const name = String(msg.name || 'file');
            total = Number(msg.size) || 0;
            received = 0;
            writeQueue = Promise.resolve();

            // Function to send ready signal - called automatically if autoReady is true,
            // or passed to onMeta callback for manual invocation if autoReady is false
            const sendReady = (): void => {
              state = 'transferring';
              // Start watchdog once we're ready to receive data
              resetWatchdog();
              try {
                conn.send({ t: 'ready' });
              } catch {
                // Ignore send errors
              }
            };

            if (autoReady) {
              onMeta?.({ name, total });
              onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
              sendReady();
            } else {
              // Pass sendReady function to callback so consumer can trigger transfer start
              onMeta?.({ name, total, sendReady });
              onProgress?.({ processedBytes: received, totalBytes: total, percent: 0 });
            }
            return;
          }

          if (msg.t === 'ping') {
            // Respond to heartbeat - keeps watchdog alive and confirms we're active
            try {
              conn.send({ t: 'pong' });
            } catch {
              // Ignore send errors
            }
            return;
          }

          if (msg.t === 'end') {
            clearWatchdog();
            await writeQueue;

            if (total && received < total) {
              const err = new DropgateNetworkError(
                'Transfer ended before the full file was received.'
              );
              try {
                conn.send({ t: 'error', message: err.message });
              } catch {
                // Ignore send errors
              }
              throw err;
            }

            try {
              conn.send({ t: 'ack', phase: 'end', received, total });
            } catch {
              // Ignore send errors
            }

            safeComplete({ received, total });
            return;
          }

          if (msg.t === 'error') {
            throw new DropgateNetworkError(msg.message || 'Sender reported an error.');
          }

          return;
        }

        // Handle binary data
        let bufPromise: Promise<Uint8Array>;

        if (data instanceof ArrayBuffer) {
          bufPromise = Promise.resolve(new Uint8Array(data));
        } else if (ArrayBuffer.isView(data)) {
          bufPromise = Promise.resolve(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          );
        } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
          bufPromise = data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
        } else {
          return;
        }

        writeQueue = writeQueue
          .then(async () => {
            const buf = await bufPromise;

            // Call consumer's onData handler
            if (onData) {
              await onData(buf);
            }

            received += buf.byteLength;
            const percent = total ? Math.min(100, (received / total) * 100) : 0;
            onProgress?.({ processedBytes: received, totalBytes: total, percent });

            const now = Date.now();
            if (received === total || now - lastProgressSentAt >= progressIntervalMs) {
              lastProgressSentAt = now;
              try {
                conn.send({ t: 'progress', received, total });
              } catch {
                // Ignore send errors
              }
            }
          })
          .catch((err) => {
            try {
              conn.send({
                t: 'error',
                message: (err as Error)?.message || 'Receiver write failed.',
              });
            } catch {
              // Ignore send errors
            }
            safeError(err as Error);
          });
      } catch (err) {
        safeError(err as Error);
      }
    });

    conn.on('close', () => {
      if (state === 'closed' || state === 'completed') {
        // Clean shutdown, ensure full cleanup
        cleanup();
        return;
      }

      // Sender disconnected before transfer completed
      if (state === 'transferring') {
        // We were mid-transfer
        safeError(new DropgateNetworkError('Sender disconnected during transfer.'));
      } else if (state === 'negotiating') {
        // We had metadata but transfer hadn't started
        state = 'closed';
        cleanup();
        onDisconnect?.();
      } else {
        // Disconnected before we even got file metadata
        safeError(new DropgateNetworkError('Sender disconnected before file details were received.'));
      }
    });
  });

  return {
    peer,
    stop,
    getStatus: () => state,
    getBytesReceived: () => received,
    getTotalBytes: () => total,
    getSessionId: () => currentSessionId,
  };
}

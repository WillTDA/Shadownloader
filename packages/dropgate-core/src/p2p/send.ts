import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import { sleep } from '../utils/network.js';
import type { P2PSendOptions, P2PSendSession, P2PSendState, DataConnection } from './types.js';
import { generateP2PCode } from './utils.js';
import { buildPeerOptions, createPeerWithRetries, resolvePeerConfig } from './helpers.js';

/**
 * Generate a unique session ID for transfer tracking.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Start a direct transfer (P2P) sender session.
 *
 * IMPORTANT: Consumer must provide the PeerJS Peer constructor.
 * This removes DOM coupling (no script injection).
 *
 * Example:
 * ```js
 * import Peer from 'peerjs';
 * import { startP2PSend } from '@dropgate/core/p2p';
 *
 * const session = await startP2PSend({
 *   file: myFile,
 *   Peer,
 *   host: 'dropgate.link',
 *   secure: true,
 *   onCode: (code) => console.log('Share this code:', code),
 *   onProgress: (evt) => console.log(`${evt.percent}% sent`),
 *   onComplete: () => console.log('Done!'),
 * });
 * ```
 */
export async function startP2PSend(opts: P2PSendOptions): Promise<P2PSendSession> {
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
    endAckTimeoutMs = 15000,
    bufferHighWaterMark = 8 * 1024 * 1024,
    bufferLowWaterMark = 2 * 1024 * 1024,
    heartbeatIntervalMs = 5000,
    onCode,
    onStatus,
    onProgress,
    onComplete,
    onError,
    onDisconnect,
    onCancel,
  } = opts;

  // Validate required options
  if (!file) {
    throw new DropgateValidationError('File is missing.');
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

  // Create the code generator
  const finalCodeGenerator = codeGenerator || (() => generateP2PCode(cryptoObj));

  // Create peer with retries
  const buildPeer = (id: string) => new Peer(id, peerOpts);
  const { peer, code } = await createPeerWithRetries({
    code: null,
    codeGenerator: finalCodeGenerator,
    maxAttempts,
    buildPeer,
    onCode,
  });

  // Generate unique session ID for this transfer
  const sessionId = generateSessionId();

  // State machine - replaces boolean flags to prevent race conditions
  let state: P2PSendState = 'listening';
  let activeConn: DataConnection | null = null;
  let sentBytes = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const reportProgress = (data: { received: number; total: number }): void => {
    const safeTotal =
      Number.isFinite(data.total) && data.total > 0 ? data.total : file.size;
    const safeReceived = Math.min(Number(data.received) || 0, safeTotal || 0);
    const percent = safeTotal ? (safeReceived / safeTotal) * 100 : 0;
    onProgress?.({ processedBytes: safeReceived, totalBytes: safeTotal, percent });
  };

  // Safe error handler - prevents calling onError after completion or cancellation
  const safeError = (err: Error): void => {
    if (state === 'closed' || state === 'completed' || state === 'cancelled') return;
    state = 'closed';
    onError?.(err);
    cleanup();
  };

  // Safe complete handler - only fires from finishing state
  const safeComplete = (): void => {
    if (state !== 'finishing') return;
    state = 'completed';
    onComplete?.();
    cleanup();
  };

  // Cleanup all resources
  const cleanup = (): void => {
    // Clear heartbeat timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Remove beforeunload listener if in browser
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', handleUnload);
    }

    try {
      activeConn?.close();
    } catch {
      // Ignore close errors
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
      activeConn?.send({ t: 'error', message: 'Sender closed the connection.' });
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
    if (state === 'closed' || state === 'cancelled') return;

    const wasActive = state === 'transferring' || state === 'finishing';
    state = 'cancelled';

    // Notify peer before cleanup
    try {
      // @ts-expect-error - open property may exist on PeerJS connections
      if (activeConn && activeConn.open) {
        activeConn.send({ t: 'cancelled', message: 'Sender cancelled the transfer.' });
      }
    } catch {
      // Best effort
    }

    if (wasActive && onCancel) {
      onCancel({ cancelledBy: 'sender' });
    }

    cleanup();
  };

  // Helper to check if session is stopped - bypasses TypeScript narrowing
  // which doesn't understand state can change asynchronously
  const isStopped = (): boolean => state === 'closed' || state === 'cancelled';

  peer.on('connection', (conn: DataConnection) => {
    if (state === 'closed') return;

    // Connection replacement logic - allow new connections if old one is dead
    if (activeConn) {
      // Check if existing connection is actually still open
      // @ts-expect-error - open property may exist on PeerJS connections
      const isOldConnOpen = activeConn.open !== false;

      if (isOldConnOpen && state === 'transferring') {
        // Actively transferring, reject new connection
        try {
          conn.send({ t: 'error', message: 'Transfer already in progress.' });
        } catch {
          // Ignore send errors
        }
        try {
          conn.close();
        } catch {
          // Ignore close errors
        }
        return;
      } else if (!isOldConnOpen) {
        // Old connection is dead, clean it up and accept new one
        try {
          activeConn.close();
        } catch {
          // Ignore
        }
        activeConn = null;
        // Reset state to allow new transfer
        state = 'listening';
        sentBytes = 0;
      } else {
        // Connection exists but not transferring (maybe in negotiating state)
        // Reject to avoid confusion
        try {
          conn.send({ t: 'error', message: 'Another receiver is already connected.' });
        } catch {
          // Ignore send errors
        }
        try {
          conn.close();
        } catch {
          // Ignore close errors
        }
        return;
      }
    }

    activeConn = conn;
    state = 'negotiating';
    onStatus?.({ phase: 'waiting', message: 'Connected. Waiting for receiver to accept...' });

    let readyResolve: (() => void) | null = null;
    let ackResolve: ((data: unknown) => void) | null = null;

    const readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    const ackPromise = new Promise<unknown>((resolve) => {
      ackResolve = resolve;
    });

    conn.on('data', (data: unknown) => {
      if (
        !data ||
        typeof data !== 'object' ||
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data)
      ) {
        return;
      }

      const msg = data as { t?: string; received?: number; total?: number; phase?: string; message?: string };
      if (!msg.t) return;

      if (msg.t === 'ready') {
        onStatus?.({ phase: 'transferring', message: 'Receiver accepted. Starting transfer...' });
        readyResolve?.();
        return;
      }

      if (msg.t === 'progress') {
        reportProgress({ received: msg.received || 0, total: msg.total || 0 });
        return;
      }

      if (msg.t === 'ack' && msg.phase === 'end') {
        ackResolve?.(msg);
        return;
      }

      if (msg.t === 'pong') {
        // Heartbeat response received, connection is alive
        return;
      }

      if (msg.t === 'error') {
        safeError(new DropgateNetworkError(msg.message || 'Receiver reported an error.'));
        return;
      }

      if (msg.t === 'cancelled') {
        if (state === 'cancelled' || state === 'closed' || state === 'completed') return;
        state = 'cancelled';
        onCancel?.({ cancelledBy: 'receiver', message: msg.message });
        cleanup();
      }
    });

    conn.on('open', async () => {
      try {
        if (isStopped()) return;

        // Send metadata with sessionId
        conn.send({
          t: 'meta',
          sessionId,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });

        const total = file.size;
        const dc = conn._dc;

        if (dc && Number.isFinite(bufferLowWaterMark)) {
          try {
            dc.bufferedAmountLowThreshold = bufferLowWaterMark;
          } catch {
            // Ignore threshold setting errors
          }
        }

        // Wait for ready signal
        await readyPromise;
        if (isStopped()) return;

        // Start heartbeat for long transfers
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (state === 'transferring' || state === 'finishing') {
              try {
                conn.send({ t: 'ping' });
              } catch {
                // Ignore ping errors
              }
            }
          }, heartbeatIntervalMs);
        }

        state = 'transferring';

        // Send file in chunks
        for (let offset = 0; offset < total; offset += chunkSize) {
          if (isStopped()) return;

          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          if (isStopped()) return;
          conn.send(buf);
          sentBytes += buf.byteLength;

          // Flow control
          if (dc) {
            while (dc.bufferedAmount > bufferHighWaterMark) {
              await new Promise<void>((resolve) => {
                const fallback = setTimeout(resolve, 60);
                try {
                  dc.addEventListener(
                    'bufferedamountlow',
                    () => {
                      clearTimeout(fallback);
                      resolve();
                    },
                    { once: true }
                  );
                } catch {
                  // Fallback only
                }
              });
            }
          }
        }

        if (isStopped()) return;

        state = 'finishing';
        conn.send({ t: 'end' });

        // Wait for acknowledgment
        const ackTimeoutMs = Number.isFinite(endAckTimeoutMs)
          ? Math.max(endAckTimeoutMs, Math.ceil(file.size / (1024 * 1024)) * 1000)
          : null;

        const ackResult = await Promise.race([
          ackPromise,
          sleep(ackTimeoutMs || 15000).catch(() => null),
        ]);

        if (isStopped()) return;

        if (!ackResult || typeof ackResult !== 'object') {
          throw new DropgateNetworkError('Receiver did not confirm completion.');
        }

        const ackData = ackResult as { total?: number; received?: number };
        const ackTotal = Number(ackData.total) || file.size;
        const ackReceived = Number(ackData.received) || 0;

        if (ackTotal && ackReceived < ackTotal) {
          throw new DropgateNetworkError('Receiver reported an incomplete transfer.');
        }

        reportProgress({ received: ackReceived || ackTotal, total: ackTotal });
        safeComplete();
      } catch (err) {
        safeError(err as Error);
      }
    });

    conn.on('error', (err: Error) => {
      safeError(err);
    });

    conn.on('close', () => {
      if (state === 'closed' || state === 'completed' || state === 'cancelled') {
        // Clean shutdown or already cancelled, ensure full cleanup
        cleanup();
        return;
      }

      if (state === 'transferring' || state === 'finishing') {
        // Connection closed during active transfer — the receiver either cancelled
        // or disconnected. Treat as a receiver-initiated cancellation so the UI
        // can reset cleanly instead of showing a raw error.
        state = 'cancelled';
        onCancel?.({ cancelledBy: 'receiver' });
        cleanup();
      } else {
        // Disconnected before transfer started (during waiting/negotiating phase)
        // Reset state to allow reconnection
        activeConn = null;
        state = 'listening';
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
      // @ts-expect-error - peer property exists on PeerJS DataConnection
      return activeConn.peer || null;
    },
  };
}

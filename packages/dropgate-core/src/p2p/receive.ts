import { DropgateValidationError, DropgateNetworkError } from '../errors.js';
import type { P2PReceiveOptions, P2PReceiveSession } from './types.js';
import { isP2PCodeLike } from './utils.js';
import { buildPeerOptions } from './helpers.js';

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

  // Determine options (use serverInfo if available)
  const finalPath = peerjsPath ?? p2pCaps?.peerjsPath ?? '/peerjs';
  const finalIceServers = iceServers ?? p2pCaps?.iceServers ?? [];

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

  let total = 0;
  let received = 0;
  let lastProgressSentAt = 0;
  const progressIntervalMs = 120;
  let writeQueue = Promise.resolve();

  const stop = (): void => {
    try {
      peer.destroy();
    } catch {
      // Ignore destroy errors
    }
  };

  peer.on('error', (err: Error) => {
    onError?.(err);
    stop();
  });

  peer.on('open', () => {
    const conn = peer.connect(normalizedCode, { reliable: true });

    conn.on('open', () => {
      onStatus?.({ phase: 'connected', message: 'Waiting for file details...' });
    });

    conn.on('data', async (data: unknown) => {
      try {
        // Handle control messages
        if (
          data &&
          typeof data === 'object' &&
          !(data instanceof ArrayBuffer) &&
          !ArrayBuffer.isView(data)
        ) {
          const msg = data as {
            t?: string;
            name?: string;
            size?: number;
            message?: string;
          };

          if (msg.t === 'meta') {
            const name = String(msg.name || 'file');
            total = Number(msg.size) || 0;
            received = 0;
            writeQueue = Promise.resolve();

            onMeta?.({ name, total });
            onProgress?.({ received, total, percent: 0 });

            try {
              conn.send({ t: 'ready' });
            } catch {
              // Ignore send errors
            }
            return;
          }

          if (msg.t === 'end') {
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

            onComplete?.({ received, total });

            try {
              conn.send({ t: 'ack', phase: 'end', received, total });
            } catch {
              // Ignore send errors
            }
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
            onProgress?.({ received, total, percent });

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
            onError?.(err as Error);
            stop();
          });
      } catch (err) {
        onError?.(err as Error);
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

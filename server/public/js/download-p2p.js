import { getServerInfo, isSecureContextForP2P, startP2PReceive } from './dropgate-core.js';
import { setStatusError, setStatusSuccess, StatusType, Icons, updateStatusCard, clearStatusBorder } from './status-card.js';

const elTitle = document.getElementById('title');
const elMsg = document.getElementById('message');
const elMeta = document.getElementById('meta');
const elBar = document.getElementById('bar');
const elBytes = document.getElementById('bytes');
const elActions = document.getElementById('actions');
const retryBtn = document.getElementById('retryBtn');
const elFileDetails = document.getElementById('file-details');
const elFileName = document.getElementById('file-name');
const elFileSize = document.getElementById('file-size');
const elDownloadBtn = document.getElementById('download-button');
const elCancelBtn = document.getElementById('cancel-button');
const elProgressContainer = document.getElementById('progress-container');
const card = document.getElementById('status-card');
const iconContainer = document.getElementById('icon-container');

retryBtn?.addEventListener('click', () => location.reload());

const code = document.body.dataset.code;

let total = 0;
let received = 0;
let transferCompleted = false;
let writer = null;
let pendingSendReady = null;
let fileName = null;
let p2pSession = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
}

const setProgress = () => {
  const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  elBar.style.width = `${pct}%`;
  elBytes.textContent = `${formatBytes(received)} / ${formatBytes(total)}`;
};

const showError = (title, message) => {
  setStatusError({
    card,
    iconContainer,
    titleEl: elTitle,
    messageEl: elMsg,
    title,
    message,
  });
  elMeta.hidden = true;
  elFileDetails.style.display = 'none';
  elDownloadBtn.style.display = 'none';
  elProgressContainer.style.display = 'none';
  elActions.hidden = false;
  elBytes.hidden = true;
  elBar.parentElement.hidden = true;
};

async function loadServerInfo() {
  const { serverInfo } = await getServerInfo({
    host: location.hostname,
    port: location.port ? Number(location.port) : undefined,
    secure: location.protocol === 'https:',
    timeoutMs: 5000,
  });
  return serverInfo;
}

async function loadPeerJS() {
  if (globalThis.Peer) return globalThis.Peer;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/peerjs/peerjs.min.js';
    script.async = true;
    script.onload = () => {
      if (globalThis.Peer) resolve(globalThis.Peer);
      else reject(new Error('PeerJS failed to initialize'));
    };
    script.onerror = () => reject(new Error('Failed to load PeerJS'));
    document.head.appendChild(script);
  });
}

function startDownload() {
  if (!pendingSendReady) return;

  elDownloadBtn.style.display = 'none';
  elProgressContainer.style.display = 'block';
  elCancelBtn.style.display = 'inline-block';

  updateStatusCard({
    card,
    iconContainer,
    titleEl: elTitle,
    messageEl: elMsg,
    status: StatusType.PRIMARY,
    icon: Icons.SYNC,
    title: 'Receiving...',
    message: 'Keep this tab open until the transfer completes.',
  });

  // Create streamSaver write stream
  if (window.streamSaver?.createWriteStream) {
    const stream = window.streamSaver.createWriteStream(fileName, total ? { size: total } : undefined);
    writer = stream.getWriter();
  }

  // Wire up cancel button
  elCancelBtn.onclick = () => {
    if (p2pSession) {
      p2pSession.stop();
      p2pSession = null;
    }
    elCancelBtn.style.display = 'none';
  };

  // Signal the sender that we're ready to receive
  pendingSendReady();
  pendingSendReady = null;
}

async function start() {
  if (!code) {
    showError('Invalid link', 'No sharing code was provided.');
    return;
  }

  if (!isSecureContextForP2P(location.hostname, window.isSecureContext)) {
    showError('Secure connection required', 'P2P transfers require HTTPS in most browsers.');
    return;
  }

  elTitle.textContent = 'Connecting...';
  elMsg.textContent = `Connecting to ${code}...`;

  let info;
  try {
    info = await loadServerInfo();
  } catch {
    info = {};
  }

  const p2p = info?.capabilities?.p2p || {};
  if (p2p.enabled === false) {
    showError('Direct transfer disabled', 'This server has P2P disabled.');
    return;
  }

  // Load PeerJS
  let Peer;
  try {
    Peer = await loadPeerJS();
  } catch (err) {
    console.error(err);
    showError('Failed to load', 'Could not load the P2P library.');
    return;
  }

  const peerjsPath = p2p.peerjsPath || '/peerjs';
  const iceServers = Array.isArray(p2p.iceServers) ? p2p.iceServers : [];

  try {
    p2pSession = await startP2PReceive({
      code,
      Peer,
      host: location.hostname,
      port: location.port ? Number(location.port) : undefined,
      secure: location.protocol === 'https:',
      serverInfo: info,
      peerjsPath,
      iceServers,
      autoReady: false, // We want to show preview before starting transfer
      onStatus: () => {
        elTitle.textContent = 'Connected';
        elMsg.textContent = 'Waiting for file details...';
      },
      onMeta: ({ name, total: nextTotal, sendReady }) => {
        total = nextTotal;
        received = 0;
        fileName = name;

        // Store the sendReady function to call when user clicks download
        pendingSendReady = sendReady;

        // Show file preview
        elTitle.textContent = 'Ready to Transfer';
        elMsg.textContent = 'Review the file details below, then click Start Transfer.';

        elFileName.textContent = name;
        elFileSize.textContent = formatBytes(total);
        elFileDetails.style.display = 'block';
        elDownloadBtn.style.display = 'inline-block';

        // Clear border for neutral preview state
        clearStatusBorder(card);

        // Add click handler for download button
        elDownloadBtn.addEventListener('click', startDownload, { once: true });
      },
      onData: async (chunk) => {
        // Write chunk to file via streamSaver
        if (writer) {
          await writer.write(chunk);
        }
        received += chunk.byteLength;
        setProgress();
      },
      onProgress: ({ processedBytes: nextReceived, totalBytes: nextTotal }) => {
        // Progress is also tracked via onData, but update from sender feedback too
        if (nextReceived > received) received = nextReceived;
        if (nextTotal > 0) total = nextTotal;
        setProgress();
      },
      onComplete: async () => {
        transferCompleted = true;

        // Close the writer
        if (writer) {
          try {
            await writer.close();
          } catch (err) {
            console.error('Error closing writer:', err);
          }
          writer = null;
        }

        setStatusSuccess({
          card,
          iconContainer,
          titleEl: elTitle,
          messageEl: elMsg,
          title: 'Transfer Complete',
          message: 'Success!',
        });
        elMeta.textContent = 'The file has been saved to your downloads.';
        elMeta.hidden = false;
        elFileDetails.style.display = 'none';
        elCancelBtn.style.display = 'none';
        p2pSession = null;
      },
      onError: (err) => {
        if (transferCompleted) return;
        console.error(err);

        // Abort the writer on error
        if (writer) {
          try {
            writer.abort();
          } catch {
            // Ignore abort errors
          }
          writer = null;
        }

        elCancelBtn.style.display = 'none';
        p2pSession = null;

        if (err?.message?.startsWith('Could not connect to peer')) {
          showError('Connection Failed', 'Could not connect to the sender. Check the code, ensure the sender is online, and try again.');
          return;
        }
        showError('Transfer Error', 'An error occurred during the transfer.');
      },
      onDisconnect: () => {
        if (transferCompleted) return;

        // Abort the writer on disconnect
        if (writer) {
          try {
            writer.abort();
          } catch {
            // Ignore abort errors
          }
          writer = null;
        }

        elCancelBtn.style.display = 'none';
        p2pSession = null;
        showError('Disconnected', 'The sender disconnected before the transfer finished.');
      },
      onCancel: (evt) => {
        if (transferCompleted) return;

        // Abort the writer on cancellation
        if (writer) {
          try {
            writer.abort();
          } catch {
            // Ignore abort errors
          }
          writer = null;
        }

        elCancelBtn.style.display = 'none';
        p2pSession = null;

        // Show appropriate message based on who cancelled
        const message = evt.cancelledBy === 'sender'
          ? 'The sender cancelled the transfer.'
          : 'You cancelled the transfer.';
        showError('Transfer Cancelled', message);

        // Hide retry button on cancellation
        elActions.hidden = true;
      },
    });
  } catch (err) {
    console.error(err);
    showError('Connection Failed', 'Could not connect to the sender. Check the code and try again.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start());
else void start();

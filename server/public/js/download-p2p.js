import { ShadownloaderClient, isSecureContextForP2P, startP2PReceive } from './shadownloader-core.js';

const elTitle = document.getElementById('title');
const elMsg = document.getElementById('message');
const elMeta = document.getElementById('meta');
const elBar = document.getElementById('bar');
const elBytes = document.getElementById('bytes');
const elActions = document.getElementById('actions');
const retryBtn = document.getElementById('retryBtn');

retryBtn?.addEventListener('click', () => location.reload());

const code = document.body.dataset.code;

let total = 0;
let received = 0;

const fmtBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  const dp = v < 10 && u > 0 ? 2 : (v < 100 ? 1 : 0);
  return `${v.toFixed(dp)} ${units[u]}`;
};

const setProgress = () => {
  const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  elBar.style.width = `${pct}%`;
  elBytes.textContent = `${fmtBytes(received)} / ${fmtBytes(total)}`;
};

const showError = (title, message) => {
  elTitle.textContent = title;
  elMsg.textContent = message;
  elMeta.hidden = true;
  elActions.hidden = false;
};

async function loadServerInfo() {
  const client = new ShadownloaderClient({ clientVersion: '0.0.0' });
  const { serverInfo } = await client.getServerInfo(location.origin, { timeoutMs: 5000 });
  return serverInfo;
}

async function start() {
  if (!code) {
    showError('Invalid link', 'No sharing code was provided.');
    return;
  }

  if (!isSecureContextForP2P()) {
    showError('Secure connection required', 'P2P transfers require HTTPS in most browsers.');
    return;
  }

  elTitle.textContent = 'Connecting…';
  elMsg.textContent = `Connecting to ${code}…`;

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

  const peerjsPath = p2p.peerjsPath || '/peerjs';
  const iceServers = Array.isArray(p2p.iceServers) ? p2p.iceServers : [];

  try {
    await startP2PReceive({
      code,
      peerjsPath,
      iceServers,
      onStatus: () => {
        elTitle.textContent = 'Connected';
        elMsg.textContent = 'Waiting for file details…';
      },
      onMeta: ({ name, total: nextTotal }) => {
        total = nextTotal;
        received = 0;
        elMeta.hidden = false;
        elMeta.textContent = `Receiving: ${name} (${fmtBytes(total)})`;
        elTitle.textContent = 'Receiving…';
        elMsg.textContent = 'Keep this tab open until the transfer completes.';
        setProgress();
      },
      onProgress: ({ received: nextReceived, total: nextTotal }) => {
        received = nextReceived;
        total = nextTotal;
        setProgress();
      },
      onComplete: () => {
        elTitle.textContent = 'Complete';
        elMsg.textContent = 'Transfer finished.';
        elMeta.textContent = 'Saved to your downloads.';
        elActions.hidden = false;
      },
      onError: (err) => {
        console.error(err);
        showError('Transfer error', err?.message || 'An error occurred during the transfer.');
      },
      onDisconnect: () => {
        showError('Disconnected', 'The sender disconnected before the transfer finished.');
      },
    });
  } catch (err) {
    console.error(err);
    showError('Connection failed', err?.message || 'Could not connect.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start());
else void start();

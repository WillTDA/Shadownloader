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
let transferCompleted = false;

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
  const card = document.getElementById('status-card');
  const iconContainer = document.getElementById('icon-container');
  elTitle.textContent = title;
  elMsg.textContent = message;
  elMeta.hidden = true;
  elActions.hidden = false;
  elBytes.hidden = true;
  elBar.parentElement.hidden = true;
  card?.classList.remove('border-primary', 'border-success');
  card?.classList.add('border', 'border-danger');
  if (iconContainer) {
    iconContainer.className = 'mb-3 text-danger';
    iconContainer.innerHTML = '<span class="material-icons-round">error</span>';
  }
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

  const peerjsPath = p2p.peerjsPath || '/peerjs';
  const iceServers = Array.isArray(p2p.iceServers) ? p2p.iceServers : [];

  try {
    await startP2PReceive({
      code,
      serverInfo: info,
      peerjsPath,
      iceServers,
      onStatus: () => {
        elTitle.textContent = 'Connected';
        elMsg.textContent = 'Waiting for file details...';
      },
      onMeta: ({ name, total: nextTotal }) => {
        total = nextTotal;
        received = 0;
        elMeta.hidden = false;
        elMeta.textContent = `Receiving: ${name} (${formatBytes(total)})`;
        elTitle.textContent = 'Receiving...';
        elMsg.textContent = 'Keep this tab open until the transfer completes.';
        setProgress();
      },
      onProgress: ({ received: nextReceived, total: nextTotal }) => {
        received = nextReceived;
        total = nextTotal;
        setProgress();
      },
      onComplete: () => {
        transferCompleted = true;
        const card = document.getElementById('status-card');
        const iconContainer = document.getElementById('icon-container');
        elTitle.textContent = 'Transfer Complete';
        elMsg.textContent = 'Success!';
        elMeta.textContent = 'The file has been saved to your downloads.';
        card?.classList.remove('border-primary');
        card?.classList.add('border', 'border-success');
        if (iconContainer) {
          iconContainer.className = 'mb-3 text-success';
          iconContainer.innerHTML = '<span class="material-icons-round">check_circle</span>';
        }
      },
      onError: (err) => {
        if (transferCompleted) return;
        console.error(err);
        if (err?.message.startsWith('Could not connect to peer')) {
          showError('Connection Failed', 'Could not connect to the sender. Check the code, ensure the sender is online, and try again.');
          return;
        }
        showError('Transfer Error', 'An error occurred during the transfer.');
      },
      onDisconnect: () => {
        if (transferCompleted) return;
        showError('Disconnected', 'The sender disconnected before the transfer finished.');
      },
    });
  } catch (err) {
    console.error(err);
    showError('Connection Failed', 'Could not connect to the sender. Check the code and try again.');
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start());
else void start();

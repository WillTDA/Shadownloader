import { ShadownloaderClient } from './shadownloader-core.js';

const $ = (id) => document.getElementById(id);

const els = {
  dropzone: $('dropzone'),
  selectFileBtn: $('selectFileBtn'),
  fileInput: $('fileInput'),
  fileChosen: $('fileChosen'),
  fileChosenName: $('fileChosenName'),
  fileChosenSize: $('fileChosenSize'),
  maxUploadHint: $('maxUploadHint'),

  modeStandard: $('modeStandard'),
  modeP2P: $('modeP2P'),
  optUploadMode: $('optUploadMode'),

  optLifetime: $('optLifetime'),
  lifetimeValue: $('lifetimeValue'),
  lifetimeUnit: $('lifetimeUnit'),
  lifetimeHelp: $('lifetimeHelp'),

  optEncrypt: $('optEncrypt'),
  encYes: $('encYes'),
  encNo: $('encNo'),

  p2pInfo: $('p2pInfo'),
  startBtn: $('startBtn'),
  startHelp: $('startHelp'),
  helpMode: $('helpMode'),
  helpEnc: $('helpEnc'),

  panels: $('panels'),
  progressCard: $('progressCard'),
  progressIcon: $('progressIcon'),
  progressTitle: $('progressTitle'),
  progressSub: $('progressSub'),
  progressFill: $('progressFill'),
  progressBytes: $('progressBytes'),

  p2pWaitCard: $('p2pWaitCard'),
  p2pCode: $('p2pCode'),
  p2pLink: $('p2pLink'),
  copyP2PLink: $('copyP2PLink'),
  openP2PLink: $('openP2PLink'),
  cancelP2P: $('cancelP2P'),

  shareCard: $('shareCard'),
  shareLink: $('shareLink'),
  copyShare: $('copyShare'),
  openShare: $('openShare'),
  newUpload: $('newUpload'),

  codeInput: $('codeInput'),
  codeGo: $('codeGo'),
  statusAlert: $('statusAlert'),

  toast: $('toast'),
};

const state = {
  info: null,
  file: null,
  mode: 'standard',
  encrypt: true,
  uploadEnabled: false,
  p2pEnabled: false,
  maxSizeMB: null,
  maxLifetimeHours: null,
  e2ee: false,
  peerjsPath: '/peerjs',
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  p2pPeer: null,
  p2pConn: null,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
}

function showToast(text, type = "info", timeoutMs = 2500) {
  const el = els.statusAlert;
  if (!el) { alert(text); return; }
  el.textContent = String(text || "");
  el.className = `alert alert-${type} mt-3`;
  el.hidden = false;
  if (timeoutMs > 0) {
    const snap = el.textContent;
    setTimeout(() => { if (el.textContent === snap) el.hidden = true; }, timeoutMs);
  }
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function setSelected(btnA, btnB, aSelected) {
  btnA?.classList.toggle("active", aSelected);
  btnB?.classList.toggle("active", !aSelected);
  btnA?.setAttribute("aria-selected", aSelected ? "true" : "false");
  btnB?.setAttribute("aria-selected", !aSelected ? "true" : "false");
}

function normalizeCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // If a full URL was pasted, keep it as-is
  if (/^https?:\/\//i.test(s)) return s;
  // Strip spaces
  const compact = s.replace(/\s+/g, '');
  // Uppercase codes like abcd-1234
  if (/^[a-z0-9-]{4,20}$/i.test(compact)) return compact.toUpperCase();
  return compact;
}

function isUuidLike(s) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
}

function isP2PCodeLike(s) {
  return /^[A-Z]{4}-\d{4}$/.test(s);
}

function generateP2PCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let a = '';
  for (let i = 0; i < 4; i++) a += letters[Math.floor(Math.random() * letters.length)];
  let b = '';
  for (let i = 0; i < 4; i++) b += Math.floor(Math.random() * 10);
  return `${a}-${b}`;
}

function showPanels(which) {
  // which: 'main' | 'progress' | 'p2pwait' | 'share'
  setHidden(els.panels, which !== 'main');
  setHidden(els.progressCard, which !== 'progress');
  setHidden(els.p2pWaitCard, which !== 'p2pwait');
  setHidden(els.shareCard, which !== 'share');
}

function updateFileUI() {
  if (!state.file) {
    setHidden(els.fileChosen, true);
    els.dropzone?.classList.remove('dragover');
    return;
  }
  els.fileChosenName.textContent = state.file.name;
  els.fileChosenSize.textContent = formatBytes(state.file.size);
  setHidden(els.fileChosen, false);
}

function setMode(mode) {
  state.mode = mode;
  const isStandard = mode === 'standard';

  setSelected(els.modeStandard, els.modeP2P, isStandard);

  // Options shown in Standard mode
  setHidden(els.optLifetime, !isStandard);
  setHidden(els.optEncrypt, !isStandard);
  setHidden(els.p2pInfo, isStandard);

  if (isStandard) {
    els.startBtn.textContent = 'Start Upload';
  } else {
    els.startBtn.textContent = 'Start Transfer';
  }
}

function updateCapabilitiesUI() {
  // Upload
  if (state.uploadEnabled) {
    const maxText = (state.maxSizeMB === 0)
      ? 'Max upload size: unlimited'
      : `Max upload size: ${state.maxSizeMB} MB`;

    els.maxUploadHint.textContent = state.p2pEnabled
      ? `${maxText}. Anything over will use direct transfer (P2P).`
      : maxText;
  } else {
    els.maxUploadHint.textContent = state.p2pEnabled
      ? 'Standard uploads are disabled on this server. Direct transfer (P2P) is available.'
      : 'Uploads are disabled on this server.';
  }

  // Lifetime
  if (state.uploadEnabled) {
    if (state.maxLifetimeHours === 0) {
      els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server (0 = unlimited).';
    } else {
      els.lifetimeHelp.textContent = `Max lifetime: ${state.maxLifetimeHours} hours.`;
    }

    // Set a sane default
    const maxH = state.maxLifetimeHours;
    let defaultUnit = 'days';
    let defaultValue = 2;

    if (maxH > 0) {
      const maxDays = maxH / 24;
      if (maxDays >= 2) {
        defaultUnit = 'days';
        defaultValue = 2;
      } else {
        defaultUnit = 'hours';
        defaultValue = Math.max(1, Math.floor(maxH));
      }
    }

    els.lifetimeUnit.value = defaultUnit;
    els.lifetimeValue.value = String(defaultValue);
  }

  // Encryption
  const canEncrypt = state.uploadEnabled && state.e2ee && (window.isSecureContext || location.hostname === 'localhost');
  if (!canEncrypt) {
    state.encrypt = false;
    setSelected(els.encYes, els.encNo, false);
    els.helpEnc.title = state.uploadEnabled && state.e2ee ? 'Requires HTTPS to use Web Crypto.' : 'Not supported on this server.';
  }

  // Mode toggle availability
  if (!state.p2pEnabled) {
    els.modeP2P?.setAttribute('disabled', '');
    els.modeP2P?.classList.add('disabled');
  }

  if (!state.uploadEnabled) {
    // Force P2P mode if available
    els.modeStandard?.setAttribute('disabled', '');
    els.modeStandard?.classList.add('disabled');
    if (state.p2pEnabled) setMode('p2p');
  }
}

async function loadServerInfo() {
  const res = await fetch('/api/info', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load /api/info');
  const info = await res.json();
  state.info = info;

  const upload = info?.capabilities?.upload;
  state.uploadEnabled = Boolean(upload?.enabled);
  state.maxSizeMB = state.uploadEnabled ? (upload?.maxSizeMB ?? null) : null;
  state.maxLifetimeHours = state.uploadEnabled ? (upload?.maxLifetimeHours ?? null) : null;
  state.e2ee = state.uploadEnabled ? Boolean(upload?.e2ee) : false;

  const p2p = info?.capabilities?.p2p;
  state.p2pEnabled = Boolean(p2p?.enabled);
  if (p2p?.peerjsPath) state.peerjsPath = p2p.peerjsPath;
  if (Array.isArray(p2p?.iceServers) && p2p.iceServers.length) state.iceServers = p2p.iceServers;

  updateCapabilitiesUI();
}

function lifetimeMsFromUI() {
  const n = Number(els.lifetimeValue.value);
  const unit = els.lifetimeUnit.value;
  if (!Number.isFinite(n) || n < 0) return 0;
  const v = Math.floor(n);
  if (v === 0) return 0;
  if (unit === 'days') return v * 24 * 60 * 60 * 1000;
  return v * 60 * 60 * 1000;
}

function clampLifetimeMs(ms) {
  if (!state.uploadEnabled) return ms;
  const maxH = state.maxLifetimeHours;
  if (maxH === 0) return ms;
  const maxMs = maxH * 60 * 60 * 1000;
  return Math.min(ms, maxMs);
}

function showProgress({ title, sub, percent, doneBytes, totalBytes, icon }) {
  showPanels('progress');
  if (icon != null) els.progressIcon.textContent = icon;
  if (title) els.progressTitle.textContent = title;
  if (sub) els.progressSub.textContent = sub;
  if (typeof percent === 'number') els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (Number.isFinite(doneBytes) && Number.isFinite(totalBytes)) {
    els.progressBytes.textContent = `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`;
  }
}

function showShare(link) {
  showPanels('share');
  els.shareLink.value = link;
}

function resetToMain() {
  state.file = null;
  updateFileUI();
  showPanels('main');
  els.shareLink.value = '';
  els.p2pLink.value = '';
  els.progressFill.style.width = '0%';
  els.progressBytes.textContent = '0 / 0';
  stopP2P();
}

function stopP2P() {
  try { state.p2pConn?.close(); } catch {}
  try { state.p2pPeer?.destroy(); } catch {}
  state.p2pConn = null;
  state.p2pPeer = null;
}

function copyToClipboard(value) {
  return navigator.clipboard?.writeText(value).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

async function startStandardUpload() {
  if (!state.uploadEnabled) {
    showToast('Standard uploads are disabled on this server.');
    return;
  }

  const file = state.file;
  if (!file) {
    showToast('Select a file first.');
    return;
  }

  // Decide whether to fall back to P2P if too big
  if (state.p2pEnabled && state.maxSizeMB && state.maxSizeMB > 0) {
    const maxBytes = state.maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      setMode('p2p');
      showToast('File exceeds the server upload limit — using direct transfer.');
      return startP2PSend();
    }
  }

  const client = new ShadownloaderClient({ clientVersion: 'webui' });

  const lifetimeMs = clampLifetimeMs(lifetimeMsFromUI());
  const encrypt = Boolean(state.encrypt);

  showProgress({ title: 'Uploading', sub: 'Preparing…', percent: 0, doneBytes: 0, totalBytes: file.size, icon: '⬆' });

  try {
    const result = await client.uploadFile({
      serverUrl: location.origin,
      file,
      encrypt,
      lifetimeMs,
      progress: ({ phase, text, percent }) => {
        const p = (typeof percent === 'number') ? percent : 0;
        showProgress({
          title: 'Uploading',
          sub: text || phase,
          percent: p,
          doneBytes: Math.floor((p / 100) * file.size),
          totalBytes: file.size,
          icon: '⬆',
        });
      },
    });

    showProgress({ title: 'Uploading', sub: 'Upload successful!', percent: 100, doneBytes: file.size, totalBytes: file.size, icon: '⬆' });
    showShare(result.downloadUrl);
  } catch (err) {
    console.error(err);
    showToast(err?.message || 'Upload failed.');
    showPanels('main');
  }
}

function ensurePeerJsLoaded() {
  if (window.Peer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/peerjs.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load PeerJS client.')); 
    document.head.appendChild(s);
  });
}

async function startP2PSend() {
  if (!state.p2pEnabled) {
    showToast('Direct transfer is disabled on this server.');
    return;
  }

  const file = state.file;
  if (!file) {
    showToast('Select a file first.');
    return;
  }

  await ensurePeerJsLoaded();

  let code = generateP2PCode();

  const buildPeer = (id) => {
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';

    const opts = {
      host: location.hostname,
      path: state.peerjsPath,
      secure: isSecure,
      config: { iceServers: state.iceServers },
      debug: 0,
    };

    // Only set port if explicitly present (helps behind reverse proxies)
    if (location.port) opts.port = Number(location.port);

    return new window.Peer(id, opts);
  };

  const openWait = (id) => {
    showPanels('p2pwait');
    els.p2pCode.textContent = id;
    const link = `${location.origin}/p2p/${encodeURIComponent(id)}`;
    els.p2pLink.value = link;
  };

  const tryCreate = async () => {
    return new Promise((resolve, reject) => {
      const peer = buildPeer(code);

      peer.on('open', () => resolve(peer));
      peer.on('error', (e) => {
        try { peer.destroy(); } catch {}
        reject(e);
      });
    });
  };

  let peer;
  for (let attempt = 0; attempt < 4; attempt++) {
    openWait(code);
    try {
      peer = await tryCreate();
      break;
    } catch (e) {
      // ID may be in use
      code = generateP2PCode();
      if (attempt === 3) throw e;
    }
  }

  state.p2pPeer = peer;

  els.copyP2PLink.onclick = () => copyToClipboard(els.p2pLink.value).then(() => showToast('Copied link.'));
  els.openP2PLink.onclick = () => window.open(els.p2pLink.value, '_blank', 'noopener');
  els.cancelP2P.onclick = () => {
    stopP2P();
    resetToMain();
  };

  peer.on('connection', (conn) => {
    state.p2pConn = conn;

    // Switch to progress view
    showProgress({ title: 'Sending…', sub: 'Connected. Starting transfer…', percent: 0, doneBytes: 0, totalBytes: file.size, icon: '⇄' });

    conn.on('open', async () => {
      try {
        conn.send({ t: 'meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });

        const chunkSize = 256 * 1024;
        let sent = 0;
        const total = file.size;

        // Send chunks with basic backpressure
        for (let offset = 0; offset < total; offset += chunkSize) {
          const slice = file.slice(offset, offset + chunkSize);
          const buf = await slice.arrayBuffer();
          conn.send(buf);
          sent += buf.byteLength;

          const dc = conn?._dc;
          while (dc && dc.bufferedAmount > 8 * 1024 * 1024) {
            await new Promise(r => setTimeout(r, 40));
          }

          const percent = total ? (sent / total) * 100 : 0;
          showProgress({ title: 'Sending…', sub: 'Transferring…', percent, doneBytes: sent, totalBytes: total, icon: '⇄' });
        }

        conn.send({ t: 'end' });
        showProgress({ title: 'Sending…', sub: 'Done!', percent: 100, doneBytes: total, totalBytes: total, icon: '⇄' });

        // Small delay so receiver finishes
        setTimeout(() => {
          try { conn.close(); } catch {}
          try { peer.destroy(); } catch {}
          resetToMain();
          showToast('Transfer complete.');
        }, 800);
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'Transfer failed.');
        try { conn.close(); } catch {}
        try { peer.destroy(); } catch {}
        resetToMain();
      }
    });

    conn.on('error', (e) => {
      console.error(e);
      showToast('Connection error.');
      resetToMain();
    });
  });
}

function wireUI() {
  // File selection
  els.selectFileBtn?.addEventListener('click', () => els.fileInput?.click());
  els.dropzone?.addEventListener('click', (e) => {
    // Don't steal button clicks
    if (e.target?.closest('button')) return;
    els.fileInput?.click();
  });

  els.fileInput?.addEventListener('change', () => {
    const f = els.fileInput.files?.[0];
    if (!f) return;
    state.file = f;
    updateFileUI();
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach((ev) => {
    els.dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
    });
  });
  els.dropzone?.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    state.file = f;
    updateFileUI();
  });

  // Mode toggles
  els.modeStandard?.addEventListener('click', () => {
    if (els.modeStandard.hasAttribute('disabled')) return;
    setMode('standard');
  });
  els.modeP2P?.addEventListener('click', () => {
    if (els.modeP2P.hasAttribute('disabled')) return;
    setMode('p2p');
  });

  // Encryption
  els.encYes?.addEventListener('click', () => {
    if (!(state.uploadEnabled && state.e2ee && (window.isSecureContext || location.hostname === 'localhost'))) {
      showToast('Encryption requires HTTPS and server support.');
      return;
    }
    state.encrypt = true;
    setSelected(els.encYes, els.encNo, true);
  });
  els.encNo?.addEventListener('click', () => {
    state.encrypt = false;
    setSelected(els.encYes, els.encNo, false);
  });

  // Lifetime input - clamp to max
  const onLifetimeChange = () => {
    if (!state.uploadEnabled) return;
    const ms = lifetimeMsFromUI();
    const clamped = clampLifetimeMs(ms);
    if (ms !== clamped && state.maxLifetimeHours > 0) {
      // Snap UI to max
      const maxH = state.maxLifetimeHours;
      if (els.lifetimeUnit.value === 'days') {
        const maxDays = Math.floor(maxH / 24);
        if (maxDays >= 1) {
          els.lifetimeValue.value = String(maxDays);
        } else {
          els.lifetimeUnit.value = 'hours';
          els.lifetimeValue.value = String(Math.max(1, Math.floor(maxH)));
        }
      } else {
        els.lifetimeValue.value = String(Math.max(1, Math.floor(maxH)));
      }
      showToast('Lifetime capped by server limit.');
    }
  };
  els.lifetimeValue?.addEventListener('change', onLifetimeChange);
  els.lifetimeUnit?.addEventListener('change', onLifetimeChange);

  // Help
  els.helpMode?.addEventListener('click', () => {
    showToast('Standard uploads store the file on the server. Direct transfer sends the file peer-to-peer (server only brokers the connection).');
  });
  els.helpEnc?.addEventListener('click', () => {
    showToast('Encryption uses a key stored in the URL fragment (#...). The server never sees the decrypted file.');
  });

  // Start
  els.startBtn?.addEventListener('click', async () => {
    try {
      if (state.mode === 'standard') await startStandardUpload();
      else await startP2PSend();
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Something went wrong.');
      resetToMain();
    }
  });

  // Share actions
  els.copyShare?.addEventListener('click', () => copyToClipboard(els.shareLink.value).then(() => showToast('Copied link.')));
  els.openShare?.addEventListener('click', () => window.open(els.shareLink.value, '_blank', 'noopener'));
  els.newUpload?.addEventListener('click', resetToMain);

  // Enter code
  const goWithCode = () => {
    const value = normalizeCode(els.codeInput.value);
    if (!value) return;
    if (/^https?:\/\//i.test(value)) return (window.location.href = value);
    if (isUuidLike(value)) return (window.location.href = `/${value}`);
    if (isP2PCodeLike(value)) return (window.location.href = `/p2p/${encodeURIComponent(value)}`);
    // fallback: try P2P
    window.location.href = `/p2p/${encodeURIComponent(value)}`;
  };

  els.codeGo?.addEventListener('click', goWithCode);
  els.codeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goWithCode();
  });

  // Reset on ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resetToMain();
  });
}

async function init() {
  wireUI();

  try {
    await loadServerInfo();
  } catch (err) {
    console.error(err);
    els.maxUploadHint.textContent = 'Could not load server info.';
    showToast('Could not load server info.');
  }

  // Defaults
  setMode('standard');
  setSelected(els.encYes, els.encNo, true);
  state.encrypt = true;

  // If standard is disabled, updateCapabilitiesUI will force P2P mode.
  updateCapabilitiesUI();
}

init();

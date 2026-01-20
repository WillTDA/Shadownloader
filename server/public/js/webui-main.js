import {
  DEFAULT_CHUNK_SIZE,
  DropgateClient,
  estimateTotalUploadSizeBytes,
  isSecureContextForP2P,
  lifetimeToMs,
  startP2PSend,
} from './dropgate-core.js';

const $ = (id) => document.getElementById(id);

const els = {
  tagline: $('tagline'),
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
  codeCard: $('codeCard'),

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
  qrP2PLink: $('qrP2PLink'),
  cancelP2P: $('cancelP2P'),

  shareCard: $('shareCard'),
  shareTitle: $('shareTitle'),
  shareSub: $('shareSub'),
  shareLinkGroup: $('shareLinkGroup'),
  shareLink: $('shareLink'),
  copyShare: $('copyShare'),
  qrShare: $('qrShare'),
  newUpload: $('newUpload'),

  qrModal: $('qrModal'),
  qrCanvas: $('qrCanvas'),

  codeInput: $('codeInput'),
  codeGo: $('codeGo'),
  statusAlert: $('statusAlert'),

  toast: $('toast'),
};

const state = {
  info: null,
  file: null,
  fileTooLargeForStandard: false,
  mode: 'standard',
  encrypt: true,
  uploadEnabled: false,
  p2pEnabled: false,
  maxSizeMB: null,
  maxLifetimeHours: null,
  e2ee: false,
  peerjsPath: '/peerjs',
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  p2pSession: null,
  p2pSecureOk: true,
};

const coreClient = new DropgateClient({ clientVersion: '0.0.0' });

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
}

function showToast(text, type = 'info', timeoutMs = 4500) {
  const el = els.statusAlert;
  if (!el) { alert(text); return; }
  el.textContent = String(text || '');
  // Map type to Bootstrap alert class and add custom toast styling
  let alertType = 'info';
  if (type === 'warning') alertType = 'warning';
  else if (type === 'error' || type === 'danger') alertType = 'danger';
  else if (type === 'success') alertType = 'success';
  else alertType = 'info';
  el.className = `alert alert-${alertType} shadow-sm toast-notification toast-${alertType}`;
  el.hidden = false;
  if (timeoutMs > 0) {
    const snap = el.textContent;
    setTimeout(() => {
      if (el.textContent === snap) el.hidden = true;
    }, timeoutMs);
  }
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function setDisabled(el, disabled) {
  if (!el) return;
  if (disabled) {
    el.setAttribute('disabled', '');
    el.classList.add('disabled');
  } else {
    el.removeAttribute('disabled');
    el.classList.remove('disabled');
  }
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

function showPanels(which) {
  // which: 'main' | 'progress' | 'p2pwait' | 'share'
  setHidden(els.panels, which !== 'main');
  setHidden(els.progressCard, which !== 'progress');
  setHidden(els.p2pWaitCard, which !== 'p2pwait');
  setHidden(els.shareCard, which !== 'share');
  // Hide code card when not in main view
  setHidden(els.codeCard, which !== 'main');
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

function isFileTooLargeForStandard(file) {
  if (!file || !state.uploadEnabled) return false;
  const maxBytes = Number.isFinite(state.maxSizeMB) && state.maxSizeMB > 0
    ? state.maxSizeMB * 1000 * 1000
    : null;
  if (!maxBytes) return false;
  const totalChunks = Math.ceil(file.size / DEFAULT_CHUNK_SIZE);
  const estimatedBytes = estimateTotalUploadSizeBytes(file.size, totalChunks, Boolean(state.encrypt));
  return estimatedBytes > maxBytes;
}

function updateStartEnabled() {
  const hasFile = Boolean(state.file);
  if (state.mode === 'standard') {
    const lifetimeOk = validateLifetimeInput();
    const canUpload = state.uploadEnabled && !state.fileTooLargeForStandard && lifetimeOk;
    setDisabled(els.startBtn, !(hasFile && canUpload));
  } else {
    const canP2P = state.p2pEnabled && state.p2pSecureOk;
    setDisabled(els.startBtn, !(hasFile && canP2P));
  }
}

function handleFileSelection(file) {
  state.file = file || null;
  updateFileUI();

  state.fileTooLargeForStandard = false;
  if (state.file && state.mode === 'standard' && isFileTooLargeForStandard(state.file)) {
    state.fileTooLargeForStandard = true;
    if (state.p2pEnabled && state.p2pSecureOk) {
      setMode('p2p');
      showToast('File exceeds the server upload limit — using direct transfer.');
    } else {
      showToast('File exceeds the server upload limit and cannot be uploaded.');
    }
  }

  updateStartEnabled();
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

  state.fileTooLargeForStandard = Boolean(state.file && isFileTooLargeForStandard(state.file));
  if (state.fileTooLargeForStandard && isStandard) {
    if (state.p2pEnabled && state.p2pSecureOk) {
      showToast('File exceeds the server upload limit — using direct transfer.');
      state.fileTooLargeForStandard = false;
      setMode('p2p');
      return;
    }
    showToast('File exceeds the server upload limit and cannot be uploaded.');
  }

  updateStartEnabled();
}

function updateCapabilitiesUI() {
  state.p2pSecureOk = isSecureContextForP2P();

  // Upload
  if (state.uploadEnabled) {
    const maxText = (state.maxSizeMB === 0)
      ? 'You can upload files of any size.'
      : `Max upload size: ${formatBytes(state.maxSizeMB * 1000 * 1000)}.`;

    const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
    els.maxUploadHint.textContent = p2pAvailable && state.maxSizeMB > 0
      ? `${maxText} Anything over will use direct transfer (P2P).`
      : maxText;
  } else {
    const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
    els.maxUploadHint.textContent = p2pAvailable
      ? 'Standard uploads are disabled on this server. Direct transfer (P2P) is available.'
      : 'Uploads are disabled on this server.';
  }

  // Lifetime
  if (state.uploadEnabled) {
    const unlimitedOption = els.lifetimeUnit?.querySelector('option[value="unlimited"]');
    if (state.maxLifetimeHours > 0) {
      if (unlimitedOption) {
        unlimitedOption.disabled = true;
        unlimitedOption.textContent = 'Unlimited (Disabled by Server)';
      }
    } else if (unlimitedOption) {
      unlimitedOption.disabled = false;
      unlimitedOption.textContent = 'Unlimited';
    }
  }

  // Encryption
  const canEncrypt = state.uploadEnabled && state.e2ee && window.isSecureContext;
  const encMessage = $('encryptionMessage');
  if (encMessage) {
    if (state.uploadEnabled && state.e2ee && !window.isSecureContext) {
      encMessage.textContent = 'Encryption requires HTTPS.';
      encMessage.className = 'encryption-message text-warning';
    } else if (state.uploadEnabled && !state.e2ee) {
      encMessage.textContent = 'End-to-End Encryption is not supported on this server.';
      encMessage.className = 'encryption-message text-body-secondary';
    } else if (canEncrypt) {
      encMessage.textContent = 'End-to-End Encryption is available.';
      encMessage.className = 'encryption-message text-success';
    } else if (!state.uploadEnabled) {
      encMessage.textContent = '';
      encMessage.className = 'encryption-message';
    }
  }
  if (!canEncrypt) {
    state.encrypt = false;
    setSelected(els.encYes, els.encNo, false);
    setDisabled(els.encYes, true);
  } else {
    setDisabled(els.encYes, false);
  }

  // Mode toggle availability
  const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
  setDisabled(els.modeP2P, !p2pAvailable);

  if (!state.uploadEnabled) {
    setDisabled(els.modeStandard, true);
    if (p2pAvailable) setMode('p2p');
  } else {
    setDisabled(els.modeStandard, false);
  }

  setDisabled(els.lifetimeValue, !state.uploadEnabled || els.lifetimeUnit.value === 'unlimited');
  setDisabled(els.lifetimeUnit, !state.uploadEnabled);

  validateLifetimeInput();
}

function applyLifetimeDefaults() {
  if (!state.uploadEnabled) return;
  const maxH = state.maxLifetimeHours;
  const safeValue = Number.isFinite(maxH) && maxH > 0
    ? Math.max(0.5, Math.min(24, maxH))
    : 24;
  els.lifetimeUnit.value = 'hours';
  els.lifetimeValue.value = String(safeValue);
  setDisabled(els.lifetimeValue, els.lifetimeUnit.value === 'unlimited');
  validateLifetimeInput();
}

async function loadServerInfo() {
  const { serverInfo: info } = await coreClient.getServerInfo(location.origin, { timeoutMs: 5000 });
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
  applyLifetimeDefaults();
  updateStartEnabled();
}

function lifetimeMsFromUI() {
  const unit = els.lifetimeUnit.value;
  if (unit === 'unlimited') return 0;
  const value = parseFloat(els.lifetimeValue.value);
  return lifetimeToMs(value, unit);
}

function validateLifetimeInput() {
  if (!state.uploadEnabled) return true;
  const maxH = state.maxLifetimeHours;
  const unit = els.lifetimeUnit.value;

  if (maxH === 0 && unit === 'unlimited') {
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server (0 = unlimited).';
    els.lifetimeHelp.className = 'form-text text-body-secondary';
    return true;
  }

  if (maxH > 0 && unit === 'unlimited') {
    const maxHours = Math.max(1, Math.floor(maxH));
    els.lifetimeUnit.value = 'hours';
    els.lifetimeValue.disabled = false;
    els.lifetimeValue.value = String(Math.min(24, maxHours));
  }

  const ms = lifetimeMsFromUI();
  const maxMs = Number.isFinite(maxH) && maxH > 0 ? maxH * 60 * 60 * 1000 : null;
  if (maxMs && ms > maxMs) {
    els.lifetimeHelp.textContent = `File lifetime too long. Server limit: ${maxH} hours.`;
    els.lifetimeHelp.className = 'form-text text-danger';
    return false;
  }

  if (maxH === 0) {
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server (0 = unlimited).';
  } else if (maxH > 0) {
    els.lifetimeHelp.textContent = `Max lifetime: ${maxH} hours.`;
  }
  els.lifetimeHelp.className = 'form-text text-body-secondary';
  return true;
}

function showProgress({ title, sub, percent, doneBytes, totalBytes, icon, iconColor }) {
  showPanels('progress');
  if (icon != null) {
    // icon can be a Material icon name or fallback emoji
    if (typeof icon === 'string' && icon.match(/^[a-z_]+$/)) {
      const colorClass = iconColor ? ` ${iconColor}` : ' text-primary';
      els.progressIcon.innerHTML = `<span class="material-icons-round${colorClass}">${icon}</span>`;
      els.progressIcon.className = `mb-2${colorClass}`;
    } else {
      els.progressIcon.textContent = icon;
    }
  }

  els.shareCard.classList.remove('border-danger', 'border-success', 'border-primary');
  els.shareCard.classList.add('border', iconColor ? iconColor.replace('text-', 'border-') : 'border-primary');

  if (title) els.progressTitle.textContent = title;
  if (sub) els.progressSub.textContent = sub;
  if (typeof percent === 'number') els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (Number.isFinite(doneBytes) && Number.isFinite(totalBytes)) {
    els.progressBytes.textContent = `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`;
  }
}

function showShare({ link = '', title = 'Upload Complete', sub = 'Share this link with your recipient:', showLinkGroup = true } = {}) {
  showPanels('share');
  if (els.shareTitle) els.shareTitle.textContent = title;
  if (els.shareSub) els.shareSub.textContent = sub;
  if (els.shareLinkGroup) setHidden(els.shareLinkGroup, !showLinkGroup);
  els.shareCard.classList.remove('border-danger', 'border-success', 'border-primary');
  els.shareCard.classList.add('border', 'border-success');
  els.shareLink.value = link || '';
  // Hide code entry when upload complete
  if (els.codeCard) setHidden(els.codeCard, true);
}

function resetToMain() {
  state.file = null;
  state.fileTooLargeForStandard = false;
  updateFileUI();
  els.tagline.textContent = 'Send a file securely, or enter a sharing code to receive one.';
  showPanels('main');
  els.shareLink.value = '';
  els.p2pLink.value = '';
  els.progressFill.style.width = '0%';
  els.progressBytes.textContent = '0 / 0';
  stopP2P();
  updateStartEnabled();
}

function stopP2P() {
  try { state.p2pSession?.stop(); } catch { }
  state.p2pSession = null;
}

function showQRModal(url) {
  if (!els.qrModal || !els.qrCanvas) return;

  const QRCodeStylingCtor = globalThis.QRCodeStyling;
  if (!QRCodeStylingCtor) {
    showToast?.('QR generator not loaded.', 'warning');
    return;
  }

  // render at a max size; CSS scales it responsively
  const baseSize = 320;

  const qrCode = new QRCodeStylingCtor({
    width: baseSize,
    height: baseSize,
    type: 'svg',
    data: url,
    dotsOptions: { color: '#222222', type: 'rounded' },
  });

  els.qrCanvas.innerHTML = '';
  qrCode.append(els.qrCanvas);

  const modalEl = document.getElementById('qrModal');
  const modal = new window.bootstrap.Modal(modalEl);
  modal.show();
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

  els.tagline.textContent = 'Standard Upload';
  const encrypt = Boolean(state.encrypt);
  const maxBytes = Number.isFinite(state.maxSizeMB) && state.maxSizeMB > 0
    ? state.maxSizeMB * 1000 * 1000
    : null;
  if (maxBytes) {
    const totalChunks = Math.ceil(file.size / DEFAULT_CHUNK_SIZE);
    const estimatedBytes = estimateTotalUploadSizeBytes(file.size, totalChunks, encrypt);
    if (estimatedBytes > maxBytes) {
      if (state.p2pEnabled && state.p2pSecureOk) {
        setMode('p2p');
        showToast('File exceeds the server upload limit — using direct transfer.');
        return startP2PSendFlow();
      }
      showToast('File exceeds the server upload limit and cannot be uploaded.');
      return;
    }
  }

  if (!validateLifetimeInput()) {
    showToast('File lifetime exceeds server limits.');
    return;
  }

  const client = new DropgateClient({ clientVersion: state.info?.version || '0.0.0' });

  const lifetimeMs = lifetimeMsFromUI();

  showProgress({ title: 'Uploading', sub: 'Preparing...', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'cloud_upload', iconColor: 'text-primary' });

  try {
    const result = await client.uploadFile({
      serverUrl: location.origin,
      file,
      encrypt,
      lifetimeMs,
      onProgress: ({ phase, text, percent }) => {
        const p = (typeof percent === 'number') ? percent : 0;
        showProgress({
          title: 'Uploading',
          sub: text || phase,
          percent: p,
          doneBytes: Math.floor((p / 100) * file.size),
          totalBytes: file.size,
          icon: 'cloud_upload',
          iconColor: 'text-primary',
        });
      },
    });

    showProgress({ title: 'Uploading', sub: 'Upload successful!', percent: 100, doneBytes: file.size, totalBytes: file.size, icon: 'cloud_upload' });
    showShare({ link: result.downloadUrl });
  } catch (err) {
    console.error(err);
    showProgress({ title: 'Upload Failed', sub: err?.message || 'An error occurred during upload.', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'error', iconColor: 'text-danger' });
    els.progressCard?.classList.remove('border-primary');
    els.progressCard?.classList.add('border', 'border-danger');
    showToast(err?.message || 'Upload failed.');
  }
}

async function startP2PSendFlow() {
  if (!state.p2pEnabled) {
    showToast('Direct transfer is disabled on this server.');
    return;
  }
  if (!state.p2pSecureOk) {
    showToast('Direct transfer requires HTTPS (or localhost).');
    return;
  }

  const file = state.file;
  if (!file) {
    showToast('Select a file first.');
    return;
  }

  els.tagline.textContent = 'Direct Transfer (P2P)';
  state.p2pSession = await startP2PSend({
    file,
    serverInfo: state.info,
    peerjsPath: state.peerjsPath,
    iceServers: state.iceServers,
    onCode: (id) => {
      showPanels('p2pwait');
      els.p2pCode.textContent = id;
      const link = `${location.origin}/p2p/${encodeURIComponent(id)}`;
      els.p2pLink.value = link;
    },
    onStatus: ({ message }) => {
      showProgress({ title: 'Sending...', sub: message, percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'sync_alt', iconColor: 'text-primary' });
    },
    onProgress: ({ sent, total, percent }) => {
      showProgress({ title: 'Sending...', sub: 'Keep this tab open until the transfer completes.', percent, doneBytes: sent, totalBytes: total, icon: 'sync_alt', iconColor: 'text-primary' });
    },
    onComplete: () => {
      stopP2P();
      showShare({
        title: 'Transfer Complete',
        sub: 'Your recipient has received the file.',
        showLinkGroup: false,
      });
    },
    onError: (err) => {
      console.error(err);
      showProgress({ title: 'Transfer Failed', sub: 'An error occurred during transfer.', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'error', iconColor: 'text-danger' });
      els.p2pWaitCard?.classList.remove('border-primary');
      els.p2pWaitCard?.classList.add('border', 'border-danger');
      stopP2P();
    },
  });

  els.copyP2PLink.onclick = () => copyToClipboard(els.p2pLink.value).then(() => showToast('Copied link.'));
  els.qrP2PLink.onclick = () => showQRModal(els.p2pLink.value);
  els.cancelP2P.onclick = () => {
    stopP2P();
    resetToMain();
  };
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
    handleFileSelection(f);
    // Reset the input so the same file can be selected again
    els.fileInput.value = '';
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
    handleFileSelection(f);
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
    if (!(state.uploadEnabled && state.e2ee && window.isSecureContext)) {
      showToast('Encryption requires HTTPS and server support.');
      return;
    }
    state.encrypt = true;
    setSelected(els.encYes, els.encNo, true);
    if (state.file) handleFileSelection(state.file);
  });
  els.encNo?.addEventListener('click', () => {
    state.encrypt = false;
    setSelected(els.encYes, els.encNo, false);
    if (state.file) handleFileSelection(state.file);
  });

  // Lifetime input - mirror Electron behavior
  const normaliseLifetimeValue = () => {
    if (els.lifetimeUnit.value === 'unlimited') {
      els.lifetimeValue.value = '0';
      setDisabled(els.lifetimeValue, true);
      return;
    }

    setDisabled(els.lifetimeValue, false);
    const value = parseFloat(els.lifetimeValue.value);
    if (Number.isNaN(value) || value <= 0) {
      els.lifetimeValue.value = '0.5';
    }
  };

  els.lifetimeValue?.addEventListener('blur', () => {
    if (!state.uploadEnabled) return;
    normaliseLifetimeValue();
    validateLifetimeInput();
    updateStartEnabled();
  });

  els.lifetimeUnit?.addEventListener('change', () => {
    if (!state.uploadEnabled) return;
    normaliseLifetimeValue();
    validateLifetimeInput();
    updateStartEnabled();
  });

  // Help buttons are integrated into the existing help buttons in HTML
  // They send tooltips that are handled by the tooltip functionality

  // Start
  els.startBtn?.addEventListener('click', async () => {
    try {
      if (state.mode === 'standard') await startStandardUpload();
      else await startP2PSendFlow();
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Something went wrong.');
      resetToMain();
    }
  });

  // Share actions
  els.copyShare?.addEventListener('click', () => copyToClipboard(els.shareLink.value).then(() => showToast('Copied link.')));
  els.qrShare?.addEventListener('click', () => showQRModal(els.shareLink.value));
  els.newUpload?.addEventListener('click', resetToMain);

  // Enter code
  const goWithCode = async () => {
    const value = normalizeCode(els.codeInput.value);
    if (!value) return;

    setDisabled(els.codeGo, true);
    try {
      const result = await coreClient.resolveShareTarget(location.origin, value);
      if (!result?.valid || !result?.target) {
        showToast(result?.reason || 'That sharing code could not be validated.', 'warning');
        return;
      }
      window.location.href = result.target;
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Failed to validate sharing code.', 'warning');
    } finally {
      setDisabled(els.codeGo, false);
    }
  };

  els.codeGo?.addEventListener('click', () => {
    void goWithCode();
  });
  els.codeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void goWithCode();
  });
  els.codeInput?.addEventListener('input', () => {
    const hasValue = els.codeInput.value.trim().length > 0;
    setDisabled(els.codeGo, !hasValue);
  });
  // Initial state
  setDisabled(els.codeGo, true);

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
  updateStartEnabled();

  if (state.p2pEnabled && !state.p2pSecureOk) {
    showToast('Direct transfer requires HTTPS (or localhost).', 'warning');
  }
}

init();

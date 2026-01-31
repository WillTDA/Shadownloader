import {
  DEFAULT_CHUNK_SIZE,
  DropgateClient,
  estimateTotalUploadSizeBytes,
  isSecureContextForP2P,
  lifetimeToMs,
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

  optMaxDownloads: $('optMaxDownloads'),
  maxDownloadsValue: $('maxDownloadsValue'),
  maxDownloadsHelp: $('maxDownloadsHelp'),

  securityStatus: $('securityStatus'),
  securityIcon: $('securityIcon'),
  securityText: $('securityText'),
  insecureUploadModal: $('insecureUploadModal'),
  insecureModalBody: $('insecureModalBody'),
  confirmInsecureUpload: $('confirmInsecureUpload'),

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
  cancelStandardUpload: $('cancelStandardUpload'),
  cancelP2PSend: $('cancelP2PSend'),

  p2pWaitCard: $('p2pWaitCard'),
  p2pCode: $('p2pCode'),
  p2pLinkLabel: $('p2pLinkLabel'),
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
  maxFileDownloads: 1,
  e2ee: false,
  peerjsPath: '/peerjs',
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  p2pSession: null,
  p2pSecureOk: true,
  uploadSession: null,
};

// Title progress tracking
const originalTitle = document.title;
let currentTransferProgress = null; // { percent, doneBytes, totalBytes }

const updateTitleProgress = (percent) => {
  if (percent >= 0 && percent < 100) {
    document.title = `${Math.floor(percent)}% - ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
};

const resetTitleProgress = () => {
  document.title = originalTitle;
  currentTransferProgress = null;
};

// Visibility change handler - sync UI immediately when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentTransferProgress) {
    // Tab became visible and we have an active transfer
    // Force UI update with current progress
    const { percent, doneBytes, totalBytes, showProgress: showProgressFn } = currentTransferProgress;
    if (showProgressFn) {
      showProgressFn(percent, doneBytes, totalBytes);
    }
  }
});

const coreClient = new DropgateClient({ clientVersion: '3.0.0', server: location.origin });

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
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
    const maxDownloadsOk = validateMaxDownloadsInput();
    const canUpload = state.uploadEnabled && !state.fileTooLargeForStandard && lifetimeOk && maxDownloadsOk;
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
      showToast('File exceeds the server upload limit and cannot be uploaded.', 'danger');
    }
  }

  updateStartEnabled();
}

function setMode(mode) {
  state.mode = mode;
  const isStandard = mode === 'standard';

  setSelected(els.modeStandard, els.modeP2P, isStandard);

  // Options shown in Standard mode only
  setHidden(els.optLifetime, !isStandard);
  setHidden(els.optMaxDownloads, !isStandard || !state.uploadEnabled);
  updateSecurityStatus();
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
    showToast('File exceeds the server upload limit and cannot be uploaded.', 'danger');
  }

  updateStartEnabled();
}

/**
 * Update the security status card based on E2EE and HTTPS availability.
 */
function updateSecurityStatus() {
  const icon = els.securityIcon;
  const text = els.securityText;
  const card = els.securityStatus;

  if (!icon || !text || !card) return;

  // Hide if uploads are disabled or in P2P mode
  if (!state.uploadEnabled || state.mode === 'p2p') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'flex'; // Ensure it's visible otherwise

  const isHttps = location.protocol === 'https:';
  const hasE2EE = state.uploadEnabled && state.e2ee && window.isSecureContext;

  if (hasE2EE) {
    // Green: Full E2EE
    icon.textContent = 'verified';
    icon.className = 'material-icons-round text-success';
    text.textContent = 'Your upload will be end-to-end encrypted.';
    card.className = 'security-status-card security-green mb-3';
  } else if (isHttps) {
    // Yellow: HTTPS but no E2EE
    icon.textContent = 'warning';
    icon.className = 'material-icons-round text-warning';
    text.textContent = "This server doesn't support encryption. Your upload is protected in transit via HTTPS.";
    card.className = 'security-status-card security-yellow mb-3';
  } else {
    // Red: HTTP, no encryption at all
    icon.textContent = 'gpp_bad';
    icon.className = 'material-icons-round text-danger';
    text.textContent = 'This connection is not secure. Your upload will not be encrypted.';
    card.className = 'security-status-card security-red mb-3';
  }
}

/**
 * Show the insecure upload warning modal and return a promise.
 * @returns {Promise<boolean>} True if user confirms, false if cancelled.
 */
function showInsecureUploadModal() {
  return new Promise((resolve) => {
    const modalEl = els.insecureUploadModal;
    if (!modalEl) {
      resolve(true); // If modal doesn't exist, proceed anyway
      return;
    }

    const modal = new window.bootstrap.Modal(modalEl);

    const cleanup = () => {
      els.confirmInsecureUpload?.removeEventListener('click', onConfirm);
      modalEl.removeEventListener('hidden.bs.modal', onHide);
    };

    const onConfirm = () => {
      cleanup();
      modal.hide();
      resolve(true);
    };

    const onHide = () => {
      cleanup();
      resolve(false);
    };

    els.confirmInsecureUpload?.addEventListener('click', onConfirm, { once: true });
    modalEl.addEventListener('hidden.bs.modal', onHide, { once: true });

    modal.show();
  });
}

function updateCapabilitiesUI() {
  state.p2pSecureOk = isSecureContextForP2P(location.hostname, window.isSecureContext);

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

  // Security status (auto-enable encryption based on server capabilities)
  const canEncrypt = state.uploadEnabled && state.e2ee && window.isSecureContext;
  state.encrypt = canEncrypt; // Auto-set encryption based on capability
  updateSecurityStatus();

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

  // Max Downloads UI (only for standard uploads, not P2P)
  if (state.uploadEnabled && state.mode === 'standard') {
    if (state.maxFileDownloads === 1) {
      // Server forces single-download: disable input, show message
      setDisabled(els.maxDownloadsValue, true);
      els.maxDownloadsValue.value = '1';
      els.maxDownloadsValue.min = '1';
      els.maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
      setHidden(els.optMaxDownloads, false);
    } else if (state.maxFileDownloads === 0) {
      // Server allows unlimited
      setDisabled(els.maxDownloadsValue, false);
      els.maxDownloadsValue.min = '0';
      els.maxDownloadsHelp.textContent = '0 = unlimited downloads';
      setHidden(els.optMaxDownloads, false);
    } else {
      // Server has a limit > 1 (0 is not allowed)
      setDisabled(els.maxDownloadsValue, false);
      els.maxDownloadsValue.min = '1';
      els.maxDownloadsHelp.textContent = `Max: ${state.maxFileDownloads} downloads`;
      setHidden(els.optMaxDownloads, false);
    }
  } else {
    setHidden(els.optMaxDownloads, true);
  }

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
  const { serverInfo: info } = await coreClient.connect({ timeoutMs: 5000 });
  state.info = info;

  const upload = info?.capabilities?.upload;
  state.uploadEnabled = Boolean(upload?.enabled);
  state.maxSizeMB = state.uploadEnabled ? (upload?.maxSizeMB ?? null) : null;
  state.maxLifetimeHours = state.uploadEnabled ? (upload?.maxLifetimeHours ?? null) : null;
  state.maxFileDownloads = state.uploadEnabled ? (upload?.maxFileDownloads ?? 1) : 1;
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
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
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
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
  } else if (maxH > 0) {
    els.lifetimeHelp.textContent = `Max lifetime: ${maxH} hours.`;
  }
  els.lifetimeHelp.className = 'form-text text-body-secondary';
  return true;
}

function validateMaxDownloadsInput() {
  if (!state.uploadEnabled || state.mode !== 'standard') return true;

  const max = state.maxFileDownloads;
  const value = parseInt(els.maxDownloadsValue.value, 10);

  // Handle invalid input
  if (isNaN(value) || value < 0) {
    els.maxDownloadsHelp.textContent = 'Must be a non-negative number.';
    els.maxDownloadsHelp.className = 'form-text text-danger';
    return false;
  }

  // Server allows unlimited (0) - any value is valid
  if (max === 0) {
    els.maxDownloadsHelp.textContent = '0 = unlimited downloads';
    els.maxDownloadsHelp.className = 'form-text text-body-secondary';
    return true;
  }

  // Server has limit of 1 - input should be disabled anyway
  if (max === 1) {
    els.maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
    els.maxDownloadsHelp.className = 'form-text text-body-secondary';
    return true;
  }

  // Server has limit > 1
  if (value === 0) {
    els.maxDownloadsHelp.textContent = `0 (unlimited) not allowed. Server limit: ${max} downloads.`;
    els.maxDownloadsHelp.className = 'form-text text-danger';
    return false;
  }

  if (value > max) {
    els.maxDownloadsHelp.textContent = `Exceeds server limit of ${max} downloads.`;
    els.maxDownloadsHelp.className = 'form-text text-danger';
    return false;
  }

  els.maxDownloadsHelp.textContent = `Max: ${max} downloads`;
  els.maxDownloadsHelp.className = 'form-text text-body-secondary';
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

  // Update progress card border color based on iconColor
  els.progressCard.classList.remove('border-danger', 'border-success', 'border-primary', 'border-warning');
  els.progressCard.classList.add('border', iconColor ? iconColor.replace('text-', 'border-') : 'border-primary');

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
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(value).catch(() => {
      // fallback
      copyToClipboardFallback(value);
    });
  }
  // navigator.clipboard unavailable (insecure context)
  copyToClipboardFallback(value);
  return Promise.resolve();
}

function copyToClipboardFallback(value) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

async function startStandardUpload() {
  if (!state.uploadEnabled) {
    showToast('Standard uploads are disabled on this server.', 'warning');
    return;
  }

  const file = state.file;
  if (!file) {
    showToast('Select a file first.', 'warning');
    return;
  }

  // Check if E2EE is available - show warning if not
  const hasE2EE = state.uploadEnabled && state.e2ee && window.isSecureContext;
  if (!hasE2EE) {
    const confirmed = await showInsecureUploadModal();
    if (!confirmed) return;
  }

  const encrypt = hasE2EE; // Auto-set encryption based on capability
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
      showToast('File exceeds the server upload limit and cannot be uploaded.', 'danger');
      return;
    }
  }

  if (!validateLifetimeInput()) {
    showToast('File lifetime exceeds server limits.', 'danger');
    return;
  }

  const lifetimeMs = lifetimeMsFromUI();
  els.tagline.textContent = 'Standard Upload';

  showProgress({ title: 'Uploading', sub: 'Preparing...', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'cloud_upload', iconColor: 'text-primary' });

  try {
    const session = await coreClient.uploadFile({
      file,
      encrypt,
      lifetimeMs,
      maxDownloads: (() => {
        const val = parseInt(els.maxDownloadsValue.value, 10);
        return (Number.isInteger(val) && val >= 0) ? val : 1;
      })(),
      onProgress: ({ phase, text, percent }) => {
        const p = (typeof percent === 'number') ? percent : 0;

        // Update title and store progress for visibility handler
        updateTitleProgress(p);
        currentTransferProgress = {
          percent: p,
          doneBytes: Math.floor((p / 100) * file.size),
          totalBytes: file.size,
          showProgress: (pct, done, total) => {
            showProgress({
              title: 'Uploading',
              sub: text || phase,
              percent: pct,
              doneBytes: done,
              totalBytes: total,
              icon: 'cloud_upload',
              iconColor: 'text-primary',
            });
          }
        };

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
      onCancel: () => {
        resetTitleProgress();
        showToast('Upload cancelled.', 'warning');
        resetToMain();
      },
    });

    // Store session and show cancel button
    state.uploadSession = session;
    els.cancelStandardUpload.style.display = 'inline-block';

    // Wire up cancel button
    els.cancelStandardUpload.onclick = () => {
      resetTitleProgress();
      session.cancel('User cancelled upload.');
      state.uploadSession = null;
      els.cancelStandardUpload.style.display = 'none';
    };

    const result = await session.result;

    // Hide cancel button on success
    els.cancelStandardUpload.style.display = 'none';
    state.uploadSession = null;

    resetTitleProgress();
    showProgress({ title: 'Uploading', sub: 'Upload successful!', percent: 100, doneBytes: file.size, totalBytes: file.size, icon: 'cloud_upload' });
    showShare({ link: result.downloadUrl });
  } catch (err) {
    // Hide cancel button on error
    els.cancelStandardUpload.style.display = 'none';
    state.uploadSession = null;
    resetTitleProgress();

    // Check if it was a cancellation (handle both native AbortError and DropgateAbortError)
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERROR') {
      // Already handled by onCancel
      return;
    }

    console.error(err);
    showProgress({ title: 'Upload Failed', sub: err?.message || 'An error occurred during upload.', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'error', iconColor: 'text-danger' });
    showToast(err?.message || 'Upload failed.', 'danger');
  }
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

async function startP2PSendFlow() {
  if (!state.p2pEnabled) {
    showToast('Direct transfer is disabled on this server.', 'warning');
    return;
  }
  if (!state.p2pSecureOk) {
    showToast('Direct transfer requires HTTPS (or localhost).', 'warning');
    return;
  }

  const file = state.file;
  if (!file) {
    showToast('Select a file first.', 'warning');
    return;
  }

  // Load PeerJS before starting P2P
  let Peer;
  try {
    Peer = await loadPeerJS();
  } catch (err) {
    showToast('Failed to load P2P library.', 'danger');
    console.error(err);
    return;
  }

  els.tagline.textContent = 'Direct Transfer (P2P)';
  state.p2pSession = await coreClient.p2pSend({
    file,
    Peer,
    onCode: (id) => {
      showPanels('p2pwait');
      // Reset visibility of share elements for new session
      setHidden(els.p2pCode, false);
      setHidden(els.p2pLinkLabel, false);
      setHidden(els.p2pLink, false);
      setHidden(els.copyP2PLink, false);
      setHidden(els.qrP2PLink, false);
      // Reset title/subtitle
      const waitTitle = els.p2pWaitCard?.querySelector('h5');
      const waitSub = els.p2pWaitCard?.querySelector('.text-body-secondary');
      if (waitTitle) waitTitle.textContent = 'Awaiting connection...';
      if (waitSub) waitSub.textContent = 'Provide your recipient with the code below:';
      els.p2pCode.textContent = id;
      const link = `${location.origin}/p2p/${encodeURIComponent(id)}`;
      els.p2pLink.value = link;
    },
    onStatus: ({ phase, message }) => {
      if (phase === 'waiting') {
        // Update p2pWaitCard title/subtitle to show waiting status
        const waitTitle = els.p2pWaitCard?.querySelector('h5');
        const waitSub = els.p2pWaitCard?.querySelector('.text-body-secondary');
        if (waitTitle) waitTitle.textContent = 'Connected!';
        if (waitSub) waitSub.textContent = message;
        setHidden(els.p2pCode, true);
        setHidden(els.p2pLinkLabel, true);
        setHidden(els.p2pLink, true);
        setHidden(els.copyP2PLink, true);
        setHidden(els.qrP2PLink, true);
      } else if (phase === 'transferring') {
        // Switch to progress card when transfer actually starts
        showProgress({ title: 'Sending...', sub: message, percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'sync_alt', iconColor: 'text-primary' });
        // Show P2P cancel button
        els.cancelP2PSend.style.display = 'inline-block';
        els.cancelStandardUpload.style.display = 'none';
      } else {
        // Default behaviour for other statuses
        showProgress({ title: 'Sending...', sub: message, percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'sync_alt', iconColor: 'text-primary' });
      }
    },
    onProgress: ({ processedBytes, totalBytes, percent }) => {
      // Update title and store progress for visibility handler
      updateTitleProgress(percent);
      currentTransferProgress = {
        percent,
        doneBytes: processedBytes,
        totalBytes,
        showProgress: (pct, done, total) => {
          showProgress({ title: 'Sending...', sub: 'Keep this tab open until the transfer completes.', percent: pct, doneBytes: done, totalBytes: total, icon: 'sync_alt', iconColor: 'text-primary' });
        }
      };

      showProgress({ title: 'Sending...', sub: 'Keep this tab open until the transfer completes.', percent, doneBytes: processedBytes, totalBytes, icon: 'sync_alt', iconColor: 'text-primary' });
    },
    onComplete: () => {
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      stopP2P();
      showShare({
        title: 'Transfer Complete',
        sub: 'Your recipient has received the file.',
        showLinkGroup: false,
      });
    },
    onError: (err) => {
      console.error(err);
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      showProgress({ title: 'Transfer Failed', sub: err?.message || 'An error occurred during transfer.', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'error', iconColor: 'text-danger' });
      stopP2P();
    },
    onDisconnect: () => {
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      showProgress({ title: 'Receiver Disconnected', sub: 'The receiver closed their browser or cancelled the transfer.', percent: 0, doneBytes: 0, totalBytes: file.size, icon: 'link_off', iconColor: 'text-warning' });
      stopP2P();
    },
    onCancel: (evt) => {
      els.cancelP2PSend.style.display = 'none';
      stopP2P();
      const msg = evt?.cancelledBy === 'receiver'
        ? 'The receiver cancelled the transfer.'
        : 'Transfer cancelled.';
      showToast(msg, 'warning');
      resetToMain();
    },
  });

  els.copyP2PLink.onclick = () => copyToClipboard(els.p2pLink.value).then(() => showToast('Copied link.', 'success'));
  els.qrP2PLink.onclick = () => showQRModal(els.p2pLink.value);
  els.cancelP2P.onclick = () => {
    resetTitleProgress();
    stopP2P();
    showToast('Transfer cancelled.', 'warning');
    resetToMain();
  };
  els.cancelP2PSend.onclick = () => {
    resetTitleProgress();
    stopP2P();
    showToast('Transfer cancelled.', 'warning');
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

  els.lifetimeValue?.addEventListener('input', () => {
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

  els.maxDownloadsValue?.addEventListener('input', () => {
    if (!state.uploadEnabled) return;
    if (els.maxDownloadsValue.value === '') {
      els.maxDownloadsValue.value = '1';
    }
    validateMaxDownloadsInput();
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
      showToast(err?.message || 'Something went wrong.', 'danger');
      resetToMain();
    }
  });

  // Share actions
  els.copyShare?.addEventListener('click', () => copyToClipboard(els.shareLink.value).then(() => showToast('Copied link.', 'success')));
  els.qrShare?.addEventListener('click', () => showQRModal(els.shareLink.value));
  els.newUpload?.addEventListener('click', resetToMain);

  // Enter code
  const goWithCode = async () => {
    const value = normalizeCode(els.codeInput.value);
    if (!value) return;

    setDisabled(els.codeGo, true);
    try {
      const result = await coreClient.resolveShareTarget(value, {
        timeoutMs: 5000,
      });
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
    showToast('Could not load server info.', 'warning');
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

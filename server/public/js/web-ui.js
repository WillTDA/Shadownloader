const capabilitiesRaw = document.body?.dataset?.capabilities;
const capabilities = capabilitiesRaw ? JSON.parse(capabilitiesRaw) : {};

const maxUploadEl = document.getElementById('max-upload-size');
const startUploadButton = document.getElementById('start-upload');
const uploadDisabledNote = document.getElementById('upload-disabled');
const modeButtons = document.querySelectorAll('[data-mode]');
const encryptionButtons = document.querySelectorAll('[data-encryption]');
const modeHelp = document.getElementById('mode-help');
const encryptionHelp = document.getElementById('encryption-help');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const shareGo = document.getElementById('share-go');
const shareCodeInput = document.getElementById('share-code');

const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return 'Unknown';
    if (bytes === 0) return 'Unlimited';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
};

const maxUploadBytes = capabilities?.upload?.enabled
    ? (capabilities.upload.maxSizeMB === 0 ? 0 : capabilities.upload.maxSizeMB * 1024 * 1024)
    : null;

if (maxUploadEl) {
    maxUploadEl.textContent = formatBytes(maxUploadBytes);
}

if (!capabilities?.upload?.enabled) {
    startUploadButton.disabled = true;
    uploadDisabledNote.hidden = false;
    modeHelp.textContent = 'Uploads are disabled on this server.';
}

if (!capabilities?.p2p?.enabled) {
    modeButtons.forEach((button) => {
        if (button.dataset.mode === 'p2p') {
            button.disabled = true;
        }
    });
}

if (!capabilities?.upload?.e2ee) {
    encryptionButtons.forEach((button) => {
        if (button.dataset.encryption === 'true') {
            button.disabled = true;
        }
    });
    encryptionHelp.textContent = 'Encryption is disabled by the server.';
}

modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (button.disabled) return;
        modeButtons.forEach((btn) => btn.classList.remove('is-active'));
        button.classList.add('is-active');
        const mode = button.dataset.mode;
        modeHelp.textContent = mode === 'p2p'
            ? 'You will keep this page open to complete the transfer.'
            : 'Uploads are stored on the server until downloaded.';
    });
});

encryptionButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (button.disabled) return;
        encryptionButtons.forEach((btn) => btn.classList.remove('is-active'));
        button.classList.add('is-active');
    });
});

const highlightDrop = (isActive) => {
    if (!dropZone) return;
    dropZone.style.borderColor = isActive ? '#00a37a' : 'rgba(0, 0, 0, 0.12)';
    dropZone.style.background = isActive ? 'rgba(87, 242, 135, 0.16)' : 'rgba(87, 242, 135, 0.08)';
};

if (dropZone) {
    ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            highlightDrop(true);
        });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            highlightDrop(false);
        });
    });

    dropZone.addEventListener('drop', (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            fileInput.files = event.dataTransfer.files;
            dropZone.querySelector('h2').textContent = file.name;
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) {
            dropZone.querySelector('h2').textContent = file.name;
        }
    });
}

if (shareGo) {
    shareGo.addEventListener('click', () => {
        const code = shareCodeInput.value.trim();
        if (!code) return;
        window.location.href = `/p2p/${encodeURIComponent(code)}`;
    });
}

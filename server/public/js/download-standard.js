import { DropgateClient, importKeyFromBase64, decryptFilenameFromBase64 } from './dropgate-core.js';

const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const downloadButton = document.getElementById('download-button');
const fileDetails = document.getElementById('file-details');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileEncryptionEl = document.getElementById('file-encryption');
const fileIdEl = document.getElementById('file-id');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const iconContainer = document.getElementById('icon-container');
const card = document.getElementById('status-card');
const trustStatement = document.getElementById('trust-statement');
const encryptionStatement = document.getElementById('encryption-statement');

const client = new DropgateClient({ clientVersion: '2.0.0' });

const downloadState = {
  fileId: null,
  isEncrypted: false,
  keyB64: null,
  fileName: null,
  sizeBytes: 0,
};

function showError(title, message) {
  statusTitle.textContent = title;
  statusMessage.textContent = message;
  downloadButton.style.display = 'none';
  progressContainer.style.display = 'none';
  card.classList.add('border', 'border-danger');
  iconContainer.innerHTML = '<span class="material-icons-round text-danger">error</span>';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
}

async function startDownload() {
  downloadButton.style.display = 'none';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = 'Starting...';
  downloadButton.disabled = true;

  card.classList.remove('border-danger', 'border-success');
  card.classList.add('border', 'border-primary');
  iconContainer.innerHTML = downloadState.isEncrypted
    ? '<span class="material-icons-round text-primary">shield_lock</span>'
    : '<span class="material-icons-round text-primary">download</span>';

  // For encrypted files, require secure context with streamSaver
  if (downloadState.isEncrypted) {
    if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
      showError('Secure Context Required', 'Encrypted files must be downloaded and decrypted in a secure context (HTTPS).');
      return;
    }
  }

  // For plain files in non-secure context, fall back to direct download
  if (!downloadState.isEncrypted && (!window.isSecureContext || !window.streamSaver?.createWriteStream)) {
    statusTitle.textContent = 'Download Starting';
    statusMessage.textContent = 'Your download will start in a new request (completion can\'t be tracked on HTTP).';
    window.location.href = `/api/file/${downloadState.fileId}`;
    return;
  }

  try {
    statusTitle.textContent = 'Starting Download...';
    statusMessage.textContent = `Your browser will now ask you where to save "${downloadState.fileName}".`;

    const fileStream = streamSaver.createWriteStream(downloadState.fileName);
    const writer = fileStream.getWriter();

    statusTitle.textContent = downloadState.isEncrypted ? 'Downloading & Decrypting' : 'Downloading';
    statusMessage.textContent = 'Streaming directly to file...';

    await client.downloadFile({
      host: location.hostname,
      port: location.port ? Number(location.port) : undefined,
      secure: location.protocol === 'https:',
      fileId: downloadState.fileId,
      keyB64: downloadState.keyB64,
      timeoutMs: 0, // No timeout for large file downloads
      onProgress: ({ phase, percent, receivedBytes, totalBytes }) => {
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`;
        statusMessage.textContent = totalBytes
          ? `Streaming directly to file... (${percent}%)`
          : `Streaming directly to file... (${formatBytes(receivedBytes)})`;
      },
      onData: async (chunk) => {
        await writer.write(chunk);
      },
    });

    await writer.close();

    progressBar.style.width = '100%';
    statusTitle.textContent = 'Download Complete!';
    statusMessage.textContent = downloadState.isEncrypted
      ? `Your file "${downloadState.fileName}" has been successfully decrypted and saved.`
      : `Your file "${downloadState.fileName}" has been successfully saved.`;
    card.classList.remove('border-danger');
    card.classList.add('border-success');
    iconContainer.innerHTML = '<span class="material-icons-round text-success">check_circle</span>';
  } catch (error) {
    console.error(error);
    progressContainer.style.display = 'none';
    downloadButton.textContent = 'Retry Download';
    downloadButton.style.display = 'inline-block';
    downloadButton.disabled = false;

    statusTitle.textContent = 'Download Failed';
    statusMessage.textContent = error.message || 'The link may be incorrect, expired, or the download failed.';
    card.classList.add('border', 'border-danger');
    iconContainer.innerHTML = '<span class="material-icons-round text-danger">error</span>';
  }
}

async function loadMetadata() {
  const fileId = window.location.pathname.split('/').pop();
  if (!fileId) {
    showError('Invalid Link', 'The file ID is missing from this link.');
    return;
  }

  downloadState.fileId = fileId;
  fileIdEl.textContent = fileId;

  try {
    const response = await fetch(`/api/file/${fileId}/meta`);
    if (!response.ok) {
      showError('File Not Found', 'This file link is invalid or has already expired.');
      return;
    }

    const metadata = await response.json();
    downloadState.isEncrypted = Boolean(metadata.isEncrypted);
    downloadState.sizeBytes = metadata.sizeBytes;
    fileEncryptionEl.textContent = metadata.isEncrypted ? 'Encrypted (E2EE)' : 'Standard download';
    fileSizeEl.textContent = formatBytes(metadata.sizeBytes);

    trustStatement.style.display = 'block';

    if (metadata.isEncrypted) {
      encryptionStatement.style.display = 'block';

      if (!window.isSecureContext) {
        showError('Secure Connection Required', 'Encrypted files can only be downloaded over HTTPS.');
        return;
      }

      const hash = window.location.hash.substring(1);
      if (!hash) {
        showError('Missing Decryption Key', 'The decryption key was not found in the URL.');
        return;
      }

      downloadState.keyB64 = hash;

      // Use dropgate-core to decrypt the filename for display
      const key = await importKeyFromBase64(crypto, hash);
      downloadState.fileName = await decryptFilenameFromBase64(crypto, metadata.encryptedFilename, key);
    } else {
      downloadState.fileName = metadata.filename;
    }

    fileNameEl.textContent = downloadState.fileName || 'Unknown';
    fileDetails.style.display = 'block';
    downloadButton.style.display = 'inline-block';
    downloadButton.addEventListener('click', startDownload);
    statusTitle.textContent = 'Ready to download';
    statusMessage.textContent = 'Review the file details above, then click Start Download.';
  } catch (error) {
    console.error(error);
    showError('Download Error', 'We could not load the file details. Please try again later.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadMetadata);
} else {
  loadMetadata();
}
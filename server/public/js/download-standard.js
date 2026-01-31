import { DropgateClient, importKeyFromBase64, decryptFilenameFromBase64 } from './dropgate-core.js';
import { setStatusError, setStatusSuccess, StatusType, Icons, updateStatusCard } from './status-card.js';

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

const client = new DropgateClient({ clientVersion: '3.0.0', server: location.origin });

const downloadState = {
  fileId: null,
  isEncrypted: false,
  keyB64: null,
  fileName: null,
  sizeBytes: 0,
};

function showError(title, message) {
  setStatusError({
    card,
    iconContainer,
    titleEl: statusTitle,
    messageEl: statusMessage,
    title,
    message,
  });
  downloadButton.style.display = 'none';
  progressContainer.style.display = 'none';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
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

  updateStatusCard({
    card,
    iconContainer,
    status: StatusType.PRIMARY,
    icon: downloadState.isEncrypted ? Icons.DOWNLOAD_ENCRYPTED : Icons.DOWNLOAD,
  });

  // For encrypted files, require secure context with streamSaver
  if (downloadState.isEncrypted) {
    if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
      showError('Secure Context Required', 'Encrypted files must be downloaded and decrypted in a secure context (HTTPS).');
      return;
    }
  }

  // For plain files in non-secure context, fall back to direct download
  if (!downloadState.isEncrypted && (!window.isSecureContext || !window.streamSaver?.createWriteStream)) {
    progressContainer.style.display = 'none';
    window.location.href = `/api/file/${downloadState.fileId}`;
    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Started',
      message: `Your file "${downloadState.fileName}" should be downloading now. Check your browser\'s download bar.`,
    });
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
      fileId: downloadState.fileId,
      keyB64: downloadState.keyB64,
      timeoutMs: 0, // No timeout for large file downloads
      onProgress: ({ percent, processedBytes, totalBytes }) => {
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`;
        statusMessage.textContent = totalBytes
          ? `Streaming directly to file... (${percent}%)`
          : `Streaming directly to file... (${formatBytes(processedBytes)})`;
      },
      onData: async (chunk) => {
        await writer.write(chunk);
      },
    });

    await writer.close();

    progressBar.style.width = '100%';
    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Complete!',
      message: downloadState.isEncrypted
        ? `Your file "${downloadState.fileName}" has been successfully decrypted and saved.`
        : `Your file "${downloadState.fileName}" has been successfully saved.`,
    });
  } catch (error) {
    console.error(error);
    progressContainer.style.display = 'none';
    downloadButton.textContent = 'Retry Download';
    downloadButton.style.display = 'inline-block';
    downloadButton.disabled = false;

    setStatusError({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Failed',
      message: error.message || 'The link may be incorrect, expired, or the download failed.',
    });
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
    fileEncryptionEl.textContent = metadata.isEncrypted ? 'End-to-End Encrypted' : 'None';
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
    statusTitle.textContent = 'Ready to Download';
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
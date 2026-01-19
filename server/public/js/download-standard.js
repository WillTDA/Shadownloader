(() => {
  const ENCRYPTED_CHUNK_OVERHEAD = 28; // IV (12) + tag (16)

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
    if (!bytes && bytes !== 0) return 'Unknown';
    if (bytes === 0) return '0 bytes';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }

  async function importKey(keyB64) {
    const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, true, ['decrypt']);
  }

  async function decryptData(encryptedChunk, key) {
    const iv = encryptedChunk.slice(0, 12);
    const ciphertext = encryptedChunk.slice(12);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  }

  async function decryptFilename(encryptedFilename, key) {
    const dataBuffer = Uint8Array.from(atob(encryptedFilename), (c) => c.charCodeAt(0));
    const decryptedBuffer = await decryptData(new Uint8Array(dataBuffer), key);
    return new TextDecoder().decode(decryptedBuffer);
  }

  async function processPlainDownload(fileId, filename, expectedSizeBytes = 0) {
    downloadButton.style.display = 'none';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting...';
    downloadButton.disabled = true;

    card.classList.remove('border-danger', 'border-success');
    card.classList.add('border', 'border-primary');
    iconContainer.innerHTML = '<span class="material-icons-round text-primary">download</span>';

    try {
      statusTitle.textContent = 'Starting Download...';
      statusMessage.textContent = `Your browser will now ask you where to save "${filename}".`;

      // StreamSaver works best in secure contexts. If not, fall back to a plain download.
      if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
        statusTitle.textContent = 'Download Starting';
        statusMessage.textContent = 'Your download will start in a new request (completion can\'t be tracked on HTTP).';
        window.location.href = `/api/file/${fileId}`;
        return;
      }

      const fileStream = streamSaver.createWriteStream(filename);
      const writer = fileStream.getWriter();

      const response = await fetch(`/api/file/${fileId}`);
      if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
      if (!response.body) throw new Error('Streaming not supported in this browser.');

      const reader = response.body.getReader();

      const headerLen = response.headers.get('Content-Length');
      const totalBytes = headerLen ? Number(headerLen) : Number(expectedSizeBytes) || 0;

      let receivedLength = 0;

      statusTitle.textContent = 'Downloading';
      statusMessage.textContent = 'Streaming directly to file...';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        receivedLength += value.length;
        await writer.write(value);

        const percentage = totalBytes ? Math.round((receivedLength / totalBytes) * 100) : 0;
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${formatBytes(receivedLength)} / ${formatBytes(totalBytes)}`;
        statusMessage.textContent = totalBytes
          ? `Streaming directly to file... (${percentage}%)`
          : `Streaming directly to file... (${formatBytes(receivedLength)})`;
      }

      await writer.close();

      progressBar.style.width = '100%';
      statusTitle.textContent = 'Download Complete!';
      statusMessage.textContent = `Your file "${filename}" has been successfully saved.`;
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
      statusMessage.textContent = 'The link may be incorrect, expired, or the download failed.';
      card.classList.add('border', 'border-danger');
      iconContainer.innerHTML = '<span class="material-icons-round text-danger">error</span>';
    }
  }

  async function processDecryption(fileId, keyB64, originalFilename) {
    downloadButton.style.display = 'none';
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting...';
    card.classList.remove('border-danger');
    card.classList.add('border', 'border-primary');
    iconContainer.innerHTML = '<span class="material-icons-round text-primary">shield_lock</span>';

    try {
      const key = await importKey(keyB64);
      statusTitle.textContent = 'Starting Download...';
      statusMessage.textContent = `Your browser will now ask you where to save "${originalFilename}".`;

      if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
        showError('Secure Context Required', 'Encrypted files must be downloaded and decrypted in a secure context (HTTPS).');
        return;
      }

      const fileStream = streamSaver.createWriteStream(originalFilename);
      const writer = fileStream.getWriter();

      const response = await fetch(`/api/file/${fileId}`);
      if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length');
      let receivedLength = 0;
      let buffer = new Uint8Array(0);

      statusTitle.textContent = 'Downloading & Decrypting';
      statusMessage.textContent = 'Streaming directly to file...';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        const CHUNK_SIZE = 5 * 1024 * 1024;
        const encryptedChunkSize = CHUNK_SIZE + ENCRYPTED_CHUNK_OVERHEAD;

        while (buffer.length >= encryptedChunkSize) {
          const chunkToProcess = buffer.slice(0, encryptedChunkSize);
          buffer = buffer.slice(encryptedChunkSize);
          const decryptedChunk = await decryptData(chunkToProcess, key);
          await writer.write(new Uint8Array(decryptedChunk));
        }

        receivedLength += value.length;
        const percentage = contentLength ? Math.round((receivedLength / contentLength) * 100) : 0;
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${formatBytes(receivedLength)} / ${formatBytes(contentLength)}`;
        statusMessage.textContent = `Streaming directly to file... (${percentage}%)`;
      }

      if (buffer.length > 0) {
        const decryptedChunk = await decryptData(buffer, key);
        await writer.write(new Uint8Array(decryptedChunk));
      }

      await writer.close();

      progressBar.style.width = '100%';
      statusTitle.textContent = 'Download Complete!';
      statusMessage.textContent = `Your file "${originalFilename}" has been successfully decrypted and saved.`;
      card.classList.remove('border-danger');
      card.classList.add('border', 'border-success');
      iconContainer.innerHTML = '<span class="material-icons-round text-success">check_circle</span>';
    } catch (error) {
      console.error(error);
      progressContainer.style.display = 'none';
      downloadButton.textContent = 'Retry Download';
      downloadButton.style.display = 'inline-block';
      statusTitle.textContent = 'Download Failed';
      statusMessage.textContent = 'The link may be incorrect, expired, or the file failed to process.';
      card.classList.add('border', 'border-danger');
      iconContainer.innerHTML = '<span class="material-icons-round text-danger">error</span>';
    }
  }

  async function startDownload() {
    if (downloadState.isEncrypted) {
      if (!downloadState.keyB64) {
        showError('Missing Decryption Key', 'The link does not include the key needed to decrypt this file.');
        return;
      }
      return processDecryption(downloadState.fileId, downloadState.keyB64, downloadState.fileName);
    }

    return processPlainDownload(downloadState.fileId, downloadState.fileName, downloadState.sizeBytes);
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
        const key = await importKey(hash);
        downloadState.fileName = await decryptFilename(metadata.encryptedFilename, key);
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
})();

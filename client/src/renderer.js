document.addEventListener('DOMContentLoaded', async () => {
    try {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });

        // --- DOM Element References ---
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const selectFileBtn = document.getElementById('select-file-btn');
        const fileNameDisplay = document.getElementById('file-name');
        const serverUrlInput = document.getElementById('server-url');
        const testConnectionBtn = document.getElementById('test-connection-btn');
        const connectionStatus = document.getElementById('connection-status');
        const fileLifetimeValueInput = document.getElementById('file-lifetime-value');
        const fileLifetimeUnitSelect = document.getElementById('file-lifetime-unit');
        const encryptCheckbox = document.getElementById('encrypt-checkbox');
        const uploadBtn = document.getElementById('upload-btn');
        const uploadStatus = document.getElementById('upload-status');
        const progressBar = document.getElementById('progress-bar');
        const linkSection = document.getElementById('link-section');
        const downloadLinkInput = document.getElementById('download-link');
        const copyBtn = document.getElementById('copy-btn');

        let selectedFile = null;
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

        function isFile(file) {
            return new Promise((resolve) => {
                // A simple check for the presence of a file type can often identify files.
                // Directories will have an empty string as their type.
                if (file.type !== '') {
                    return resolve(true);
                }

                // For files without a type, we can use FileReader.
                // Reading a directory will result in an error.
                const reader = new FileReader();
                reader.onloadend = () => {
                    if (reader.error) {
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                };
                reader.readAsArrayBuffer(file);
            });
        }

        // --- Initial Settings Load ---
        const settings = await window.electronAPI.getSettings();
        serverUrlInput.value = settings.serverURL || '';
        await checkServerCompatibility();
        fileLifetimeValueInput.value = settings.lifetimeValue || 24;
        fileLifetimeUnitSelect.value = settings.lifetimeUnit || 'hours';
        if (fileLifetimeUnitSelect.value === 'unlimited') {
            fileLifetimeValueInput.disabled = true;
        }

        // --- Event Listeners ---
        fileLifetimeValueInput.addEventListener('blur', () => {
            if (fileLifetimeUnitSelect.value !== 'unlimited') {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) {
                    fileLifetimeValueInput.value = 0.5;
                }
            }
            saveSettings();
        });

        fileLifetimeUnitSelect.addEventListener('change', () => {
            if (fileLifetimeUnitSelect.value === 'unlimited') {
                fileLifetimeValueInput.disabled = true;
                fileLifetimeValueInput.value = 0;
            } else {
                fileLifetimeValueInput.disabled = false;
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) {
                    fileLifetimeValueInput.value = 0.5;
                }
            }
            saveSettings();
        });

        selectFileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (!files || files.length === 0) return;

            const droppedFile = files[0];

            // Check if the dropped item is a file
            const isValidFile = await isFile(droppedFile);

            if (isValidFile) {
                handleFile(droppedFile);
            } else {
                uploadStatus.textContent = 'Folders cannot be uploaded.';
                uploadStatus.className = 'form-text mt-1 text-warning';
                selectedFile = null;
                fileNameDisplay.textContent = '';
                fileInput.value = '';
                uploadBtn.disabled = true;
            }
        });

        testConnectionBtn.addEventListener('click', async () => {
            const serverUrl = serverUrlInput.value.trim();
            if (!serverUrl) {
                connectionStatus.textContent = 'Please enter a server URL.';
                connectionStatus.className = 'form-text mt-1 text-warning';
                return;
            }
            testConnectionBtn.disabled = true;
            testConnectionBtn.textContent = 'Testing...';
            connectionStatus.textContent = 'Pinging server...';
            connectionStatus.className = 'form-text mt-1 text-muted';
            const cleanUrl = await cleanServerUrl(serverUrl);
            try {
                const response = await fetch(cleanUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
                if (response.ok) {
                    if (cleanUrl.startsWith('https://')) {
                        connectionStatus.textContent = 'Connection successful (HTTPS).';
                        connectionStatus.className = 'form-text mt-1 text-success';
                    } else {
                        connectionStatus.textContent = 'Connection successful (HTTP) — connection is insecure.';
                        connectionStatus.className = 'form-text mt-1 text-warning';
                    }
                } else {
                    connectionStatus.textContent = `Failed. Server responded with status: ${response.status}`;
                    connectionStatus.className = 'form-text mt-1 text-danger';
                }
                await checkServerCompatibility();
            } catch (error) {
                connectionStatus.textContent = 'Connection failed. Check URL or if server is running.';
                connectionStatus.className = 'form-text mt-1 text-danger';
            } finally {
                testConnectionBtn.disabled = false;
                testConnectionBtn.textContent = 'Test';
            }
        });

        copyBtn.addEventListener('click', () => {
            downloadLinkInput.select();
            document.execCommand('copy');
        });

        // --- IPC Listeners (Communication from Main Process) ---

        // Listens for UI update commands from main.js
        window.electronAPI.onUpdateUI((event) => {
            switch (event.type) {
                case 'progress':
                    const { text, percent } = event.data;
                    if (text) {
                        uploadStatus.textContent = text;
                        uploadStatus.className = 'form-text mt-1 text-muted';
                    }
                    if (percent !== undefined) {
                        progressBar.style.width = percent.toFixed(2) + '%';
                        progressBar.setAttribute('aria-valuenow', percent.toFixed(2));
                        progressBar.textContent = percent.toFixed(0) + '%';
                    }
                    uploadBtn.disabled = true;
                    uploadBtn.textContent = 'Uploading...';
                    linkSection.style.display = 'none';
                    break;
                case 'success':
                    const { link } = event.data;
                    downloadLinkInput.value = link;
                    linkSection.style.display = 'block';
                    uploadStatus.textContent = 'Upload successful!';
                    uploadStatus.className = 'form-text mt-1 text-success';
                    resetUI();
                    break;
                case 'error':
                    const { error } = event.data;
                    uploadStatus.textContent = `Upload failed: ${error}`;
                    uploadStatus.className = 'form-text mt-1 text-danger';
                    resetUI(false);
                    break;
            }
        });

        // Listens for a file opened via the 'Open File' menu
        window.electronAPI.onFileOpened((file) => {
            if (file && file.data) {
                const newFile = new File([file.data], file.name, { type: '' });
                handleFile(newFile);
            }
        });

        // Listens for a background upload triggered from the context menu
        window.electronAPI.onBackgroundUploadStart(async (details) => {
            console.log('Background upload triggered with details:', details);

            if (details && details.data) {
                console.log('File size:', details.data.byteLength, 'bytes');
                const file = new File([details.data], details.name);
                selectedFile = file;
                encryptCheckbox.checked = details.useE2EE || false;

                const settings = await window.electronAPI.getSettings();
                console.log('Settings loaded:', settings);

                if (!settings.serverURL) {
                    console.error('No server URL configured!');
                    window.electronAPI.uploadFinished({
                        status: 'error',
                        error: 'Server URL is not configured.'
                    });
                    return;
                }
                serverUrlInput.value = settings.serverURL;

                console.log('Starting upload...');
                // Trigger the centralized upload function
                await performUpload();
            } else {
                console.error('Invalid details received:', details);
            }
        });

        function handleFile(file) {
            // Clear any previous error messages
            uploadStatus.textContent = '';

            if (!file) {
                selectedFile = null;
                fileNameDisplay.textContent = '';
                fileInput.value = '';
                uploadBtn.disabled = true;
                return;
            }

            if (file.size === 0) {
                uploadStatus.textContent = 'Error: Cannot upload empty (0 byte) files.';
                uploadStatus.className = 'form-text mt-1 text-danger';
                selectedFile = null;
                fileNameDisplay.textContent = '';
                fileInput.value = '';
                uploadBtn.disabled = true;
                return;
            }

            selectedFile = file;
            fileNameDisplay.textContent = file.name;
            uploadBtn.disabled = false;
            linkSection.style.display = 'none';
        }

        // Trigger for uploads started from the UI
        uploadBtn.addEventListener('click', performUpload);

        /**
         * The main upload logic.
         * It reports progress and final status back to the main process via IPC.
         */
        async function performUpload() {
            await checkServerCompatibility();

            if (fileLifetimeUnitSelect.value !== 'unlimited') {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) {
                    fileLifetimeValueInput.value = 0.5;
                }
            }

            if (!selectedFile) {
                window.electronAPI.uploadFinished({ status: 'error', error: 'File is missing or cannot be read.' });
                return;
            }

            const cleanUrl = await cleanServerUrl(serverUrlInput.value);
            const useEncryption = encryptCheckbox.checked;

            try {
                const response = await fetch(cleanUrl, { signal: AbortSignal.timeout(5000) });
                const data = await response.json();
                const fileLimit = data.sizeLimit || 0;
                if (fileLimit > 0 && selectedFile.size > (fileLimit * 1024 * 1024)) {
                    const errorMsg = `File size (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB) exceeds server limit of ${fileLimit} MB.`;
                    window.electronAPI.uploadFinished({ status: 'error', error: errorMsg });
                    return;
                }
            } catch (error) {
                window.electronAPI.uploadFinished({ status: 'error', error: 'Could not retrieve server info. Upload aborted.' });
                return;
            }

            let keyB64 = null;
            let cryptoKey = null;
            let encryptedFilename = selectedFile.name;

            if (useEncryption) {
                window.electronAPI.uploadProgress({ text: 'Generating encryption key...' });
                try {
                    cryptoKey = await generateKey();
                    keyB64 = await exportKey(cryptoKey);
                    const filenameBuffer = new TextEncoder().encode(selectedFile.name);
                    const encryptedFilenameBlob = await encryptData(filenameBuffer, cryptoKey);

                    const reader = new FileReader();
                    encryptedFilename = await new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(encryptedFilenameBlob);
                    });
                } catch (err) {
                    window.electronAPI.uploadFinished({ status: 'error', error: 'Failed to prepare file for encryption.' });
                    return;
                }
            }

            try {
                window.electronAPI.uploadProgress({ text: 'Initialising upload...' });
                const initResponse = await fetch(`${cleanUrl}/upload/init`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: encryptedFilename,
                        lifetime: getLifetimeInMs(),
                        isEncrypted: useEncryption,
                    }),
                });

                if (!initResponse.ok) {
                    const errorData = await initResponse.json().catch(() => ({ error: 'Server returned an invalid response.' }));
                    throw new Error(`Server failed to initialise upload. Status: ${initResponse.status}. ${errorData.error}`);
                }

                const { uploadId } = await initResponse.json();
                await uploadChunks(uploadId, cleanUrl, cryptoKey);

                window.electronAPI.uploadProgress({ text: 'Finalising upload...', percent: 100 });
                const completeResponse = await fetch(`${cleanUrl}/upload/complete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uploadId }),
                    signal: AbortSignal.timeout(30000)  // 30 second timeout
                });

                if (!completeResponse.ok) {
                    const errorData = await completeResponse.json().catch(() => ({}));
                    throw new Error(`Server failed to finalize upload. ${errorData.error || ''}`);
                }

                const response = await completeResponse.json();
                let downloadLink = `${cleanUrl}/${response.id}`;
                if (useEncryption) {
                    downloadLink += `#${keyB64}`;
                }

                window.electronAPI.uploadFinished({ status: 'success', link: downloadLink });
            } catch (error) {
                window.electronAPI.uploadFinished({ status: 'error', error: error.message });
            }
        }

        async function uploadChunks(uploadId, serverUrl, cryptoKey) {
            const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
                let chunk = selectedFile.slice(start, end);

                if (cryptoKey) {
                    const chunkBuffer = await chunk.arrayBuffer();
                    chunk = await encryptData(chunkBuffer, cryptoKey);
                }

                const chunkResponse = await fetch(`${serverUrl}/upload/chunk`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'X-Upload-ID': uploadId,
                    },
                    body: chunk,
                });

                if (!chunkResponse.ok) {
                    throw new Error(`Chunk ${i + 1} failed to upload.`);
                }

                const percentComplete = ((i + 1) / totalChunks) * 100;
                window.electronAPI.uploadProgress({
                    text: `Sending chunk ${i + 1} of ${totalChunks}...`,
                    percent: percentComplete
                });
            }
        }

        // --- Utility Functions ---

        function saveSettings() {
            window.electronAPI.setSettings({
                serverURL: serverUrlInput.value,
                lifetimeValue: fileLifetimeValueInput.value,
                lifetimeUnit: fileLifetimeUnitSelect.value
            });
        }

        function getLifetimeInMs() {
            const unit = fileLifetimeUnitSelect.value;
            const value = parseFloat(fileLifetimeValueInput.value, 10) || 0;
            if (unit === 'unlimited' || value <= 0) return 0;
            const multipliers = {
                minutes: 60 * 1000,
                hours: 60 * 60 * 1000,
                days: 24 * 60 * 60 * 1000,
            };
            return value * (multipliers[unit] || 0);
        }

        async function cleanServerUrl(url) {
            if (!url) return;
            let cleanUrl = url.trim().replace(/\/+$/, '');
            if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
                cleanUrl = 'https://' + cleanUrl;
            }

            try {
                const response = await fetch(cleanUrl, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
                if (response.ok) return cleanUrl;
            } catch (error) {
                console.warn('HTTPS check failed, falling back to HTTP');
                return cleanUrl.replace(/^https:\/\//, 'http://');
            }
            return cleanUrl;
        }

        async function checkServerCompatibility() {
            const serverUrl = await cleanServerUrl(serverUrlInput.value.trim());
            if (!serverUrl) return;

            try {
                const clientVersion = await window.electronAPI.getClientVersion();
                const response = await fetch(serverUrl, { signal: AbortSignal.timeout(5000) });
                const serverInfo = await response.json();
                const serverVersion = serverInfo.version;

                if (!serverVersion) {
                    uploadStatus.textContent = 'Warning: Server version is unknown. Compatibility issues may occur.';
                    uploadStatus.className = 'form-text mt-1 text-warning';
                    return;
                }

                const [clientMajor, clientMinor, _clientPatch] = clientVersion.split('.').map(Number);
                const [serverMajor, serverMinor, _serverPatch] = serverVersion.split('.').map(Number);

                if (clientMajor !== serverMajor) {
                    uploadBtn.disabled = true;
                    uploadStatus.textContent = `Error: Incompatible versions. Client is v${clientVersion}, Server is v${serverVersion}. Please update.`;
                    uploadStatus.className = 'form-text mt-1 text-danger';
                } else if (clientMinor > serverMinor) {
                    uploadStatus.textContent = `Warning: Client (v${clientVersion}) is newer than Server (v${serverVersion}). Some features may not work.`;
                    uploadStatus.className = 'form-text mt-1 text-warning';
                } else if (serverMinor > clientMinor) {
                    uploadStatus.textContent = `Info: A new client version is available. (Server: v${serverVersion}, Client: v${clientVersion})`;
                    uploadStatus.className = 'form-text mt-1 text-info';
                } else {
                    // Versions are compatible
                    uploadStatus.textContent = `Server: v${serverVersion}, Client: v${clientVersion}`;
                    uploadStatus.className = 'form-text mt-1 text-info';
                }
            } catch (error) {
                uploadStatus.textContent = 'Could not connect to the server to check compatibility.';
                uploadStatus.className = 'form-text mt-1 text-warning';
                console.error('Compatibility check failed:', error);
            }
        }

        // --- Crypto Functions ---
        async function generateKey() {
            return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        }

        async function exportKey(key) {
            const exported = await crypto.subtle.exportKey('raw', key);
            return btoa(String.fromCharCode.apply(null, new Uint8Array(exported)));
        }

        async function encryptData(dataBuffer, key) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encryptedContent = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, dataBuffer);
            const finalBlob = new Blob([iv, new Uint8Array(encryptedContent)]);
            return finalBlob;
        }

        // Helper to reset the UI state after an upload completes or fails
        function resetUI(clearFile = true) {
            uploadBtn.textContent = 'Upload';
            if (clearFile) {
                selectedFile = null;
                fileNameDisplay.textContent = '';
                fileInput.value = '';
                uploadBtn.disabled = true;
            } else {
                uploadBtn.disabled = false;
            }

            setTimeout(() => {
                progressBar.style.width = '0%';
                progressBar.setAttribute('aria-valuenow', 0);
                progressBar.textContent = '';
            }, 3000);
        }

        window.electronAPI.rendererReady();
    } catch (error) {
        console.error('FATAL ERROR in renderer initialization:', error);
        alert('Fatal error initialising renderer: ' + error.message);
    }
});
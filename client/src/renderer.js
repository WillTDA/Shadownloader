import { DropgateClient, getServerInfo, lifetimeToMs, parseServerUrl } from './dropgate-core.js';

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
        const fileChosen = document.getElementById('file-chosen');
        const fileChosenName = document.getElementById('file-chosen-name');
        const fileChosenSize = document.getElementById('file-chosen-size');
        const maxUploadHint = document.getElementById('max-upload-hint');
        const serverUrlInput = document.getElementById('server-url');
        const testConnectionBtn = document.getElementById('test-connection-btn');
        const connectionStatus = document.getElementById('connection-status');
        const fileLifetimeValueInput = document.getElementById('file-lifetime-value');
        const fileLifetimeUnitSelect = document.getElementById('file-lifetime-unit');
        const fileLifetimeHelp = document.getElementById('file-lifetime-help');
        const maxDownloadsSection = document.getElementById('max-downloads-section');
        const maxDownloadsValue = document.getElementById('max-downloads-value');
        const maxDownloadsHelp = document.getElementById('max-downloads-help');

        // Custom E2EE UI
        const securityStatus = document.getElementById('security-status');
        const securityIcon = document.getElementById('security-icon');
        const securityText = document.getElementById('security-text');
        const insecureUploadModal = document.getElementById('insecure-upload-modal');
        const confirmInsecureBtn = document.getElementById('confirm-insecure-upload');
        const uploadBtn = document.getElementById('upload-btn');
        const cancelUploadBtn = document.getElementById('cancel-upload-btn');
        const uploadStatus = document.getElementById('upload-status');
        const progressBar = document.getElementById('progress-bar');
        const linkSection = document.getElementById('link-section');
        const downloadLinkInput = document.getElementById('download-link');
        const copyBtn = document.getElementById('copy-btn');

        let serverCapabilities = null;
        let selectedFile = null;
        /** @type {{compatible:boolean, message?:string}} */
        let lastServerCheck = { compatible: false, message: '' };
        let activeUploadSession = null;

        // --- Core client (shared logic for Electron + Web UI) ---
        const clientVersion = await window.electronAPI.getClientVersion();
        const coreClient = new DropgateClient({
            clientVersion,
            logger: (level, message, meta) => {
                // Keep logs useful, but not spammy.
                if (level === 'debug') return;
                const fn = console[level] || console.log;
                fn.call(console, `[core] ${message}`, meta ?? '');
            }
        });

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

        function formatBytes(bytes) {
            if (!Number.isFinite(bytes)) return '0 bytes';
            if (bytes === 0) return '0 bytes';
            const k = 1000;
            const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            const v = bytes / Math.pow(k, i);
            return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
        }

        // --- Initial Settings Load ---
        const settings = await window.electronAPI.getSettings();
        serverUrlInput.value = settings.serverURL || '';

        fileLifetimeValueInput.value = settings.lifetimeValue || 24;
        fileLifetimeUnitSelect.value = settings.lifetimeUnit || 'hours';
        if (fileLifetimeUnitSelect.value === 'unlimited') {
            fileLifetimeValueInput.disabled = true;
            fileLifetimeValueInput.value = 0;
        }

        // Load max downloads preference
        if (settings.maxDownloads) {
            maxDownloadsValue.value = settings.maxDownloads;
        }

        await checkServerCompatibility();

        // --- Event Listeners ---
        const updateLifetimeSettings = () => {
            const isUnlimited = fileLifetimeUnitSelect.value === 'unlimited';
            fileLifetimeValueInput.disabled = isUnlimited;

            if (isUnlimited) {
                fileLifetimeValueInput.value = 0;
            } else {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) {
                    fileLifetimeValueInput.value = 0.5;
                }
            }
            updateUploadButtonState();
            saveSettings();
        };

        const updateMaxDownloadsSettings = () => {
            if (maxDownloadsValue.value === '') {
                maxDownloadsValue.value = 1;
            }
            updateUploadButtonState();
            saveSettings();
        };

        fileLifetimeValueInput.addEventListener('blur', () => updateLifetimeSettings());
        fileLifetimeValueInput.addEventListener('input', () => updateLifetimeSettings());
        fileLifetimeUnitSelect.addEventListener('change', () => updateLifetimeSettings());
        maxDownloadsValue.addEventListener('input', () => updateMaxDownloadsSettings());
        maxDownloadsValue.addEventListener('blur', () => updateMaxDownloadsSettings());

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
                fileChosen.hidden = true;
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

            uploadStatus.textContent = '';
            testConnectionBtn.disabled = true;
            testConnectionBtn.textContent = 'Testing...';
            connectionStatus.textContent = 'Checking server...';
            connectionStatus.className = 'form-text mt-1 text-muted';

            try {
                const serverTarget = parseServerUrl(serverUrl);
                await getServerInfo({ ...serverTarget, timeoutMs: 5000 });

                if (serverTarget.secure) {
                    connectionStatus.textContent = `Connection successful (HTTPS).`;
                    connectionStatus.className = 'form-text mt-1 text-success';
                } else {
                    connectionStatus.textContent = `Connection successful (HTTP) — connection is insecure.`;
                    connectionStatus.className = 'form-text mt-1 text-warning';
                }

                await checkServerCompatibility();
            } catch (error) {
                connectionStatus.textContent = 'Connection failed. Check URL or if server is running.';
                updateUploadabilityState(false);
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
                    {
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
                    }
                case 'success':
                    {
                        const { link } = event.data;
                        downloadLinkInput.value = link;
                        linkSection.style.display = 'block';
                        uploadStatus.textContent = 'Upload successful!';
                        uploadStatus.className = 'form-text mt-1 text-success';
                        resetUI();
                        break;
                    }
                case 'error':
                    {
                        const { error } = event.data;
                        uploadStatus.textContent = `Upload failed: ${error}`;
                        uploadStatus.className = 'form-text mt-1 text-danger';
                        resetUI(false);
                        break;
                    }
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
                // Encryption is auto-determined by server capabilities later

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
                // Trigger the centralised upload function
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
                fileChosen.hidden = true;
                fileInput.value = '';
                uploadBtn.disabled = true;
                return;
            }

            if (file.size === 0) {
                uploadStatus.textContent = 'Error: Cannot upload empty (0 byte) files.';
                uploadStatus.className = 'form-text mt-1 text-danger';
                selectedFile = null;
                fileChosen.hidden = true;
                fileInput.value = '';
                uploadBtn.disabled = true;
                return;
            }

            selectedFile = file;
            fileChosenName.textContent = file.name;
            fileChosenSize.textContent = formatBytes(file.size);
            fileChosen.hidden = false;
            linkSection.style.display = 'none';

            // Only enable upload if all conditions are met
            updateUploadButtonState();
        }

        // Trigger for uploads started from the UI
        uploadBtn.addEventListener('click', performUpload);

        /**
         * The main upload logic.
         * It reports progress and final status back to the main process via IPC.
         */
        async function performUpload() {
            const serverCheck = await checkServerCompatibility();
            if (!serverCheck.compatible) {
                window.electronAPI.uploadFinished({ status: 'error', error: serverCheck.message || 'Server is not compatible.' });
                return;
            }

            if (fileLifetimeUnitSelect.value !== 'unlimited') {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) fileLifetimeValueInput.value = 0.5;
            }

            if (!selectedFile) {
                window.electronAPI.uploadFinished({ status: 'error', error: 'File is missing.' });
                return;
            }

            // Double check lifetime against server before starting
            if (!validateLifetimeInput()) {
                window.electronAPI.uploadFinished({
                    status: 'error',
                    error: uploadStatus.textContent || 'Invalid file lifetime.'
                });
                return;
            }

            const serverUrl = serverUrlInput.value.trim();
            const isTargetSecure = serverUrl.startsWith('https://');
            const hasE2EE = serverCapabilities?.upload?.e2ee && isTargetSecure;

            // Check if E2EE is available - show warning if not
            if (!hasE2EE) {
                // Show the window if it's hidden (background upload) so user can see the modal
                window.electronAPI.showWindow();
                const confirmed = await showInsecureUploadModal();
                if (!confirmed) {
                    window.electronAPI.uploadFinished({
                        status: 'error',
                        error: 'Upload cancelled by user (insecure connection).'
                    });
                    return;
                }
            }

            const encrypt = hasE2EE; // Auto-set encryption based on capability

            const lifetimeMs = getLifetimeInMs();
            saveSettings();

            try {
                const serverTarget = parseServerUrl(serverUrlInput.value.trim());
                const session = await coreClient.uploadFile({
                    ...serverTarget,
                    file: selectedFile,
                    lifetimeMs,
                    maxDownloads: (() => {
                        const val = parseInt(maxDownloadsValue.value, 10);
                        return (Number.isInteger(val) && val >= 0) ? val : 1;
                    })(),
                    encrypt: encrypt,
                    onProgress: (evt) => {
                        const payload = {};
                        if (evt?.text) payload.text = evt.text;
                        if (evt?.percent !== undefined) payload.percent = evt.percent;
                        if (Object.keys(payload).length) window.electronAPI.uploadProgress(payload);
                    },
                    onCancel: () => {
                        uploadStatus.textContent = 'Upload cancelled.';
                        uploadStatus.className = 'form-text mt-1 text-warning';
                        // Swap buttons back
                        uploadBtn.style.display = 'block';
                        cancelUploadBtn.style.display = 'none';
                        activeUploadSession = null;
                        resetUI(false);
                    }
                });

                // Store session and swap buttons
                activeUploadSession = session;
                uploadBtn.style.display = 'none';
                cancelUploadBtn.style.display = 'block';

                // Wire up cancel button
                cancelUploadBtn.onclick = () => {
                    if (activeUploadSession) {
                        activeUploadSession.cancel('User cancelled upload.');
                        activeUploadSession = null;
                        cancelUploadBtn.style.display = 'none';
                        uploadBtn.style.display = 'block';
                    }
                };

                const result = await session.result;

                // Swap buttons back on success
                uploadBtn.style.display = 'block';
                cancelUploadBtn.style.display = 'none';
                activeUploadSession = null;

                window.electronAPI.uploadFinished({ status: 'success', link: result.downloadUrl });
            } catch (error) {
                // Swap buttons back on error
                uploadBtn.style.display = 'block';
                cancelUploadBtn.style.display = 'none';
                activeUploadSession = null;

                window.electronAPI.uploadFinished({
                    status: 'error',
                    error: error?.message || String(error)
                });
            }
        }

        // --- Utility Functions ---

        /**
         * Update the security status card based on E2EE and HTTPS availability.
         */
        function updateSecurityStatus() {
            if (!securityStatus || !securityIcon || !securityText) return;
            // Electron context note: window.isSecureContext can be true for localhost http,
            // but for real security we care about HTTPS or just trusting the capability check context if local.
            // For simplicity, we trust the server capability flag + check protocol if remote.

            // In Electron renderer, location.protocol serves file:// usually or http/https if loaded remotely.
            // But here we are making requests to 'serverUrlInput.value'.
            // So we need to check the active server URL protocol.
            const serverUrl = serverUrlInput.value.trim();
            const isTargetSecure = serverUrl.startsWith('https://');
            const hasE2EE = serverCapabilities?.upload?.e2ee && isTargetSecure;

            if (hasE2EE) {
                // Green: Full E2EE
                securityIcon.textContent = 'verified';
                securityIcon.className = 'material-icons-round text-success';
                securityText.textContent = 'Your upload will be end-to-end encrypted.';
                securityStatus.className = 'security-status-card security-green mb-3';
            } else if (isTargetSecure) {
                // Yellow: HTTPS but no E2EE
                securityIcon.textContent = 'warning';
                securityIcon.className = 'material-icons-round text-warning';
                securityText.textContent = "This server doesn't support encryption. Your upload is protected in transit via HTTPS.";
                securityStatus.className = 'security-status-card security-yellow mb-3';
            } else {
                // Red: HTTP, no encryption at all
                securityIcon.textContent = 'gpp_bad';
                securityIcon.className = 'material-icons-round text-danger';
                securityText.textContent = 'This connection is not secure. Your upload will not be encrypted.';
                securityStatus.className = 'security-status-card security-red mb-3';
            }
        }

        /**
         * Show the insecure upload warning modal and return a promise.
         * @returns {Promise<boolean>} True if user confirms, false if cancelled.
         */
        function showInsecureUploadModal() {
            return new Promise((resolve) => {
                if (!insecureUploadModal) {
                    resolve(true);
                    return;
                }

                const modal = new bootstrap.Modal(insecureUploadModal);

                const cleanup = () => {
                    confirmInsecureBtn?.removeEventListener('click', onConfirm);
                    insecureUploadModal.removeEventListener('hidden.bs.modal', onHide);
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

                confirmInsecureBtn?.addEventListener('click', onConfirm, { once: true });
                insecureUploadModal.addEventListener('hidden.bs.modal', onHide, { once: true });

                modal.show();
            });
        }

        function saveSettings() {
            window.electronAPI.setSettings({
                serverURL: serverUrlInput.value,
                lifetimeValue: fileLifetimeValueInput.value,
                lifetimeUnit: fileLifetimeUnitSelect.value,
                maxDownloads: maxDownloadsValue.value
            });
        }

        function getLifetimeInMs() {
            const unit = fileLifetimeUnitSelect.value;
            if (unit === 'unlimited') return 0;
            const value = parseFloat(fileLifetimeValueInput.value);
            return lifetimeToMs(value, unit);
        }

        async function checkServerCompatibility() {
            uploadStatus.textContent = '';
            const inputUrl = serverUrlInput.value.trim();
            if (!inputUrl) {
                const message = 'No server URL provided.';
                uploadStatus.textContent = message;
                uploadStatus.className = 'form-text mt-1 text-warning';
                uploadBtn.disabled = true;
                lastServerCheck = { compatible: false, message };
                return lastServerCheck;
            }

            try {
                // Auto-detect protocol if missing
                let targetUrl = inputUrl;
                let autoAddedProtocol = false;

                if (!inputUrl.match(/^https?:\/\//i)) {
                    targetUrl = 'https://' + inputUrl;
                    autoAddedProtocol = true;
                }

                let serverTarget = parseServerUrl(targetUrl);
                let compat;

                try {
                    compat = await coreClient.checkCompatibility({ ...serverTarget, timeoutMs: 5000 });

                    // If we auto-added https and it worked, update the input
                    if (autoAddedProtocol) {
                        serverUrlInput.value = targetUrl;
                        // serverTarget is already correct
                    }
                } catch (err) {
                    // If we guessed HTTPS and it failed, try HTTP
                    if (autoAddedProtocol) {
                        console.log('HTTPS auto-detect failed, falling back to HTTP...');
                        targetUrl = 'http://' + inputUrl;
                        serverTarget = parseServerUrl(targetUrl);
                        compat = await coreClient.checkCompatibility({ ...serverTarget, timeoutMs: 5000 });

                        // If this worked, update the input
                        serverUrlInput.value = targetUrl;
                    } else {
                        // User specified protocol or we failed both
                        throw err;
                    }
                }

                const { serverInfo } = compat;

                if (!serverInfo || !serverInfo?.version || !serverInfo?.capabilities) {
                    const message = 'Error: Cannot determine server version or capabilities.';
                    uploadStatus.textContent = message;
                    uploadStatus.className = 'form-text mt-1 text-danger';
                    uploadBtn.disabled = true;
                    lastServerCheck = { compatible: false, message };
                    return lastServerCheck;
                }

                serverCapabilities = serverInfo.capabilities;

                // Check if uploads are explicitly disabled by the server
                if (serverCapabilities.upload && serverCapabilities.upload.enabled === false) {
                    const message = 'File uploads are disabled on this server.';
                    updateUploadabilityState(false, message);
                    lastServerCheck = { compatible: false, message };
                    return lastServerCheck;
                } else {
                    updateUploadabilityState(true);
                }

                applyServerLimits();

                if (!compat.compatible) {
                    uploadBtn.disabled = true;
                    uploadStatus.textContent = compat.message;
                    uploadStatus.className = 'form-text mt-1 text-danger';
                    lastServerCheck = { compatible: false, message: compat.message };
                    return lastServerCheck;
                }

                // compatible
                uploadStatus.textContent = compat.message;

                // warning when client is newer
                if (compat.message.toLowerCase().includes('newer')) {
                    uploadStatus.className = 'form-text mt-1 text-warning';
                } else {
                    uploadStatus.className = 'form-text mt-1 text-info';
                }

                // Update button state based on all factors
                lastServerCheck = { compatible: true, message: compat.message };
                updateUploadButtonState();

                return lastServerCheck;
            } catch (error) {
                const message = 'Could not connect to the server.';
                uploadStatus.textContent = message;
                uploadStatus.className = 'form-text mt-1 text-danger';
                uploadBtn.disabled = true;
                console.error('Compatibility check failed:', error);
                lastServerCheck = { compatible: false, message };
                updateUploadabilityState(false, message);
                return lastServerCheck;
            }
        }

        function validateLifetimeInput() {
            if (!serverCapabilities || !serverCapabilities.upload) return true;

            const limitHours = serverCapabilities.upload.maxLifetimeHours;
            const unit = fileLifetimeUnitSelect.value;

            // If server allows unlimited, and user selected unlimited, we are good.
            if (limitHours === 0 && unit === 'unlimited') {
                fileLifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
                fileLifetimeHelp.className = 'form-text mt-1 text-muted';
                return true;
            }

            // If user selected unlimited but server forbids it
            if (limitHours > 0 && unit === 'unlimited') {
                fileLifetimeUnitSelect.value = 'hours';
                fileLifetimeValueInput.disabled = false;
            }

            const currentMs = getLifetimeInMs();
            const limitMs = limitHours * 60 * 60 * 1000;

            if (limitHours > 0 && currentMs > limitMs) {
                fileLifetimeHelp.textContent = `File lifetime too long. Server limit: ${limitHours} hours.`;
                fileLifetimeHelp.className = 'form-text mt-1 text-danger';
                return false;
            } else {
                // Valid
                if (limitHours === 0) {
                    fileLifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
                } else {
                    fileLifetimeHelp.textContent = `Max lifetime: ${limitHours} hours.`;
                }
                fileLifetimeHelp.className = 'form-text mt-1 text-muted';

                return true;
            }
        }

        function validateMaxDownloadsInput() {
            if (!serverCapabilities || !serverCapabilities.upload) return true;

            const maxFileDownloads = serverCapabilities.upload.maxFileDownloads ?? 1;
            const value = parseInt(maxDownloadsValue.value, 10);

            // Handle invalid input
            if (isNaN(value) || value < 0) {
                maxDownloadsHelp.textContent = 'Max downloads must be a non-negative number.';
                maxDownloadsHelp.className = 'form-text mt-1 text-danger';
                return false;
            }

            // Server allows unlimited (0) - any value is valid
            if (maxFileDownloads === 0) {
                maxDownloadsHelp.textContent = '0 = unlimited downloads';
                maxDownloadsHelp.className = 'form-text mt-1 text-muted'; // or text-body-secondary
                return true;
            }

            // Server has limit of 1 - input should be disabled anyway (handled by applyServerLimits)
            if (maxFileDownloads === 1) {
                maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
                maxDownloadsHelp.className = 'form-text mt-1 text-muted';
                return true;
            }

            // Server has limit > 1
            if (value === 0) {
                maxDownloadsHelp.textContent = `0 (unlimited) not allowed. Server limit: ${maxFileDownloads} downloads.`;
                maxDownloadsHelp.className = 'form-text mt-1 text-danger';
                return false;
            }

            if (value > maxFileDownloads) {
                maxDownloadsHelp.textContent = `Exceeds server limit of ${maxFileDownloads} downloads.`;
                maxDownloadsHelp.className = 'form-text mt-1 text-danger';
                return false;
            }

            // Valid
            maxDownloadsHelp.textContent = `Max: ${maxFileDownloads} downloads`;
            maxDownloadsHelp.className = 'form-text mt-1 text-muted';

            return true;
        }

        function updateUploadButtonState() {
            // Check all validity conditions
            const isLifetimeValid = validateLifetimeInput();
            const isDownloadsValid = validateMaxDownloadsInput();
            const isServerCompatible = lastServerCheck.compatible;
            const isFileSelected = !!selectedFile;

            if (isFileSelected && isServerCompatible && isLifetimeValid && isDownloadsValid) {
                uploadBtn.disabled = false;
            } else {
                uploadBtn.disabled = true;
            }
        }

        // Update UI based on whether uploads are enabled
        function updateUploadabilityState(enabled, message = '') {
            if (!enabled) {
                if (message) {
                    uploadStatus.textContent = message;
                    uploadStatus.className = 'form-text mt-1 text-danger';
                }

                // Clear loading text and hide security badge
                fileLifetimeHelp.textContent = '';
                maxDownloadsHelp.textContent = '';
                maxUploadHint.textContent = '';
                securityStatus.style.display = 'none';

                // Disable UI interactions
                uploadBtn.disabled = true;
                selectFileBtn.disabled = true;
                dropZone.style.opacity = '0.5';
                dropZone.style.pointerEvents = 'none';

                // Disable inputs
                fileLifetimeValueInput.disabled = true;
                fileLifetimeUnitSelect.disabled = true;
                maxDownloadsValue.disabled = true;
            } else {
                // Re-enable UI
                selectFileBtn.disabled = false;
                dropZone.style.opacity = '1';
                dropZone.style.pointerEvents = 'auto';
                securityStatus.style.display = 'flex'; // Restore if enabled

                // Inputs will be further refined by applyServerLimits, but enable them generally here
                fileLifetimeValueInput.disabled = false;
                fileLifetimeUnitSelect.disabled = false;
                maxDownloadsValue.disabled = false;
            }
        }

        // Apply server-enforced limits to the UI
        function applyServerLimits() {
            if (!serverCapabilities || !serverCapabilities.upload) return;

            const limitHours = serverCapabilities.upload.maxLifetimeHours;
            const unlimitedOption = fileLifetimeUnitSelect.querySelector('option[value="unlimited"]');

            if (limitHours > 0) {
                // Server has a limit: Disable "Unlimited"
                if (unlimitedOption) {
                    unlimitedOption.disabled = true;
                    unlimitedOption.textContent = 'Unlimited (Disabled by Server)';
                }

                // If currently selected is unlimited, switch to hours
                if (fileLifetimeUnitSelect.value === 'unlimited') {
                    fileLifetimeUnitSelect.value = 'hours';
                    fileLifetimeValueInput.disabled = false;
                    fileLifetimeValueInput.value = Math.min(24, limitHours);
                }
            } else {
                // Server allows unlimited
                if (unlimitedOption) {
                    unlimitedOption.disabled = false;
                    unlimitedOption.textContent = 'Unlimited';
                }
            }

            // Update max upload size hint
            const maxSizeBytes = serverCapabilities.upload.maxSizeMB * 1000 * 1000;
            if (maxSizeBytes === 0) {
                maxUploadHint.textContent = 'You can upload files of any size.';
            } else {
                maxUploadHint.textContent = `Max upload size: ${formatBytes(maxSizeBytes)}.`;
            }

            // Update Security Status UI (Auto-managed E2EE)
            updateSecurityStatus();

            // Max Downloads UI
            const maxFileDownloads = serverCapabilities.upload.maxFileDownloads ?? 1;

            // Get current value (loaded from settings or user input)
            let currentValue = parseInt(maxDownloadsValue.value, 10);
            if (isNaN(currentValue)) currentValue = 1;

            if (maxFileDownloads === 1) {
                // Server forces single-download: disable input
                maxDownloadsValue.value = '1';
                maxDownloadsValue.min = '1';
                maxDownloadsValue.disabled = true;
                maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
            } else if (maxFileDownloads === 0) {
                // Server allows unlimited
                maxDownloadsValue.disabled = false;
                maxDownloadsValue.min = '0';
                maxDownloadsHelp.textContent = '0 = unlimited downloads';
            } else {
                // Server has a limit > 1 (0 is not allowed)
                maxDownloadsValue.disabled = false;
                maxDownloadsValue.min = '1';
                maxDownloadsHelp.textContent = `Max: ${maxFileDownloads} downloads`;

                // Auto-clamp if needed (if current is 0/unlimited or exceeds limit)
                if (currentValue === 0 || currentValue > maxFileDownloads) {
                    maxDownloadsValue.value = String(maxFileDownloads);
                }
            }

            // Re-validate current inputs
            validateLifetimeInput();
        }

        // Helper to reset the UI state after an upload completes or fails
        function resetUI(clearFile = true) {
            uploadBtn.textContent = 'Upload';
            if (clearFile) {
                selectedFile = null;
                fileChosen.hidden = true;
                fileInput.value = '';
                uploadBtn.disabled = true;
            } else {
                // Keep disabled state consistent with current server compatibility + lifetime limits
                updateUploadButtonState();
            }

            setTimeout(() => {
                progressBar.style.width = '0%';
                progressBar.setAttribute('aria-valuenow', 0);
                progressBar.textContent = '';
            }, 3000);
        }

        window.electronAPI.rendererReady();
    } catch (error) {
        console.error('FATAL ERROR in renderer initialisation:', error);
        alert('Fatal error initialising renderer: ' + error.message);
    }
});

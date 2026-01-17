const log = (level, message) => {
    const lvl = String(level || '').toLowerCase();
    const prefix = `[${new Date().toISOString()}] [${String(level).toUpperCase()}]`;
    const out = `${prefix} ${message}`;
    if (lvl === 'error') return console.error(out);
    if (lvl === 'warn') return console.warn(out);
    if (lvl === 'info') return console.info(out);
    return console.log(out);
};

log('info', 'Shadownloader Server is starting...');

const { version } = require('./package.json');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const helmet = require('helmet').default;
const cors = require('cors');
const contentDisposition = require('content-disposition');
const { FSDB } = require('file-system-db');
const { renderFile: renderEjsFile } = require('./lib/ejs-lite');
const { v4: uuidv4 } = require('uuid');

const serverName = process.env.SERVER_NAME || 'Shadownloader Server';
log('info', `Server name: ${serverName}`);

const enableWebUI = process.env.ENABLE_WEB_UI !== 'false';
const enableP2P = process.env.ENABLE_P2P !== 'false';
const enableUpload = process.env.ENABLE_UPLOAD === 'true';
log('info', `Web UI Enabled: ${enableWebUI}`);
log('info', `Peer-to-Peer (P2P) Enabled: ${enableP2P}`);
log('info', `Upload Protocol Enabled: ${enableUpload}`);

const uploadEnableE2EE = process.env.UPLOAD_ENABLE_E2EE !== 'false';
log('info', `Upload End-to-End Encryption (E2EE) Enabled: ${uploadEnableE2EE}`);

if (enableUpload && uploadEnableE2EE) {
    log('warn', 'Upload E2EE is enabled. The server MUST be running behind a reverse proxy that provides a secure HTTPS connection.');
    log('warn', 'Failure to provide a secure context will cause client-side decryption to fail in the browser.');
}

const app = express();
const port = 52443;

const uploadDir = path.join(__dirname, 'uploads');
const tmpDir = path.join(__dirname, 'uploads', 'tmp');

const cleanupDir = (dirPath) => {
    if (fs.existsSync(dirPath)) {
        log('info', `Cleaning directory: ${dirPath}`);
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            fs.rmSync(path.join(dirPath, file), { recursive: true, force: true });
        }
    }
};

const createDirIfNotExists = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const getDirSize = (dirPath) => {
    let size = 0;
    if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) size += getDirSize(filePath);
            else size += stats.size;
        }
    }
    return size;
};

let preserveUploads = false;
let maxFileSizeMB = 0;
let maxStorageGB = 0;
let maxFileLifetimeHours = 0;
let MAX_FILE_SIZE_BYTES = Infinity;
let MAX_STORAGE_BYTES = Infinity;
let MAX_FILE_LIFETIME_MS = Infinity;
let currentDiskUsage = 0;
let fileDatabase = null;
let ongoingUploads = null;

if (enableUpload) {
    preserveUploads = process.env.UPLOAD_PRESERVE_UPLOADS === 'true';
    log('info', `UPLOAD_PRESERVE_UPLOADS: ${preserveUploads}`);

    maxFileSizeMB = process.env.UPLOAD_MAX_FILE_SIZE_MB ? process.env.UPLOAD_MAX_FILE_SIZE_MB : 100;
    if (isNaN(maxFileSizeMB) || maxFileSizeMB < 0 || !Number.isInteger(Number(maxFileSizeMB))) {
        log('error', 'Invalid UPLOAD_MAX_FILE_SIZE_MB environment variable. It must be a non-negative integer.');
        process.exit(1);
    }

    maxFileSizeMB = Number(maxFileSizeMB);
    MAX_FILE_SIZE_BYTES = maxFileSizeMB === 0 ? Infinity : maxFileSizeMB * 1024 * 1024;
    log('info', `UPLOAD_MAX_FILE_SIZE_MB: ${maxFileSizeMB} MB`);
    if (Number(maxFileSizeMB) === 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is set to 0! Files of any size can be uploaded.');
    }

    maxStorageGB = process.env.UPLOAD_MAX_STORAGE_GB ? process.env.UPLOAD_MAX_STORAGE_GB : 10;
    if (isNaN(maxStorageGB) || maxStorageGB < 0) {
        log('error', 'Invalid UPLOAD_MAX_STORAGE_GB environment variable. It must be a non-negative number.');
        process.exit(1);
    }

    maxStorageGB = Number(maxStorageGB);
    MAX_STORAGE_BYTES = maxStorageGB === 0 ? Infinity : maxStorageGB * 1024 * 1024 * 1024;
    log('info', `UPLOAD_MAX_STORAGE_GB: ${maxStorageGB} GB`);
    if (Number(maxStorageGB) === 0) {
        log('warn', 'UPLOAD_MAX_STORAGE_GB is set to 0! Consider setting a limit on total storage used by uploaded files to prevent disk exhaustion.');
    }

    if (maxFileSizeMB > (maxStorageGB * 1024) && maxStorageGB !== 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is larger than UPLOAD_MAX_STORAGE_GB! Any uploads larger than the allocated storage quota will be rejected.');
    }

    maxFileLifetimeHours = process.env.UPLOAD_MAX_FILE_LIFETIME_HOURS ? process.env.UPLOAD_MAX_FILE_LIFETIME_HOURS : 24;
    if (isNaN(maxFileLifetimeHours) || maxFileLifetimeHours < 0) {
        log('error', 'Invalid UPLOAD_MAX_FILE_LIFETIME_HOURS environment variable. It must be a non-negative number.');
        process.exit(1);
    }

    maxFileLifetimeHours = Number(maxFileLifetimeHours);
    MAX_FILE_LIFETIME_MS = maxFileLifetimeHours === 0 ? Infinity : maxFileLifetimeHours * 60 * 60 * 1000;
    log('info', `UPLOAD_MAX_FILE_LIFETIME_HOURS: ${maxFileLifetimeHours} hours`);
    if (Number(maxFileLifetimeHours) === 0) {
        log('warn', 'UPLOAD_MAX_FILE_LIFETIME_HOURS is set to 0! Files will never expire.');
    }

    if (!preserveUploads) {
        log('info', 'Clearing any existing uploads on startup...');
        cleanupDir(uploadDir);
    }
    log('info', 'Clearing any zombie uploads and temp files...');
    cleanupDir(tmpDir);

    createDirIfNotExists(uploadDir);
    createDirIfNotExists(tmpDir);

    currentDiskUsage = getDirSize(uploadDir);
    setInterval(() => { currentDiskUsage = getDirSize(uploadDir); }, 300000); // Sync every 5 minutes in case of discrepancies
    if (maxStorageGB !== 0) {
        log('info', `Current disk usage: ${(currentDiskUsage / 1024 / 1024 / 1024).toFixed(2)} GB / ${maxStorageGB} GB`);
    }

    fileDatabase = preserveUploads ? new FSDB(path.join(__dirname, 'uploads', 'db', 'file-database.json')) : new Map();
    ongoingUploads = new Map();
    log('info', `File database is ready. (${preserveUploads ? 'persistent' : 'in-memory'})`);
} else {
    log('info', 'Upload protocol disabled. Removing upload storage directories if present.');
    fs.rmSync(uploadDir, { recursive: true, force: true });
}
log('info', 'Configuring server endpoints and middleware...');

app.set('trust proxy', 1); // Trust the first hop from a reverse proxy
app.engine('ejs', renderEjsFile);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

// Use Helmet for security headers, but leave HSTS to the reverse proxy.
app.use(
    helmet({
        hsts: false, // HSTS should be handled by the reverse proxy
        crossOriginOpenerPolicy: false,
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'upgrade-insecure-requests': null, // This should also be managed by the proxy
                'script-src': ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
                'frame-src': ["'self'", 'https://jimmywarting.github.io'], // For streamSaver
            },
        },
    })
);


const rateLimitWindowMs = process.env.RATE_LIMIT_WINDOW_MS ? process.env.RATE_LIMIT_WINDOW_MS : 60000;
const rateLimitMaxRequests = process.env.RATE_LIMIT_MAX_REQUESTS ? process.env.RATE_LIMIT_MAX_REQUESTS : 25;
if (isNaN(rateLimitWindowMs) || rateLimitWindowMs < 0 || !Number.isInteger(Number(rateLimitWindowMs))) {
    log('error', 'Invalid RATE_LIMIT_WINDOW_MS environment variable. It must be a non-negative integer.');
    process.exit(1);
}
if (isNaN(rateLimitMaxRequests) || rateLimitMaxRequests < 0 || !Number.isInteger(Number(rateLimitMaxRequests))) {
    log('error', 'Invalid RATE_LIMIT_MAX_REQUESTS environment variable. It must be a non-negative integer.');
    process.exit(1);
}

if (Number(rateLimitMaxRequests) === 0) {
    log('warn', 'RATE_LIMIT_MAX_REQUESTS is set to 0! Rate limiting is disabled.');
}

if (Number(rateLimitWindowMs) === 0) {
    log('warn', 'RATE_LIMIT_WINDOW_MS is set to 0! Rate limiting is disabled.');
}

log('info', `RATE_LIMIT_WINDOW_MS: ${rateLimitWindowMs} ms`);
log('info', `RATE_LIMIT_MAX_REQUESTS: ${rateLimitMaxRequests} requests`);
let limiter = (_req, _res, next) => next();
if (Number(rateLimitMaxRequests) > 0 && Number(rateLimitWindowMs) > 0) {
    limiter = rateLimit({
        windowMs: Number(rateLimitWindowMs),
        max: Number(rateLimitMaxRequests),
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests, please try again later.' },
    });
}

// Verify chunk uploads are valid, otherwise apply rate limiting
const apiRouter = express.Router();
const uploadRouter = express.Router();

let uploadAuth = null;

if (enableUpload) {
    uploadAuth = (req, res, next) => {
        const uploadId = req.headers['x-upload-id'] || req.body?.uploadId;
        if (uploadId && ongoingUploads.has(uploadId)) {
            return next();
        }
        return limiter(req, res, next);
    };

    uploadRouter.post('/init', limiter, (req, res) => {
        const uploadId = uuidv4();
        const { filename, lifetime, isEncrypted, totalSize, totalChunks } = req.body;

        if (isEncrypted && !uploadEnableE2EE) {
            log('warn', 'Rejected an E2EE upload attempt because upload E2EE is disabled on the server.');
            return res.status(400).json({ error: 'End-to-end encryption is not supported on this server.' });
        }

        // Validate filename
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid filename. Must be a non-empty string.' });
        }

        // Validate isEncrypted (must be a boolean)
        if (typeof isEncrypted !== 'boolean') {
            return res.status(400).json({ error: 'Invalid isEncrypted. Must be a boolean.' });
        }

        // Validate file lifetime
        if (typeof lifetime !== 'number' || !Number.isInteger(lifetime) || lifetime < 0) {
            return res.status(400).json({ error: 'Invalid lifetime. Must be a non-negative integer (milliseconds).' });
        }

        // Validate Reservation Data
        const size = parseInt(totalSize);
        const chunks = parseInt(totalChunks);
        if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return res.status(400).json({ error: 'Invalid total size. Must be a positive integer.' });
        if (typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks <= 0) return res.status(400).json({ error: 'Invalid chunk count. Must be a positive integer.' });

        // Check File Limit
        if (size > MAX_FILE_SIZE_BYTES) {
            return res.status(413).json({ error: `File exceeds limit of ${maxFileSizeMB} MB.` });
        }

        // Validate lifetime against max
        if (MAX_FILE_LIFETIME_MS !== Infinity) {
            if (lifetime === 0) {
                return res.status(400).json({ error: `Server does not allow unlimited file lifetime. Max: ${maxFileLifetimeHours} hours.` });
            }
            if (lifetime > MAX_FILE_LIFETIME_MS) {
                return res.status(400).json({ error: `File lifetime exceeds limit of ${maxFileLifetimeHours} hours.` });
            }
        }

        // Check Storage Quota
        // Calculate reserved space from active uploads
        let reservedSpace = 0;
        ongoingUploads.forEach(u => reservedSpace += u.reservedBytes || 0);

        if ((currentDiskUsage + reservedSpace + size) > MAX_STORAGE_BYTES) {
            log('warn', `Upload rejected due to insufficient storage. Current usage: ${(currentDiskUsage / 1024 / 1024 / 1024).toFixed(2)} GB, Reserved: ${(reservedSpace / 1024 / 1024 / 1024).toFixed(2)} GB, Requested: ${(size / 1024 / 1024 / 1024).toFixed(2)} GB.`);
            return res.status(507).json({ error: 'Server out of capacity. Try again later.' });
        }

        // Validate filename if not encrypted
        if (!isEncrypted) {
            if (filename.length > 255 || /[\/\\]/.test(filename)) {
                return res.status(400).json({ error: 'Invalid filename. Contains illegal characters or is too long.' });
            }
        }

        const tempFilePath = path.join(tmpDir, uploadId);
        fs.writeFileSync(tempFilePath, '');

        ongoingUploads.set(uploadId, {
            filename,
            isEncrypted,
            lifetime: Number(lifetime) || 0,
            tempFilePath,
            totalSize: size, // Expected final size
            totalChunks: chunks, // Expected chunk count
            receivedChunks: new Set(),
            reservedBytes: size, // Amount to reserve
            expiresAt: Date.now() + (2 * 60 * 1000) // 2 minute initial deadline
        });

        log('info', `Initialised upload. Reserved ${(size / 1024 / 1024).toFixed(2)} MB.`);
        res.status(200).json({ uploadId });
    });

    uploadRouter.post('/chunk', uploadAuth, (req, res) => {
        const uploadId = req.headers['x-upload-id'];
        let chunkIndex = req.headers['x-chunk-index'];
        const clientHash = req.headers['x-chunk-hash'];

        if (!ongoingUploads.has(uploadId)) return res.status(410).send('Upload session expired or invalid.');
        const session = ongoingUploads.get(uploadId);

        // Validate Index
        if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
            return res.status(400).send('Invalid chunk index.');
        }

        chunkIndex = parseInt(chunkIndex);

        // Validate Hash
        if (typeof clientHash !== 'string' || !/^[a-f0-9]{64}$/.test(clientHash)) { // SHA-256 hash format
            return res.status(400).send('Invalid chunk hash.');
        }

        if (session.receivedChunks.has(chunkIndex)) return res.status(200).send('Chunk already received.');

        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            log('info', `Received chunk ${chunkIndex + 1}/${session.totalChunks} for: ${uploadId}. Size: ${(buffer.length / 1024).toFixed(2)} KB`);

            // 1. Verify Size (5MB + Overhead limit)
            if (buffer.length > (5 * 1024 * 1024) + 1024) return res.status(413).send('Chunk too large.');

            // 2. Verify Integrity
            const serverHash = crypto.createHash('sha256').update(buffer).digest('hex');
            if (serverHash !== clientHash) return res.status(400).send('Integrity check failed.');

            // Calculate Offset
            // If encrypted, every chunk (except last) is 5MB + 28 bytes. If plain, 5MB.
            const CHUNK_BASE = 5 * 1024 * 1024;
            const OVERHEAD = session.isEncrypted ? 28 : 0;
            const OFFSET = chunkIndex * (CHUNK_BASE + OVERHEAD);

            // Write
            fs.open(session.tempFilePath, 'r+', (err, fd) => {
                if (err) return res.status(500).send('File IO error.');
                fs.write(fd, buffer, 0, buffer.length, OFFSET, (writeErr) => {
                    fs.close(fd, () => { });
                    if (writeErr) return res.status(500).send('Write failed.');

                    session.receivedChunks.add(chunkIndex);
                    session.expiresAt = Date.now() + (2 * 60 * 1000); // Reset timeout to 2 mins
                    res.status(200).send('Chunk received.');
                });
            });
        });
    });

    uploadRouter.post('/complete', uploadAuth, (req, res) => {
        const { uploadId } = req.body;
        if (!ongoingUploads.has(uploadId)) return res.status(400).json({ error: 'Invalid upload ID.' });

        const session = ongoingUploads.get(uploadId);

        // 1. Verify Chunk Count
        // We expect exactly N unique chunks.
        if (session.receivedChunks.size !== session.totalChunks) {
            log('warn', `Upload ${uploadId} incomplete: ${session.receivedChunks.size}/${session.totalChunks} chunks.`);

            return res.status(400).json({
                error: `Upload incomplete. Server received ${session.receivedChunks.size} of ${session.totalChunks} chunks.`
            });
        }

        const uploadInfo = ongoingUploads.get(uploadId);
        const fileId = uuidv4();
        const finalPath = path.join(uploadDir, fileId);

        try {
            const stats = fs.statSync(uploadInfo.tempFilePath);
            if (stats.size === 0) {
                log('warn', `Rejected 0-byte file upload for ID: ${uploadId}`);
                fs.rmSync(uploadInfo.tempFilePath, { force: true }); // Clean up the empty temp file
                ongoingUploads.delete(uploadId);
                return res.status(400).json({ error: 'Empty files (0 bytes) cannot be uploaded.' });
            } else if (stats.size !== uploadInfo.totalSize) {
                log('warn', `Upload size mismatch for ID: ${uploadId}. Expected: ${uploadInfo.totalSize}, Actual: ${stats.size}`);
                fs.rmSync(uploadInfo.tempFilePath, { force: true }); // Clean up the invalid temp file
                ongoingUploads.delete(uploadId);
                return res.status(400).json({ error: 'Uploaded rejected. File size does not match expected size.' });
            }
        } catch (e) {
            log('error', `Could not stat temp file for size check: ${e.message}`);
            ongoingUploads.delete(uploadId);
            fs.rmSync(uploadInfo.tempFilePath, { force: true }); // Attempt to clean up
            return res.status(500).json({ error: 'Server error during file validation.' });
        }

        fs.renameSync(uploadInfo.tempFilePath, finalPath);

        const stats = fs.statSync(finalPath); // Get final size
        currentDiskUsage += stats.size; // Update global usage

        const expiresAt = uploadInfo.lifetime > 0 ? Date.now() + uploadInfo.lifetime : null;

        fileDatabase.set(fileId, {
            name: uploadInfo.filename,
            path: finalPath,
            expiresAt: expiresAt,
            isEncrypted: uploadInfo.isEncrypted,
        });

        ongoingUploads.delete(uploadId); // Remove the reservation
        log('info', `[${uploadInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File received.${maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / 1024 / 1024 / 1024).toFixed(2)} GB / ${maxStorageGB} GB.` : ''}`);
        res.status(200).json({ id: fileId });
    });

    apiRouter.get('/file/:fileId/meta', limiter, (req, res) => {
        const fileId = req.params.fileId;
        const fileInfo = fileDatabase.get(fileId);

        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found.' });
        }

        if (fileInfo.isEncrypted && !uploadEnableE2EE) {
            return res.status(404).json({ error: 'File not found.' });
        }

        let fileSize = 0;
        try {
            fileSize = fs.statSync(fileInfo.path).size;
        } catch (error) {
            return res.status(404).json({ error: 'File not found.' });
        }

        const payload = {
            sizeBytes: fileSize,
            isEncrypted: fileInfo.isEncrypted
        };

        if (fileInfo.isEncrypted) {
            payload.encryptedFilename = fileInfo.name;
        } else {
            payload.filename = fileInfo.name;
        }

        res.status(200).json(payload);
    });

    apiRouter.get('/file/:fileId', limiter, (req, res) => {
        const fileId = req.params.fileId;
        const fileInfo = fileDatabase.get(fileId);

        if (!fileInfo) {
            return res.status(404).json({ error: 'File not found.' });
        }

        if (fileInfo.isEncrypted && !uploadEnableE2EE) {
            return res.status(404).json({ error: 'File not found.' });
        }

        // Capture size before streaming
        const fileSize = fs.statSync(fileInfo.path).size;
        res.setHeader('Content-Length', fileSize);

        if (!fileInfo.isEncrypted) {
            res.setHeader('Content-Disposition', contentDisposition(fileInfo.name));
            res.setHeader('Content-Type', 'application/octet-stream');
        }

        const readStream = fs.createReadStream(fileInfo.path);
        readStream.pipe(res);

        readStream.on('close', () => {
            // Update storage immediately
            currentDiskUsage = Math.max(0, currentDiskUsage - fileSize);

            fs.rm(fileInfo.path, { force: true }, () => { });
            fileDatabase.delete(fileId);
            log('info', `[${fileInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File data sent and deleted.${maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / 1024 / 1024 / 1024).toFixed(2)} GB / ${maxStorageGB} GB.` : ''}`);
        });
    });
}

const getCapabilities = () => {
    const uploadCapabilities = { enabled: enableUpload };
    if (enableUpload) {
        uploadCapabilities.maxSizeMB = maxFileSizeMB;
        uploadCapabilities.maxLifetimeHours = maxFileLifetimeHours;
        uploadCapabilities.e2ee = uploadEnableE2EE;
    }

    return {
        upload: uploadCapabilities,
        p2p: {
            enabled: enableP2P
        },
        webUI: {
            enabled: enableWebUI
        }
    };
};

apiRouter.get('/info', limiter, (req, res) => {
    res.status(200).json({
        name: serverName,
        version: version,
        capabilities: getCapabilities()
    });
});

app.use('/api', apiRouter);
if (enableUpload) {
    app.use('/upload', uploadRouter);

    app.get('/:fileId', limiter, (req, res) => {
        const sendHTML = (htmlFilePath, status) => {
            const nonce = res.locals.nonce;
            return fs.readFile(htmlFilePath, 'utf8', (err, data) => {
                if (err) {
                    log('error', `Failed to read ${path.basename(htmlFilePath)}: ${err.message}`);
                    return res.status(500).send('Server error');
                }
                const modifiedHtml = data.replace(/%%NONCE%%/g, nonce);
                res.status(status).setHeader('Content-Type', 'text/html').send(modifiedHtml);
            });
        };

        const fileId = req.params.fileId;
        const fileInfo = fileDatabase.get(fileId);

        if (!fileInfo) return sendHTML(path.join(__dirname, 'public', '404.html'), 404);

        if (fileInfo.isEncrypted) {
            if (!uploadEnableE2EE) {
                log('warn', 'Blocked access to an encrypted file because upload E2EE is disabled.');
                return sendHTML(path.join(__dirname, 'public', '404.html'), 404);
            }

            // The Web Crypto API requires a secure context (HTTPS).
            // If we are behind a reverse proxy, check if the original request was secure.
            if (req.protocol !== 'https') {
                log('warn', 'Blocked access to an encrypted file over an insecure connection (HTTP).');
                return sendHTML(path.join(__dirname, 'public', 'insecure.html'), 400);
            }
        }

        return res.status(200).render('download', {
            fileId,
            serverName
        });
    });

}

if (enableP2P) {
    app.get('/p2p/:shareCode', limiter, (req, res) => {
        res.status(200).render('download-p2p', {
            shareCode: req.params.shareCode,
            serverName
        });
    });
}

app.use('/api', apiRouter);
if (enableUpload) {
    app.use('/upload', uploadRouter);

    app.get('/:fileId', limiter, (req, res) => {
        const sendHTML = (htmlFilePath, status) => {
            const nonce = res.locals.nonce;
            return fs.readFile(htmlFilePath, 'utf8', (err, data) => {
                if (err) {
                    log('error', `Failed to read ${path.basename(htmlFilePath)}: ${err.message}`);
                    return res.status(500).send('Server error');
                }
                const modifiedHtml = data.replace(/%%NONCE%%/g, nonce);
                res.status(status).setHeader('Content-Type', 'text/html').send(modifiedHtml);
            });
        };

        const fileId = req.params.fileId;
        const fileInfo = fileDatabase.get(fileId);

        if (!fileInfo) return sendHTML(path.join(__dirname, 'public', '404.html'), 404);

        if (fileInfo.isEncrypted) {
            if (!uploadEnableE2EE) {
                log('warn', 'Blocked access to an encrypted file because upload E2EE is disabled.');
                return sendHTML(path.join(__dirname, 'public', '404.html'), 404);
            }

            // The Web Crypto API requires a secure context (HTTPS).
            // If we are behind a reverse proxy, check if the original request was secure.
            if (req.protocol !== 'https') {
                log('warn', 'Blocked access to an encrypted file over an insecure connection (HTTP).');
                return sendHTML(path.join(__dirname, 'public', 'insecure.html'), 400);
            }
        }

        return sendHTML(path.join(__dirname, 'public', 'download.html'), 200);
    });
}

app.get('/', limiter, (req, res) => {
    if (!enableWebUI) {
        return res.send("Shadownloader Server is running.");
    }

    return res.status(200).render('index', {
        serverName,
        version,
        capabilities: getCapabilities()
    });
});

if (enableUpload) {
    const cleanupExpiredFiles = () => {
        const now = Date.now();
        const allFiles = preserveUploads ? fileDatabase.getAll() : Array.from(fileDatabase.entries()).map(([k, v]) => ({ key: k, value: v }));
        for (const record of allFiles) {
            if (record.value?.expiresAt && record.value.expiresAt < now) {
                log('info', 'File expired. Deleting...');
                try {
                    const stats = fs.statSync(record.value.path);
                    currentDiskUsage = Math.max(0, currentDiskUsage - stats.size);
                    fs.rmSync(record.value.path, { force: true });
                } catch (e) { }
                fileDatabase.delete(record.key);
            }
        }
    };

    const cleanupZombieUploads = () => {
        const now = Date.now();
        for (const [id, session] of ongoingUploads.entries()) {
            if (now > session.expiresAt) {
                log('info', `Cleaning zombie upload: ${id}`);
                try {
                    fs.rmSync(session.tempFilePath, { force: true });
                } catch (e) { }
                ongoingUploads.delete(id); // Removes reservation automatically
            }
        }
    };

    setInterval(cleanupExpiredFiles, 60000);

    const zombieCleanupIntervalMs = process.env.UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS ? process.env.UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS : 300000;
    if (isNaN(zombieCleanupIntervalMs) || zombieCleanupIntervalMs < 0 || !Number.isInteger(Number(zombieCleanupIntervalMs))) {
        log('error', 'Invalid UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS environment variable. It must be a non-negative integer.');
        process.exit(1);
    }

    if (Number(zombieCleanupIntervalMs) > 0) {
        setInterval(cleanupZombieUploads, Number(zombieCleanupIntervalMs));
        log('info', `UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS: ${zombieCleanupIntervalMs} ms`);
    } else {
        log('warn', 'UPLOAD_ZOMBIE_CLEANUP_INTERVAL_MS is set to 0! Zombie upload cleanup is disabled.');
    }
}

app.listen(port, () => {
    log('info', `Shadownloader Server v${version} is running. | Port: ${port}`);
});

const handleShutdown = () => {
    log('info', 'Shadownloader Server is shutting down...');
    if (enableUpload && !preserveUploads) {
        log('info', 'Clearing uploads and temp files upon shutdown...');
        cleanupDir(tmpDir);
        cleanupDir(uploadDir);
        log('info', 'Cleanup complete.');
    }
    process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

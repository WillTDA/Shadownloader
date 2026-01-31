process.env.ENABLE_UPLOAD = process.env.ENABLE_UPLOAD || 'true';
process.env.UPLOAD_ENABLE_E2EE = false;
process.env.UPLOAD_MAX_FILE_SIZE_MB = 100000;

const LOG_LEVELS = { NONE: -1, ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const normalizeLogLevel = (value) => {
    const upper = String(value || '').trim().toUpperCase();
    return LOG_LEVELS[upper] !== undefined ? upper : 'INFO';
};
const rawLogLevel = process.env.LOG_LEVEL;
const LOG_LEVEL = normalizeLogLevel(rawLogLevel || 'INFO');
const LOG_LEVEL_NUM = LOG_LEVELS[LOG_LEVEL];

const shouldLog = (level) => {
    const normalized = normalizeLogLevel(level);
    return LOG_LEVELS[normalized] <= LOG_LEVEL_NUM;
};

const log = (level, message) => {
    const normalized = normalizeLogLevel(level);
    if (!shouldLog(normalized)) return;
    const prefix = `[${new Date().toISOString()}] [${normalized}]`;
    const out = `${prefix} ${message}`;
    if (normalized === 'ERROR') return console.error(out);
    if (normalized === 'WARN') return console.warn(out);
    if (normalized === 'INFO') return console.info(out);
    return console.debug(out);
};

if (rawLogLevel && normalizeLogLevel(rawLogLevel) === 'INFO' && String(rawLogLevel).trim().toUpperCase() !== 'INFO') {
    log('warn', 'Invalid LOG_LEVEL value. Defaulting to INFO.');
}

log('info', 'Dropgate Server is starting...');
log('info', `Log level: ${LOG_LEVEL}`);

const { version } = require('./package.json');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const helmet = require('helmet').default;
const cors = require('cors');
const { ExpressPeerServer } = require('peer');
const contentDisposition = require('content-disposition');
const { FSDB } = require('file-system-db');
const { v4: uuidv4 } = require('uuid');

const port = process.env.SERVER_PORT || 52443;
const serverName = process.env.SERVER_NAME || 'Dropgate Server';
log('info', `Server Name: ${serverName}`);

const enableWebUI = process.env.ENABLE_WEB_UI !== 'false';
const enableP2P = process.env.ENABLE_P2P !== 'false';
const enableUpload = process.env.ENABLE_UPLOAD === 'true';
if (!enableUpload && !enableP2P) {
    log('error', 'Both UPLOAD and P2P are disabled. At least one protocol must be enabled for the server to function.');
    process.exit(1);
};

log('info', `Upload Protocol Enabled: ${enableUpload}`);
log('info', `Peer-to-Peer (P2P) Enabled: ${enableP2P}`);
log('info', `Web UI Enabled: ${enableWebUI}`);

// ===== P2P (WebRTC) configuration exposed to clients via /api/info =====
const PEERJS_MOUNT_PATH = '/peerjs';

const parseList = (raw) => {
    if (!raw) return [];
    return String(raw)
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
};

/**
 * Parse an environment variable as a non-negative integer.
 * @param {string} envName - Name of the env var for error messages
 * @param {string|undefined} raw - Raw env var value
 * @param {number} defaultValue - Default if not set
 * @returns {number} Parsed integer value
 */
const parseEnvInt = (envName, raw, defaultValue) => {
    const value = raw !== undefined ? raw : defaultValue;
    const num = Number(value);
    if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
        log('error', `Invalid ${envName} environment variable. It must be a non-negative integer.`);
        process.exit(1);
    }
    return num;
};

/**
 * Parse an environment variable as a non-negative number (allows decimals).
 * @param {string} envName - Name of the env var for error messages
 * @param {string|undefined} raw - Raw env var value
 * @param {number} defaultValue - Default if not set
 * @returns {number} Parsed numeric value
 */
const parseEnvNumber = (envName, raw, defaultValue) => {
    const value = raw !== undefined ? raw : defaultValue;
    const num = Number(value);
    if (isNaN(num) || num < 0) {
        log('error', `Invalid ${envName} environment variable. It must be a non-negative number.`);
        process.exit(1);
    }
    return num;
};

// Default: public STUN (Cloudflare) so P2P works out of the box.
const p2pStunUrls = process.env.P2P_STUN_SERVERS
    ? parseList(process.env.P2P_STUN_SERVERS)
    : ['stun:stun.cloudflare.com:3478'];

const p2pIceServers = [];
if (p2pStunUrls.length) p2pIceServers.push({ urls: p2pStunUrls });

const uploadEnableE2EE = process.env.UPLOAD_ENABLE_E2EE !== 'false';
if (enableUpload) log('info', `Upload End-to-End Encryption (E2EE) Enabled: ${uploadEnableE2EE}`);

if (enableUpload && uploadEnableE2EE) {
    log('warn', 'Upload E2EE is enabled. The server MUST be running behind a reverse proxy that provides a secure HTTPS connection.');
    log('warn', 'Failure to provide a secure context will cause client-side decryption to fail in the browser.');
}

if (enableP2P) {
    log('warn', 'P2P is enabled. The server MUST be running behind a reverse proxy that provides HTTPS.');
    log('warn', 'Failure to provide a secure context will prevent P2P transfers from working in browsers.');
    log('info', `P2P_STUN_SERVERS: ${p2pStunUrls.length ? p2pStunUrls.join(', ') : 'None'}`);
    log('info', `PeerJS Debug Logging: ${process.env.PEERJS_DEBUG === 'true'}`);
}

const app = express();
// We create the HTTP server manually so we can attach a PeerServer
// to the same port/path (fixed mount: /peerjs).
const server = http.createServer(app);

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
let maxFileDownloads = 1;
let currentDiskUsage = 0;
let fileDatabase = null;
let ongoingUploads = null;

if (enableUpload) {
    preserveUploads = process.env.UPLOAD_PRESERVE_UPLOADS === 'true';
    log('info', `UPLOAD_PRESERVE_UPLOADS: ${preserveUploads}`);

    maxFileSizeMB = parseEnvInt('UPLOAD_MAX_FILE_SIZE_MB', process.env.UPLOAD_MAX_FILE_SIZE_MB, 100);
    MAX_FILE_SIZE_BYTES = maxFileSizeMB === 0 ? Infinity : maxFileSizeMB * 1000 * 1000;
    log('info', `UPLOAD_MAX_FILE_SIZE_MB: ${maxFileSizeMB} MB`);
    if (maxFileSizeMB === 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is set to 0! Files of any size can be uploaded.');
    }

    maxStorageGB = parseEnvNumber('UPLOAD_MAX_STORAGE_GB', process.env.UPLOAD_MAX_STORAGE_GB, 10);
    MAX_STORAGE_BYTES = maxStorageGB === 0 ? Infinity : maxStorageGB * 1000 * 1000 * 1000;
    log('info', `UPLOAD_MAX_STORAGE_GB: ${maxStorageGB} GB`);
    if (maxStorageGB === 0) {
        log('warn', 'UPLOAD_MAX_STORAGE_GB is set to 0! Consider setting a limit on total storage used by uploaded files to prevent disk exhaustion.');
    }

    if (maxFileSizeMB > (maxStorageGB * 1000) && maxStorageGB !== 0) {
        log('warn', 'UPLOAD_MAX_FILE_SIZE_MB is larger than UPLOAD_MAX_STORAGE_GB! Any uploads larger than the allocated storage quota will be rejected.');
    }

    maxFileLifetimeHours = parseEnvNumber('UPLOAD_MAX_FILE_LIFETIME_HOURS', process.env.UPLOAD_MAX_FILE_LIFETIME_HOURS, 24);
    MAX_FILE_LIFETIME_MS = maxFileLifetimeHours === 0 ? Infinity : maxFileLifetimeHours * 60 * 60 * 1000;
    log('info', `UPLOAD_MAX_FILE_LIFETIME_HOURS: ${maxFileLifetimeHours} hours`);
    if (maxFileLifetimeHours === 0) {
        log('warn', 'UPLOAD_MAX_FILE_LIFETIME_HOURS is set to 0! Files will never expire.');
    }

    maxFileDownloads = parseEnvInt('UPLOAD_MAX_FILE_DOWNLOADS', process.env.UPLOAD_MAX_FILE_DOWNLOADS, 1);
    log('info', `UPLOAD_MAX_FILE_DOWNLOADS: ${maxFileDownloads}`);
    if (maxFileDownloads === 0) {
        log('warn', 'UPLOAD_MAX_FILE_DOWNLOADS is set to 0! Files can be downloaded unlimited times.');
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
        log('info', `Current server capacity: ${(currentDiskUsage / 1000 / 1000 / 1000).toFixed(2)} GB / ${maxStorageGB} GB`);
    }

    fileDatabase = preserveUploads ? new FSDB(path.join(__dirname, 'uploads', 'db', 'file-database.json')) : new Map();
    ongoingUploads = new Map();
    log('info', `File database is ready. (${preserveUploads ? 'persistent' : 'in-memory'})`);
} else {
    log('info', 'Upload protocol disabled. Cleaning up upload directory...');
    cleanupDir(uploadDir);
}
log('info', 'Configuring server endpoints and middleware...');

app.set('trust proxy', 1); // Trust the first hop from a reverse proxy
app.disable('x-powered-by');

// Templating
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
});

// Use Helmet for security headers, but leave HSTS to the reverse proxy.
app.use(
    helmet({
        hsts: false, // HSTS should be handled by the reverse proxy
        crossOriginOpenerPolicy: { policy: 'same-origin' },
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'upgrade-insecure-requests': null, // This should also be managed by the proxy
                'script-src': ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
                'style-src': ["'self'", "'unsafe-inline'"], // Required for inline style attributes
                'connect-src': ["'self'"],
                'frame-src': ["'self'"],
                'worker-src': ["'self'", 'blob:'],
                'child-src': ["'self'", 'blob:'],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'object-src': ["'none'"],
                'frame-ancestors': ["'self'"],
            },
        },
    })
);

// Static assets (after Helmet so headers apply)
app.use(express.static(path.join(__dirname, 'public')));

// Helper to serve vendor files
const serveVendorFile = (filePath, contentType) => (req, res) => {
    try {
        const p = path.join(__dirname, 'node_modules', filePath);
        if (!fs.existsSync(p)) return res.status(404).end();
        res.setHeader('Content-Type', contentType);
        res.sendFile(p);
    } catch {
        res.status(404).end();
    }
};

// Vendor files
app.get('/vendor/bootstrap/bootstrap.min.css', serveVendorFile('bootstrap/dist/css/bootstrap.min.css', 'text/css; charset=utf-8'));
app.get('/vendor/bootstrap/bootstrap.min.js', serveVendorFile('bootstrap/dist/js/bootstrap.min.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/streamsaver/streamsaver.js', serveVendorFile('streamsaver/StreamSaver.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/streamsaver/mitm.html', (req, res) => res.render('pages/mitm'));
app.get('/vendor/streamsaver/sw.js', serveVendorFile('streamsaver/sw.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/peerjs/peerjs.min.js', serveVendorFile('peerjs/dist/peerjs.min.js', 'application/javascript; charset=utf-8'));
app.get('/vendor/qr-code-styling/qr-code-styling.js', serveVendorFile('qr-code-styling/lib/qr-code-styling.js', 'application/javascript; charset=utf-8'));

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
        handler: (_req, res) => {
            log('warn', 'Rate limit triggered. Request blocked.');
            res.status(429).json({ error: 'Too many requests, please try again later.' });
        },
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
        const { filename, lifetime, isEncrypted, totalSize, totalChunks, maxDownloads: clientMaxDownloads } = req.body;

        if (isEncrypted && !uploadEnableE2EE) {
            log('debug', 'Rejected an E2EE upload attempt because upload E2EE is disabled on the server.');
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
            log('debug', `Upload rejected due to insufficient storage. Current usage: ${(currentDiskUsage / 1000 / 1000 / 1000).toFixed(2)} GB, Reserved: ${(reservedSpace / 1000 / 1000 / 1000).toFixed(2)} GB, Requested: ${(size / 1000 / 1000 / 1000).toFixed(2)} GB.`);
            return res.status(507).json({ error: 'Server out of capacity. Try again later.' });
        }

        // Validate filename if not encrypted
        if (!isEncrypted) {
            if (filename.length > 255 || /[\/\\]/.test(filename)) {
                return res.status(400).json({ error: 'Invalid filename. Contains illegal characters or is too long.' });
            }
        }

        // Validate maxDownloads
        let effectiveMaxDownloads = maxFileDownloads; // Server default
        if (clientMaxDownloads !== undefined) {
            if (typeof clientMaxDownloads !== 'number' || !Number.isInteger(clientMaxDownloads) || clientMaxDownloads < 0) {
                return res.status(400).json({ error: 'Invalid maxDownloads. Must be a non-negative integer.' });
            }
            // If server allows unlimited (0), client can choose anything
            // If server has a limit, client must not exceed it (but can choose 0 for unlimited if server is 0)
            if (maxFileDownloads === 1) {
                // Server forces single-download, ignore client preference
                effectiveMaxDownloads = 1;
            } else if (maxFileDownloads === 0) {
                // Server allows unlimited, client can choose
                effectiveMaxDownloads = clientMaxDownloads;
            } else {
                // Server has a limit > 1
                if (clientMaxDownloads === 0) {
                    // Client wants unlimited but server has a limit
                    return res.status(400).json({ error: `Server does not allow unlimited downloads. Max: ${maxFileDownloads}.` });
                }
                if (clientMaxDownloads > maxFileDownloads) {
                    return res.status(400).json({ error: `Max downloads exceeds server limit of ${maxFileDownloads}.` });
                }
                effectiveMaxDownloads = clientMaxDownloads;
            }
        }

        const tempFilePath = path.join(tmpDir, uploadId);
        fs.writeFileSync(tempFilePath, '');

        ongoingUploads.set(uploadId, {
            filename,
            isEncrypted,
            lifetime: Number(lifetime) || 0,
            maxDownloads: effectiveMaxDownloads,
            tempFilePath,
            totalSize: size, // Expected final size
            totalChunks: chunks, // Expected chunk count
            receivedChunks: new Set(),
            reservedBytes: size, // Amount to reserve
            expiresAt: Date.now() + (2 * 60 * 1000) // 2 minute initial deadline
        });

        log('debug', `Initialised upload. Reserved ${(size / 1000 / 1000).toFixed(2)} MB.`);
        res.status(200).json({ uploadId });
    });

    uploadRouter.post('/cancel', uploadAuth, (req, res) => {
        const { uploadId } = req.body;
        if (!ongoingUploads.has(uploadId)) {
            return res.status(404).json({ error: 'Upload session not found or already expired.' });
        }

        const session = ongoingUploads.get(uploadId);

        // Clean up temp file
        try {
            fs.rmSync(session.tempFilePath, { force: true });
        } catch (e) {
            log('debug', `Failed to delete temp file during cancellation: ${e.message}`);
        }

        // Remove from ongoing uploads (releases reservation)
        ongoingUploads.delete(uploadId);

        log('debug', `Upload cancelled by client. Released ${(session.reservedBytes / 1000 / 1000).toFixed(2)} MB.`);
        res.status(200).json({ success: true });
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
            log('debug', `Received chunk ${chunkIndex + 1}/${session.totalChunks}. Size: ${(buffer.length / 1000).toFixed(2)} KB`);

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
            log('debug', `Upload incomplete: ${session.receivedChunks.size}/${session.totalChunks} chunks.`);

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
                log('debug', 'Rejected 0-byte file upload.');
                fs.rmSync(uploadInfo.tempFilePath, { force: true }); // Clean up the empty temp file
                ongoingUploads.delete(uploadId);
                return res.status(400).json({ error: 'Empty files (0 bytes) cannot be uploaded.' });
            } else if (stats.size !== uploadInfo.totalSize) {
                log('debug', `Upload size mismatch. Expected: ${uploadInfo.totalSize}, Actual: ${stats.size}`);
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
            maxDownloads: uploadInfo.maxDownloads,
            downloadCount: 0,
        });

        ongoingUploads.delete(uploadId); // Remove the reservation
        log('debug', `[${uploadInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File received.${maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / 1000 / 1000 / 1000).toFixed(2)} GB / ${maxStorageGB} GB.` : ''}`);
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
            // Increment download count
            const newDownloadCount = (fileInfo.downloadCount || 0) + 1;
            const maxDl = fileInfo.maxDownloads ?? 1;

            // Check if we should delete the file (maxDownloads reached)
            if (maxDl > 0 && newDownloadCount >= maxDl) {
                // Update storage immediately
                currentDiskUsage = Math.max(0, currentDiskUsage - fileSize);

                fs.rm(fileInfo.path, { force: true }, () => { });
                fileDatabase.delete(fileId);
                log('debug', `[${fileInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File data sent and deleted (${newDownloadCount}/${maxDl} downloads).${maxStorageGB !== 0 ? ` Server capacity: ${(currentDiskUsage / 1000 / 1000 / 1000).toFixed(2)} GB / ${maxStorageGB} GB.` : ''}`);
            } else {
                // Update download count in database
                fileDatabase.set(fileId, {
                    ...fileInfo,
                    downloadCount: newDownloadCount,
                });
                log('debug', `[${fileInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File data sent (${newDownloadCount}/${maxDl === 0 ? 'unlimited' : maxDl} downloads).`);
            }
        });
    });
}

apiRouter.get('/info', limiter, (req, res) => {
    const uploadCapabilities = {
        enabled: enableUpload,
        maxSizeMB: enableUpload ? maxFileSizeMB : undefined,
        maxLifetimeHours: enableUpload ? maxFileLifetimeHours : undefined,
        maxFileDownloads: enableUpload ? maxFileDownloads : undefined,
        e2ee: enableUpload ? uploadEnableE2EE : undefined,
    };

    const p2pCapabilities = {
        enabled: enableP2P,
        peerjsPath: enableP2P ? PEERJS_MOUNT_PATH : undefined,
        iceServers: enableP2P ? p2pIceServers : undefined,
        peerjsDebugLogging: enableP2P ? (process.env.PEERJS_DEBUG === 'true') : undefined,
    };

    res.status(200).json({
        name: serverName,
        version: version,
        logLevel: LOG_LEVEL,
        capabilities: {
            upload: uploadCapabilities,
            p2p: p2pCapabilities,
            webUI: {
                enabled: enableWebUI
            }
        }
    });
});

apiRouter.post('/resolve', limiter, (req, res) => {
    const raw = String(req.body?.value || '').trim();
    if (!raw) {
        return res.status(400).json({ valid: false, error: 'Missing sharing code.' });
    }

    const isUrl = /^https?:\/\//i.test(raw);
    const isUuid = (value) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
    const isP2PCode = (value) => /^[A-Z]{4}-\d{4}$/.test(value);
    const normalizeP2P = (value) => value.replace(/\s+/g, '').toUpperCase();

    if (isUrl) {
        try {
            const url = new URL(raw);
            const origin = `${req.protocol}://${req.get('host')}`;
            if (url.origin !== origin) {
                return res.status(200).json({ valid: true, type: 'external', target: url.toString() });
            }

            const path = decodeURIComponent(url.pathname || '');
            if (path.startsWith('/p2p/')) {
                const code = normalizeP2P(path.replace('/p2p/', ''));
                if (!enableP2P) {
                    return res.status(200).json({ valid: false, reason: 'Direct transfer is disabled on this server.' });
                }
                if (!isP2PCode(code)) {
                    return res.status(200).json({ valid: false, reason: 'Invalid direct transfer code.' });
                }
                return res.status(200).json({ valid: true, type: 'p2p', target: `/p2p/${encodeURIComponent(code)}` });
            }

            if (path.startsWith('/')) {
                const fileId = path.slice(1);
                if (isUuid(fileId)) {
                    const fileInfo = fileDatabase.get(fileId);
                    if (!fileInfo) {
                        return res.status(200).json({ valid: false, reason: 'File not found.' });
                    }
                    return res.status(200).json({ valid: true, type: 'file', target: `/${fileId}` });
                }
            }

            return res.status(200).json({ valid: false, reason: 'Unrecognised sharing link.' });
        } catch {
            return res.status(200).json({ valid: false, reason: 'Invalid URL.' });
        }
    }

    const compact = raw.replace(/\s+/g, '');
    if (isUuid(compact)) {
        const fileInfo = fileDatabase.get(compact);
        if (!fileInfo) {
            return res.status(200).json({ valid: false, reason: 'File not found.' });
        }
        return res.status(200).json({ valid: true, type: 'file', target: `/${compact}` });
    }

    const p2pCode = normalizeP2P(compact);
    if (isP2PCode(p2pCode)) {
        if (!enableP2P) {
            return res.status(200).json({ valid: false, reason: 'Direct transfer is disabled on this server.' });
        }
        return res.status(200).json({ valid: true, type: 'p2p', target: `/p2p/${encodeURIComponent(p2pCode)}` });
    }

    return res.status(200).json({ valid: false, reason: 'Unrecognised sharing code.' });
});

app.use('/api', apiRouter);

// ===== PeerJS signalling server (PeerServer) =====
// Mounted at a fixed path: /peerjs
if (enableP2P) {
    const peerServer = ExpressPeerServer(server, {
        path: '/',
        debug: process.env.PEERJS_DEBUG === 'true',
        proxied: true,
    });
    app.use(PEERJS_MOUNT_PATH, peerServer);
    log('info', `PeerServer mounted at ${PEERJS_MOUNT_PATH}`);
}

// P2P receiver page
app.get('/p2p/:code', limiter, (req, res) => {
    if (!enableP2P) return res.status(404).render('pages/404', { serverName });
    return res.status(200).render('pages/download-p2p', { code: req.params.code, serverName });
});

// Web UI landing page
app.get('/', limiter, (req, res) => {
    if (!enableWebUI) return res.status(200).send('Dropgate Server is running. Web UI is disabled.');
    return res.status(200).render('pages/index', { serverName });
});

// Standard download page
if (enableUpload) {
    app.use('/upload', uploadRouter);

    app.get(`/:fileId`, limiter, (req, res) => {
        const fileId = req.params.fileId;
        const fileInfo = fileDatabase.get(fileId);

        if (!fileInfo) return res.status(404).render('pages/404', { serverName });

        if (fileInfo.isEncrypted) {
            if (!uploadEnableE2EE) {
                log('debug', 'Blocked access to an encrypted file because upload E2EE is disabled.');
                return res.status(404).render('pages/404', { serverName });
            }

            // The Web Crypto API requires a secure context (HTTPS).
            if (req.protocol !== 'https') {
                log('debug', 'Blocked access to an encrypted file over an insecure connection (HTTP).');
                return res.status(400).render('pages/insecure', { serverName });
            }
        }

        return res.status(200).render('pages/download-standard', { serverName, fileId });
    });
}

// 404 fallback
app.use((_req, res) => res.status(404).render('pages/404', { serverName }));

if (enableUpload) {
    const cleanupExpiredFiles = () => {
        const now = Date.now();
        const allFiles = preserveUploads ? fileDatabase.getAll() : Array.from(fileDatabase.entries()).map(([k, v]) => ({ key: k, value: v }));
        for (const record of allFiles) {
            if (record.value?.expiresAt && record.value.expiresAt < now) {
                log('debug', 'File expired. Deleting...');
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
                log('debug', 'Cleaning zombie upload.');
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

server.listen(port, () => {
    log('info', `Dropgate Server v${version} is running. | SERVER_PORT: ${port}`);
});

const handleShutdown = () => {
    log('info', 'Dropgate Server is shutting down...');
    if (enableUpload && !preserveUploads) {
        log('info', 'Clearing uploads and temp files upon shutdown...');
        cleanupDir(tmpDir);
        cleanupDir(uploadDir);
        log('info', 'Cleanup complete.');
    }
    // Gracefully stop accepting new connections.
    try {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 1500).unref();
    } catch {
        process.exit(0);
    }
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

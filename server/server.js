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
const { pipeline } = require('stream');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit').default;
const helmet = require('helmet').default;
const cors = require('cors');
const contentDisposition = require('content-disposition');
const { FSDB } = require('file-system-db');
const { v4: uuidv4 } = require('uuid');

const enableE2EE = process.env.ENABLE_E2EE === 'true';
log('info', `End-to-End Encryption (E2EE) Enabled: ${enableE2EE}`);

if (enableE2EE) {
    log('warn', 'E2EE is enabled. The server MUST be running behind a reverse proxy that provides a secure HTTPS connection.');
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

const preserveUploads = process.env.PRESERVE_UPLOADS === 'true' || false;
log('info', `PRESERVE_UPLOADS: ${preserveUploads}`);

let maxFileSizeMB = process.env.MAX_FILE_SIZE_MB ? process.env.MAX_FILE_SIZE_MB : 100;
if (isNaN(maxFileSizeMB) || maxFileSizeMB < 0 || !Number.isInteger(Number(maxFileSizeMB))) {
    log('error', 'Invalid MAX_FILE_SIZE_MB environment variable. It must be a non-negative integer.');
    process.exit(1);
}

maxFileSizeMB = Number(maxFileSizeMB);
const MAX_BYTES = maxFileSizeMB === 0 ? Infinity : maxFileSizeMB * 1024 * 1024;
log('info', `MAX_FILE_SIZE_MB: ${maxFileSizeMB} MB`);
if (Number(maxFileSizeMB) === 0) {
    log('warn', 'MAX_FILE_SIZE_MB is set to 0! Files of any size can be uploaded.');
}

if (!preserveUploads) {
    log('info', 'Clearing any existing uploads and temp files on startup...');
    [tmpDir, uploadDir].forEach(cleanupDir);
}

createDirIfNotExists(uploadDir);
createDirIfNotExists(tmpDir);

let fileDatabase = preserveUploads ? new FSDB(path.join(__dirname, 'uploads', 'db', 'file-database.json')) : new Map();
let ongoingUploads = new Map();

log('info', `File database is ready. (${preserveUploads ? 'persistent' : 'in-memory'})`);
log('info', 'Configuring server endpoints and middleware...');

app.set('trust proxy', 1); // Trust the first hop from a reverse proxy
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
    log('error', 'Invalid RATE_LIMIT_WINDOW_MS environment variable. It must be a positive integer.');
    process.exit(1);
}
if (isNaN(rateLimitMaxRequests) || rateLimitMaxRequests < 0 || !Number.isInteger(Number(rateLimitMaxRequests))) {
    log('error', 'Invalid RATE_LIMIT_MAX_REQUESTS environment variable. It must be a positive integer.');
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

app.post('/upload/init', limiter, (req, res) => {
    const uploadId = uuidv4();
    const { filename, lifetime, isEncrypted } = req.body;

    if (isEncrypted && !enableE2EE) {
        log('warn', 'Rejected an E2EE upload attempt because E2EE is disabled on the server.');
        return res.status(400).json({ error: 'End-to-end encryption is disabled on this server.' });
    }

    // Validate filename
    if (typeof filename !== 'string' || filename.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid filename. Must be a non-empty string.' });
    }

    // Validate isEncrypted (must be a boolean)
    if (typeof isEncrypted !== 'boolean') {
        return res.status(400).json({ error: 'Invalid isEncrypted. Must be a boolean.' });
    }

    // Validate filename if not encrypted
    if (!isEncrypted) {
        if (filename.length > 255 || /[\/\\]/.test(filename)) {
            return res.status(400).json({ error: 'Invalid filename. Contains illegal characters or is too long.' });
        }
    }

    // Validate file lifetime
    if (typeof lifetime !== 'number' || !Number.isInteger(lifetime) || lifetime < 0) {
        return res.status(400).json({ error: 'Invalid lifetime. Must be a non-negative integer (milliseconds).' });
    }

    const tempFilePath = path.join(tmpDir, uploadId);

    fs.writeFileSync(tempFilePath, '');

    ongoingUploads.set(uploadId, {
        filename,
        isEncrypted,
        lifetime: lifetime,
        tempFilePath,
    });

    log('info', `Initialised upload.`);
    res.status(200).json({ uploadId });
});

app.post('/upload/chunk', (req, res) => {
    const uploadId = req.headers['x-upload-id'];
    const offsetHeader = req.headers['x-file-offset'];
    if (!ongoingUploads.has(uploadId)) return res.status(400).send('Invalid upload ID.');

    // Validate offset
    const offset = parseInt(offsetHeader || '0', 10);
    if (isNaN(offset) || offset < 0) {
        return res.status(400).send('Invalid file offset.');
    }

    const { tempFilePath } = ongoingUploads.get(uploadId);
    const writeStream = fs.createWriteStream(tempFilePath, { 
        flags: 'r+', 
        start: offset 
    });

    pipeline(req, writeStream, (err) => {
        if (err) {
            log('error', `Upload chunk pipeline error for ${uploadId}: ${err.message}`);
            // If the connection drops here, the client will catch the error and retry sending the exact same chunk to the exact same offset.
            return res.status(500).send('Write failed.');
        }
        try {
            const size = fs.statSync(tempFilePath).size;
            if (size > MAX_BYTES) {
                fs.rmSync(tempFilePath, { force: true });
                ongoingUploads.delete(uploadId);
                return res.status(413).send('File too large.');
            }
            return res.status(200).send('Chunk received.');
        } catch (e) {
            log('error', `Stat failed for ${tempFilePath}: ${e.message}`);
            return res.status(500).send('Server error');
        }
    });
});

app.post('/upload/complete', (req, res) => {
    const { uploadId } = req.body;
    if (!ongoingUploads.has(uploadId)) {
        return res.status(400).json({ error: 'Invalid upload ID.' });
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
        }
    } catch (e) {
        log('error', `Could not stat temp file for size check: ${e.message}`);
        ongoingUploads.delete(uploadId);
        fs.rmSync(uploadInfo.tempFilePath, { force: true }); // Attempt to clean up
        return res.status(500).json({ error: 'Server error during file validation.' });
    }

    fs.renameSync(uploadInfo.tempFilePath, finalPath);

    const expiresAt = uploadInfo.lifetime > 0 ? Date.now() + uploadInfo.lifetime : null;

    fileDatabase.set(fileId, {
        name: uploadInfo.filename,
        path: finalPath,
        expiresAt: expiresAt,
        isEncrypted: uploadInfo.isEncrypted,
    });

    ongoingUploads.delete(uploadId);
    log('info', `[${uploadInfo.isEncrypted ? 'Encrypted' : 'Simple'}] File received.`);
    res.status(200).json({ id: fileId });
});

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
        if (!enableE2EE) {
            log('warn', `Blocked access to an encrypted file because E2EE is disabled.`);
            return sendHTML(path.join(__dirname, 'public', '404.html'), 404);
        }

        // The Web Crypto API requires a secure context (HTTPS).
        // If we are behind a reverse proxy, check if the original request was secure.
        if (req.protocol !== 'https') {
            log('warn', `Blocked access to an encrypted file over an insecure connection (HTTP).`);
            return sendHTML(path.join(__dirname, 'public', 'insecure.html'), 400);
        }

        return sendHTML(path.join(__dirname, 'public', 'decryptor.html'), 200);
    } else {
        res.setHeader('Content-Disposition', contentDisposition(fileInfo.name));
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', fs.statSync(fileInfo.path).size);
        const readStream = fs.createReadStream(fileInfo.path);
        readStream.pipe(res);
        readStream.on('close', () => {
            fs.rm(fileInfo.path, { force: true }, () => { });
            fileDatabase.delete(fileId);
            log('info', `[Simple] File downloaded and deleted.`);
        });
    }
});

app.get('/api/file/:fileId/meta', limiter, (req, res) => {
    const fileId = req.params.fileId;
    const fileInfo = fileDatabase.get(fileId);

    if (!fileInfo || !fileInfo.isEncrypted) {
        return res.status(404).json({ error: 'File not found.' });
    }
    res.status(200).json({ encryptedFilename: fileInfo.name });
});

app.get('/api/file/:fileId', limiter, (req, res) => {
    const fileId = req.params.fileId;
    const fileInfo = fileDatabase.get(fileId);

    if (!fileInfo || !fileInfo.isEncrypted) {
        return res.status(404).json({ error: 'File not found.' });
    }

    const readStream = fs.createReadStream(fileInfo.path);
    res.setHeader('Content-Length', fs.statSync(fileInfo.path).size);
    readStream.pipe(res);
    readStream.on('close', () => {
        fs.rm(fileInfo.path, { force: true }, () => { });
        fileDatabase.delete(fileId);
        log('info', `[Encrypted] File data sent and deleted.`);
    });
});

app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', version, sizeLimit: maxFileSizeMB });
});

const cleanupExpiredFiles = () => {
    log('info', 'Running TTL cleanup job...');
    const now = Date.now();
    const allFiles = preserveUploads ? fileDatabase.getAll() : Array.from(fileDatabase.entries()).map(([k, v]) => ({ key: k, value: v }));
    for (const record of allFiles) {
        if (record.value?.expiresAt && record.value.expiresAt < now) {
            log('info', `File expired. Deleting...`);
            fs.rm(record.value.path, { force: true }, () => { });
            fileDatabase.delete(record.key);
        }
    }
};

const cleanupZombieUploads = () => {
    log('info', 'Running zombie upload cleanup job...');
    const tempFiles = fs.readdirSync(tmpDir);
    for (const tempFile of tempFiles) {
        const tempFilePath = path.join(tmpDir, tempFile);
        if (!ongoingUploads.has(tempFile)) {
            log('info', `Found zombie upload temp file. Deleting...`);
            fs.rmSync(tempFilePath, { force: true });
        }
    }
};

setInterval(cleanupExpiredFiles, 60000);

const zombieCleanupIntervalMs = process.env.ZOMBIE_CLEANUP_INTERVAL_MS ? process.env.ZOMBIE_CLEANUP_INTERVAL_MS : 300000;
if (isNaN(zombieCleanupIntervalMs) || zombieCleanupIntervalMs < 0 || !Number.isInteger(Number(zombieCleanupIntervalMs))) {
    log('error', 'Invalid ZOMBIE_CLEANUP_INTERVAL_MS environment variable. It must be a positive integer.');
    process.exit(1);
}

if (Number(zombieCleanupIntervalMs) > 0) {
    setInterval(cleanupZombieUploads, Number(zombieCleanupIntervalMs));
    log('info', `ZOMBIE_CLEANUP_INTERVAL_MS: ${zombieCleanupIntervalMs} ms`);
} else {
    log('warn', 'ZOMBIE_CLEANUP_INTERVAL_MS is set to 0! Zombie upload cleanup is disabled.');
}

app.listen(port, () => {
    log('info', `Shadownloader Server v${version} is running. | Port: ${port} (HTTP)`);
});

const handleShutdown = () => {
    log('info', 'Shadownloader Server is shutting down...');
    if (!preserveUploads) {
        log('info', 'Clearing uploads and temp files upon shutdown...');
        cleanupDir(tmpDir);
        cleanupDir(uploadDir);
        log('info', 'Cleanup complete.');
    }
    process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
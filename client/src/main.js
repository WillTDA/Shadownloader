const { app, BrowserWindow, ipcMain, Menu, globalShortcut, dialog, clipboard, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store').default;

// Create a log file for debugging
const logFile = path.join(app.getPath('userData'), 'debug.log');
const originalConsoleLog = console.log; // Save the original console.log

function log(...args) {
    const message = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    try {
        fs.appendFileSync(logFile, message);
    } catch (e) {
        // If we can't write to log, at least show in console
    }
    originalConsoleLog(...args); // Use the original console.log
}

try {
    fs.writeFileSync(logFile, `=== App started at ${new Date().toISOString()} ===\n`);
    log('Log file created at:', logFile);
} catch (e) {
    console.error('Could not create log file:', e);
}

log('process.argv on startup:', JSON.stringify(process.argv));

if (process.platform === 'win32') {
    app.setAppUserModelId('com.diamonddigitaldev.shadownloaderclient');
}

const store = new Store();

let mainWindow = null;
let uploadQueue = [];
let isUploading = false;

function getIconPath() {
    let iconName;
    switch (process.platform) {
        case 'win32':
            iconName = 'shadownloader.ico';
            break;
        case 'darwin': // macOS
            iconName = 'shadownloader.icns';
            break;
        case 'linux':
        default:
            iconName = 'shadownloader.png';
            break;
    }
    return path.join(__dirname, 'img', iconName);
}

// Determine if the app was launched SOLELY for a background task.
// This is a crucial flag to manage the app's lifecycle.
const wasLaunchedForBackgroundTask = process.argv.some(arg => arg === '--upload' || arg === '--upload-e2ee');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // We're a second instance, the first instance will handle our args
    log('Another instance exists, passing arguments and quitting');
    app.quit();
} else {
    // We're the first instance
    log('Primary instance starting');

    app.on('second-instance', (event, commandLine, workingDirectory) => {
        log('=== Second instance detected ===');
        log('commandLine:', commandLine);

        const isBackgroundUpload = commandLine.some(arg => arg === '--upload' || arg === '--upload-e2ee');

        if (isBackgroundUpload) {
            log('Background upload via second-instance');
            handleArgs(commandLine);
        } else {
            log('Normal app launch via second-instance');
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            } else {
                createWindow();
            }
        }
    });

    // Handle initial launch
    app.whenReady().then(() => {
        log('=== App ready ===');
        log('wasLaunchedForBackgroundTask:', wasLaunchedForBackgroundTask);
        log('process.argv:', JSON.stringify(process.argv));

        // If the app was NOT launched for a background task, create the main window.
        if (!wasLaunchedForBackgroundTask) {
            log('Creating main window (not a background task)');
            createWindow();
        } else {
            log('Skipping main window creation (background task detected)');
        }

        // Always handle arguments on startup
        log('Processing startup arguments...');
        handleArgs(process.argv);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 850,
        resizable: false,
        title: "Shadownloader Client",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Manage the background upload queue
function processUploadQueue() {
    log('=== processUploadQueue called ===');
    log('isUploading:', isUploading);
    log('Queue length:', uploadQueue.length);

    if (isUploading) {
        log('Already uploading, skipping');
        return;
    }

    if (uploadQueue.length === 0) {
        log('Queue is empty');
        return;
    }

    isUploading = true;
    const { filePath, useE2EE } = uploadQueue.shift();
    log('Processing upload from queue:', filePath);
    triggerBackgroundUpload(filePath, useE2EE);
}

function handleArgs(argv) {
    log('=== handleArgs called ===');
    log('argv:', JSON.stringify(argv));
    log('app.isPackaged:', app.isPackaged);

    // For packaged apps, we need to skip:
    // - argv[0]: the executable path
    // - Any paths that are the app executable itself
    const executablePath = process.execPath.toLowerCase();
    log('Executable path:', executablePath);

    const filePath = argv.find((arg, index) => {
        // Skip first argument (always the executable)
        if (index === 0) {
            log('Skipping index 0:', arg);
            return false;
        }

        // Skip if it's the executable itself
        if (arg.toLowerCase() === executablePath) {
            log('Skipping executable path:', arg);
            return false;
        }

        // Skip our custom flags
        if (arg === '--upload' || arg === '--upload-e2ee') {
            log('Skipping flag:', arg);
            return false;
        }

        // Check if it's a valid file
        try {
            const exists = fs.existsSync(arg);
            const isFile = exists && fs.lstatSync(arg).isFile();
            log(`Checking arg [${index}]: "${arg}" - exists: ${exists}, isFile: ${isFile}`);
            return isFile;
        } catch (e) {
            log(`Error checking arg [${index}]: "${arg}" - ${e.message}`);
            return false;
        }
    });

    log('Found file path:', filePath);

    if (!filePath) {
        log('No valid file path found in arguments');
        return;
    }

    const useE2EE = argv.includes('--upload-e2ee');
    const isUploadAction = argv.includes('--upload') || useE2EE;

    log('Is upload action:', isUploadAction, 'Use E2EE:', useE2EE);

    if (isUploadAction) {
        // Check if this file is already in the queue to prevent duplicates
        const alreadyQueued = uploadQueue.some(item => item.filePath === filePath);
        if (alreadyQueued) {
            log('File already in queue, skipping duplicate');
            return;
        }

        uploadQueue.push({ filePath, useE2EE });
        log('Added to queue. New queue length:', uploadQueue.length);
        processUploadQueue();
    } else {
        log('Not an upload action, ignoring');
    }
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

ipcMain.on('upload-progress', (event, progressData) => {
    // Send to main window if it exists
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-ui', { type: 'progress', data: progressData });
    }

    // ALSO send to the window that's uploading (might be a background window)
    const uploaderWindow = BrowserWindow.fromWebContents(event.sender);
    if (uploaderWindow && uploaderWindow !== mainWindow && !uploaderWindow.isDestroyed()) {
        uploaderWindow.webContents.send('update-ui', { type: 'progress', data: progressData });
    }
});

ipcMain.on('upload-finished', (event, result) => {
    log('Upload finished:', result.status);

    const uploaderWindow = BrowserWindow.fromWebContents(event.sender);
    const isFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();

    if (result.status === 'success') {
        clipboard.writeText(result.link);

        // Send to main window if it exists
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-ui', { type: 'success', data: result });
        }

        // Show notification if main window doesn't exist or isn't focused
        if (!mainWindow || !isFocused) {
            new Notification({
                title: 'Upload Successful',
                body: 'Link copied to clipboard.'
            }).show();
        }
    } else {
        // Send to main window if it exists
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-ui', { type: 'error', data: result });
        }

        // Show notification if main window doesn't exist or isn't focused
        if (!mainWindow || !isFocused) {
            new Notification({
                title: 'Upload Failed',
                body: result.error || 'An unknown error occurred.'
            }).show();
        }
    }

    // Only destroy background windows, not the main window
    if (uploaderWindow && uploaderWindow !== mainWindow) {
        log('Destroying background window');
        uploaderWindow.destroy();
    }

    isUploading = false;

    // If there are more items, process them.
    if (uploadQueue.length > 0) {
        processUploadQueue();
    } else if (wasLaunchedForBackgroundTask && !mainWindow) {
        log('Background task complete, quitting app');
        app.quit();
    }
});

ipcMain.handle('get-settings', () => {
    return {
        serverURL: store.get('serverURL', ''),
        lifetimeValue: store.get('lifetimeValue', '24'),
        lifetimeUnit: store.get('lifetimeUnit', 'hours'),
    };
});

ipcMain.handle('set-settings', (event, settings) => {
    try {
        for (const [key, value] of Object.entries(settings)) {
            if (value !== undefined) {
                store.set(key, value);
            }
        }
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
});

ipcMain.handle('get-client-version', () => {
    return app.getVersion();
});

ipcMain.on('open-external', (event, url) => {
    const allowed = [
        'https://github.com/',
        'https://youtube.com/',
        'https://buymeacoff.ee/'
    ];

    if (allowed.some(prefix => url.startsWith(prefix))) {
        shell.openExternal(url);
    }
});

const menuTemplate = [
    {
        label: 'Menu',
        submenu: [
            {
                label: 'Open File',
                accelerator: 'CmdOrCtrl+O',
                click: handleOpenDialog
            },
            { type: 'separator' },
            {
                label: 'Exit',
                accelerator: 'Alt+F4',
                role: 'quit'
            }
        ]
    },
    {
        label: 'Credits',
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => {
            createCreditsWindow();
        }
    }
];

const menu = Menu.buildFromTemplate(menuTemplate);
Menu.setApplicationMenu(menu);

function createCreditsWindow() {
    const creditsWindow = new BrowserWindow({
        width: 875,
        height: 525,
        parent: mainWindow,
        modal: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    // Ensure it cannot be minimized (also disable minimize/maximize buttons)
    creditsWindow.on('minimize', (e) => {
        e.preventDefault();
        creditsWindow.show();
        creditsWindow.focus();
    });

    creditsWindow.setMenu(null);
    creditsWindow.loadFile(path.join(__dirname, 'credits.html'));
}

async function handleOpenDialog() {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (!focusedWindow) return;

    const { canceled, filePaths } = await dialog.showOpenDialog(focusedWindow, {
        properties: ['openFile'],
        title: 'Select a file',
        buttonLabel: 'Select'
    });

    if (canceled || filePaths.length === 0) {
        return;
    }

    const filePath = filePaths[0];
    try {
        const fileData = fs.readFileSync(filePath);
        focusedWindow.webContents.send('file-opened', {
            name: path.basename(filePath),
            data: fileData
        });
    } catch (error) {
        console.error('Failed to read the selected file:', error);
        focusedWindow.webContents.send('file-open-error', 'Could not read the selected file.');
    }
}

// BACKGROUND UPLOAD
// Store pending uploads with their windows
const pendingBackgroundUploads = new Map();

// Set up the renderer-ready listener ONCE at the top level
ipcMain.on('renderer-ready', (event) => {
    log('Renderer ready signal received');

    // Find which window sent this event
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
        console.error('Could not find sender window');
        return;
    }

    const windowId = senderWindow.id;
    log('Renderer ready from window ID:', windowId);

    // Check if we have a pending upload for this window
    if (pendingBackgroundUploads.has(windowId)) {
        const { filePath, useE2EE } = pendingBackgroundUploads.get(windowId);
        log('Found pending upload for this window:', filePath);

        try {
            const fileData = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);

            log('Sending background-upload-start with file:', fileName, 'size:', fileData.length);

            new Notification({
                title: 'Upload Started',
                body: `Uploading ${fileName}...`
            }).show();

            senderWindow.webContents.send('background-upload-start', {
                name: fileName,
                data: fileData,
                useE2EE: useE2EE
            });

            // Clear this pending upload
            pendingBackgroundUploads.delete(windowId);
        } catch (error) {
            console.error('Failed to read file for background upload:', error);
            new Notification({
                title: 'Upload Failed',
                body: 'Could not read the selected file.'
            }).show();

            if (senderWindow && !senderWindow.isDestroyed()) {
                senderWindow.destroy();
            }

            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    } else {
        log('No pending upload for this window (normal GUI window)');
    }
});

function triggerBackgroundUpload(filePath, useE2EE) {
    log('=== triggerBackgroundUpload called ===');
    log('File:', filePath);
    log('E2EE:', useE2EE);
    log('File exists:', fs.existsSync(filePath));

    if (!fs.existsSync(filePath)) {
        console.error('File does not exist!');
        new Notification({
            title: 'Upload Failed',
            body: 'File not found.'
        }).show();
        isUploading = false;
        processUploadQueue();
        return;
    }

    const backgroundWindow = new BrowserWindow({
        show: false,  // use true for debugging!
        width: 500,
        height: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: getIconPath()
    });

    const windowId = backgroundWindow.id;
    log('Created background window with ID:', windowId);

    // Store the pending upload BEFORE loading the file
    pendingBackgroundUploads.set(windowId, { filePath, useE2EE });

    // Clean up if window is closed before upload starts
    backgroundWindow.on('closed', () => {
        log('Background window closed, cleaning up');
        if (pendingBackgroundUploads.has(windowId)) {
            pendingBackgroundUploads.delete(windowId);
            isUploading = false;
            processUploadQueue();
        }
    });

    // backgroundWindow.webContents.openDevTools();

    new Notification({
        title: 'Initialising Upload',
        body: `Preparing ${path.basename(filePath)}...`
    }).show();

    log('Loading index.html into background window');
    backgroundWindow.loadFile(path.join(__dirname, 'index.html'));
}
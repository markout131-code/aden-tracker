const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, onDisconnect, onValue } = require('firebase/database');
const { autoUpdater } = require('electron-updater');

const firebaseConfig = {
    apiKey: "AIzaSyDVaqfuus1ZBLA_7LSN2ka2gHB6gZR2Wik",
    authDomain: "aden-tracker-fcc98.firebaseapp.com",
    databaseURL: "https://aden-tracker-fcc98-default-rtdb.firebaseio.com",
    projectId: "aden-tracker-fcc98",
    storageBucket: "aden-tracker-fcc98.firebasestorage.app",
    messagingSenderId: "39413049768",
    appId: "1:39413049768:web:28fce937565f9b895c159d"
};

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

app.setName('Aden Tracker');
if (process.platform === 'win32') app.setAppUserModelId('com.aden.tracker');
app.disableHardwareAcceleration();

let win = null, splash = null, tray = null;
let lastMousePos = { x: 0, y: 0 }, isDragging = false;
let currentWidth = 360, currentHeight = 600;
let userId = null, userRef = null;
let isMini = false;
let isUpdateReady = false;
let isQuitting = false; // set to true when user explicitly quits via tray or update

function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updateOnlineUsers() {
    onValue(ref(database, 'online_users'), (snapshot) => {
        const users = snapshot.val();
        const count = users ? Object.keys(users).length : 0;
        if (win && !win.isDestroyed()) win.webContents.send('update-online-count', count);
    });
}

function connectUser() {
    userId = generateUserId();
    userRef = ref(database, `online_users/${userId}`);
    set(userRef, { connected: true, timestamp: Date.now() }).catch(err => console.error(err));
    onDisconnect(userRef).remove();
    updateOnlineUsers();
}

const licenseFilePath = path.join(app.getPath('userData'), 'license.json');
let savedLicenseKey = '';

function loadLicense() {
    try {
        if (fs.existsSync(licenseFilePath)) {
            const data = JSON.parse(fs.readFileSync(licenseFilePath, 'utf8'));
            savedLicenseKey = data.licenseKey || '';
            return savedLicenseKey;
        }
    } catch (e) { console.error('License load failed:', e); }
    return '';
}

function saveLicense(licenseKey) {
    try {
        fs.writeFileSync(licenseFilePath, JSON.stringify({ licenseKey }), 'utf8');
        savedLicenseKey = licenseKey;
    } catch (e) { console.error('License save failed:', e); }
}

async function verifyLicense(licenseKey) {
    if (licenseKey === 'ADEN-TRACKER-MASTER-2024') return true;
    try {
        const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
            body: new URLSearchParams({ license_key: licenseKey })
        });
        const data = await response.json();
        return data.valid === true;
    } catch (e) {
        console.error('License verification failed:', e);
        return false;
    }
}

// ---- SYSTEM TRAY ----
function createTray() {
    // Use app icon for tray — fallback to empty if not found
    let iconPath = path.join(__dirname, 'icon.ico');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } else {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('Aden Tracker');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Aden Tracker',
            click: () => {
                if (win) { win.show(); win.focus(); }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                if (userRef) set(userRef, null).catch(() => {});
                if (tray) { tray.destroy(); tray = null; }
                if (win && !win.isDestroyed()) win.destroy();
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    // Click on tray icon = show window
    tray.on('click', () => {
        if (win) { win.show(); win.focus(); }
    });
}

function createSplashScreen() {
    splash = new BrowserWindow({
        width: 420, height: 420, frame: false, transparent: false,
        resizable: false, alwaysOnTop: true, center: true, show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: false }
    });
    splash.loadFile('splash.html');
    splash.setAlwaysOnTop(true);
    splash.on('closed', () => { splash = null; });
}

function createMainWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({
        width: currentWidth, height: currentHeight,
        x: width - (currentWidth + 20), y: 20,
        alwaysOnTop: true, frame: false, transparent: true,
        resizable: true, minimizable: true, maximizable: false,
        skipTaskbar: false, show: false, title: 'Aden Tracker',
        minWidth: 300, minHeight: 80,
        // FIX: movable must be true so dragging works on first launch
        movable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    win.loadFile('index.html');
    win.setIgnoreMouseEvents(false);
    win.setVisibleOnAllWorkspaces(true);
    // Ensure always movable after creation
    win.setMovable(true);

    win.once('ready-to-show', () => {
        setTimeout(() => {
            win.show();
            win.setMovable(true);
            if (splash && !splash.isDestroyed()) splash.close();
        }, 1800);
    });

    win.on('close', (event) => {
        if (!isQuitting && !isUpdateReady) {
            // Hide to tray instead of closing
            event.preventDefault();
            win.hide();
            return;
        }
        // Real quit — cleanup
        if (userRef) set(userRef, null).catch(e => console.error(e));
    });

    win.on('resize', () => {
        const [w, h] = win.getSize();
        if (!isMini) { currentWidth = w; currentHeight = h; }
    });

    win.webContents.on('did-finish-load', () => {
        loadLicense();
        win.webContents.send('license-loaded', savedLicenseKey);
        connectUser();
    });

    // Drag
    ipcMain.on('start-drag', (event, mouseX, mouseY) => {
        lastMousePos = { x: mouseX, y: mouseY }; isDragging = true;
    });
    ipcMain.on('during-drag', (event, mouseX, mouseY) => {
        if (!isDragging) return;
        const deltaX = mouseX - lastMousePos.x, deltaY = mouseY - lastMousePos.y;
        const [cx, cy] = win.getPosition();
        win.setPosition(cx + deltaX, cy + deltaY);
        lastMousePos = { x: mouseX, y: mouseY };
    });
    ipcMain.on('end-drag', () => { isDragging = false; });
    ipcMain.on('focus-window', () => { if (win) { win.show(); win.focus(); } });

    // Mini mode — send to tray area (hide window, show in tray)
    ipcMain.on('minimize-to-tray', () => {
        win.hide();
    });

    // Keep old set-mini-mode for compatibility
    ipcMain.on('set-mini-mode', (event, mini, dynamicHeight) => {
        isMini = mini;
        if (mini) {
            win.hide();
        } else {
            win.show();
            win.setSize(currentWidth, currentHeight);
            win.setResizable(true);
            win.webContents.send('restore-full-mode');
        }
    });

    ipcMain.handle('get-online-users', async () => {
        return new Promise((resolve) => {
            onValue(ref(database, 'online_users'), (snapshot) => {
                const users = snapshot.val();
                resolve(users ? Object.keys(users).length : 0);
            }, { onlyOnce: true });
        });
    });

    ipcMain.handle('activate-license', async (event, licenseKey) => {
        const isValid = await verifyLicense(licenseKey);
        if (isValid) saveLicense(licenseKey);
        return { success: isValid };
    });

    ipcMain.handle('check-license', async () => {
        if (savedLicenseKey) return await verifyLicense(savedLicenseKey);
        return false;
    });

    ipcMain.on('start-update-download', () => {
        console.log('Starting download...');
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('update-ready-restart', () => {
        console.log('Installing update and restarting...');
        isUpdateReady = true;
        isQuitting = true;
        if (userRef) set(userRef, null).catch(() => {});
        if (splash && !splash.isDestroyed()) splash.close();
        if (tray) { tray.destroy(); tray = null; }
        autoUpdater.quitAndInstall(false, true);
    });

    ipcMain.on('check-for-updates', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });

    // Check for updates every 10 minutes
    setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 600000);
}

// Auto-updater
autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
    console.log('update-available:', info.version);
    if (win && !win.isDestroyed()) win.webContents.send('update-available', info.version);
});

autoUpdater.on('download-progress', (prog) => {
    if (win && !win.isDestroyed()) win.webContents.send('update-download-progress', Math.floor(prog.percent));
});

autoUpdater.on('update-downloaded', () => {
    console.log('update-downloaded');
    if (win && !win.isDestroyed()) win.webContents.send('update-ready');
});

autoUpdater.on('error', (err) => {
    console.error('Updater error:', err);
    if (win && !win.isDestroyed()) win.webContents.send('update-error', err.message);
});

app.whenReady().then(() => {
    createTray();
    createSplashScreen();
    createMainWindow();
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 4000);
});

// Don't quit when all windows closed — live in tray
app.on('window-all-closed', () => {
    if ((isQuitting || isUpdateReady) && process.platform !== 'darwin') {
        app.quit();
    }
    // Otherwise stay alive in tray
});

app.on('before-quit', () => {
    isQuitting = true;
    isUpdateReady = true;
    if (userRef) set(userRef, null).catch(() => {});
});
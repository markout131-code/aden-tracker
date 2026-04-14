const { app, BrowserWindow, ipcMain, screen } = require('electron');
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

let win = null, splash = null;
let lastMousePos = { x: 0, y: 0 }, isDragging = false;
let currentWidth = 360, currentHeight = 600;
let userId = null, userRef = null;
let isMini = false;

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

// License
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
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    win.loadFile('index.html');
    win.setIgnoreMouseEvents(false);
    win.setVisibleOnAllWorkspaces(true);

    win.once('ready-to-show', () => {
        setTimeout(() => {
            win.show();
            if (splash && !splash.isDestroyed()) splash.close();
        }, 1800);
    });

    win.on('close', () => {
        if (userRef) set(userRef, null).catch(e => console.error(e));
        app.isQuitting = true;
        app.quit();
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

    // Mini mode toggle — minimize window
    ipcMain.on('set-mini-mode', (event, mini) => {
        if (mini) {
            win.minimize();
        } else {
            win.restore();
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

    // Auto-updater IPC
    ipcMain.on('start-update-download', () => {
        autoUpdater.downloadUpdate();
    });
    ipcMain.on('update-ready-restart', () => {
        autoUpdater.quitAndInstall();
    });
    ipcMain.on('check-for-updates', () => {
        autoUpdater.checkForUpdatesAndNotify();
    });
}

// Auto-updater config
autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
    if (win && !win.isDestroyed()) win.webContents.send('update-available', info.version);
});
autoUpdater.on('download-progress', (prog) => {
    if (win && !win.isDestroyed()) win.webContents.send('update-download-progress', Math.floor(prog.percent));
});
autoUpdater.on('update-downloaded', () => {
    if (win && !win.isDestroyed()) win.webContents.send('update-ready');
});
autoUpdater.on('error', (err) => { console.error('Updater error:', err); });

app.whenReady().then(() => {
    createSplashScreen();
    createMainWindow();
    setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
    }, 4000);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
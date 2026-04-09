const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, onDisconnect, onValue } = require('firebase/database');
const { autoUpdater } = require('electron-updater');

// Διάβασε την έκδοση από το package.json για το splash
const packageJson = require('./package.json');
const appVersion = packageJson.version;
console.log('App version:', appVersion);

// ============ Firebase Configuration ============
const firebaseConfig = {
  apiKey: "AIzaSyDVaqfuus1ZBLA_7LSN2ka2gHB6gZR2Wik",
  authDomain: "aden-tracker-fcc98.firebaseapp.com",
  databaseURL: "https://aden-tracker-fcc98-default-rtdb.firebaseio.com",
  projectId: "aden-tracker-fcc98",
  storageBucket: "aden-tracker-fcc98.firebasestorage.app",
  messagingSenderId: "39413049768",
  appId: "1:39413049768:web:28fce937565f9b895c159d"
};
// ==============================================

// Αρχικοποίηση Firebase
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

app.setName('Aden Tracker');

if (process.platform === 'win32') {
    app.setAppUserModelId('com.aden.tracker');
}

app.disableHardwareAcceleration();

let win = null;
let splash = null;
let lastMousePos = { x: 0, y: 0 };
let isDragging = false;
let currentWidth = 360;
let currentHeight = 580;
let userId = null;
let userRef = null;
let keepAliveInterval = null;

// Δημιουργία μοναδικού ID για αυτόν τον χρήστη
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Ενημέρωση online χρηστών
function updateOnlineUsers() {
    const usersRef = ref(database, 'online_users');
    
    onValue(usersRef, (snapshot) => {
        const users = snapshot.val();
        let count = 0;
        if (users) {
            // Μετράμε μόνο όσους έχουν connected: true
            Object.values(users).forEach(user => {
                if (user.connected === true) count++;
            });
        }
        
        if (win && !win.isDestroyed()) {
            win.webContents.send('update-online-count', count);
        }
    });
}

// Σύνδεση χρήστη
function connectUser() {
    userId = generateUserId();
    userRef = ref(database, `online_users/${userId}`);
    
    set(userRef, {
        connected: true,
        status: 'online',
        timestamp: Date.now()
    }).catch(err => console.error('Error connecting user:', err));
    
    // Αντί για remove, βάζουμε 'offline' όταν αποσυνδεθεί
    onDisconnect(userRef).update({
        connected: false,
        status: 'offline',
        timestamp: Date.now()
    });
    
    // Keep-alive κάθε 25 δευτερόλεπτα
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
        if (userRef) {
            set(userRef, {
                connected: true,
                status: 'online',
                timestamp: Date.now()
            }).catch(err => console.error('Keep-alive error:', err));
        }
    }, 25000);
    
    updateOnlineUsers();
}

// License file path
const licenseFilePath = path.join(app.getPath('userData'), 'license.json');
let savedLicenseKey = '';

function loadLicense() {
    try {
        if (fs.existsSync(licenseFilePath)) {
            const data = JSON.parse(fs.readFileSync(licenseFilePath, 'utf8'));
            savedLicenseKey = data.licenseKey || '';
            return savedLicenseKey;
        }
    } catch (error) {
        console.error('Failed to load license:', error);
    }
    return '';
}

function saveLicense(licenseKey) {
    try {
        fs.writeFileSync(licenseFilePath, JSON.stringify({ licenseKey }), 'utf8');
        savedLicenseKey = licenseKey;
    } catch (error) {
        console.error('Failed to save license:', error);
    }
}

async function verifyLicense(licenseKey) {
    const MASTER_KEY = 'ADEN-TRACKER-MASTER-2024';
    
    if (licenseKey === MASTER_KEY) {
        console.log('Master key used - access granted');
        return true;
    }
    
    try {
        const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                license_key: licenseKey
            })
        });
        
        const data = await response.json();
        return data.valid === true;
    } catch (error) {
        console.error('License verification failed:', error);
        return false;
    }
}

// Δημιουργία Splash Screen
function createSplashScreen() {
    splash = new BrowserWindow({
        width: 400,
        height: 400,
        frame: false,
        transparent: false,
        resizable: false,
        alwaysOnTop: true,
        center: true,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: false
        }
    });
    
    // Φόρτωσε το splash.html με την έκδοση ως query parameter
    splash.loadFile('splash.html', {
        query: { version: appVersion }
    });
    
    splash.setAlwaysOnTop(true);
    
    splash.on('closed', () => {
        splash = null;
    });
}

// Δημιουργία Κύριου Παραθύρου
function createMainWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    
    win = new BrowserWindow({
        width: currentWidth,
        height: currentHeight,
        x: width - (currentWidth + 20),
        y: 20,
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        resizable: true,
        minimizable: true,
        maximizable: false,
        skipTaskbar: false,
        show: false,
        title: 'Aden Tracker',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');
    win.setIgnoreMouseEvents(false);
    win.setVisibleOnAllWorkspaces(true);
    
    win.once('ready-to-show', () => {
        setTimeout(() => {
            win.show();
            if (splash && !splash.isDestroyed()) {
                splash.close();
            }
        }, 1500);
    });

    win.on('close', (event) => {
        if (userRef) {
            set(userRef, null).catch(err => console.error('Error removing user:', err));
        }
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }
    });
    
    win.on('resize', () => {
        const [width, height] = win.getSize();
        currentWidth = width;
        currentHeight = height;
    });

    win.webContents.on('did-finish-load', () => {
        const savedLicense = loadLicense();
        win.webContents.send('license-loaded', savedLicense);
        connectUser();
    });

    // Drag functionality
    ipcMain.on('start-drag', (event, mouseX, mouseY) => {
        lastMousePos = { x: mouseX, y: mouseY };
        isDragging = true;
    });

    ipcMain.on('during-drag', (event, mouseX, mouseY) => {
        if (isDragging) {
            const deltaX = mouseX - lastMousePos.x;
            const deltaY = mouseY - lastMousePos.y;
            const [currentX, currentY] = win.getPosition();
            win.setPosition(currentX + deltaX, currentY + deltaY);
            lastMousePos = { x: mouseX, y: mouseY };
        }
    });

    ipcMain.on('end-drag', () => {
        isDragging = false;
    });

    ipcMain.on('focus-window', () => {
        if (win) {
            win.show();
            win.focus();
        }
    });

    ipcMain.handle('get-online-users', async () => {
        const usersRef = ref(database, 'online_users');
        return new Promise((resolve) => {
            onValue(usersRef, (snapshot) => {
                const users = snapshot.val();
                let count = 0;
                if (users) {
                    Object.values(users).forEach(user => {
                        if (user.connected === true) count++;
                    });
                }
                resolve(count);
            }, { onlyOnce: true });
        });
    });

    ipcMain.handle('activate-license', async (event, licenseKey) => {
        const isValid = await verifyLicense(licenseKey);
        if (isValid) {
            saveLicense(licenseKey);
        }
        return { success: isValid };
    });

    ipcMain.handle('check-license', async () => {
        if (savedLicenseKey) {
            return await verifyLicense(savedLicenseKey);
        }
        return false;
    });

    // ============ AUTO-UPDATER IPC HANDLERS ============
    ipcMain.on('start-update-download', () => {
        console.log('Starting update download...');
        autoUpdater.downloadUpdate();
    });

    ipcMain.on('update-ready-restart', () => {
        console.log('Restarting to install update...');
        performUpdate();
    });

    ipcMain.on('check-for-updates', () => {
        console.log('Manual check for updates...');
        autoUpdater.checkForUpdatesAndNotify();
    });
}

// ============ UPDATE FUNCTION ============
function performUpdate() {
    console.log('Performing update...');
    
    // Αποσύνδεση από Firebase
    if (userRef) {
        set(userRef, null).catch(() => {});
    }
    
    // Καθαρισμός interval
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
    
    // Κλείσιμο όλων των windows
    if (win && !win.isDestroyed()) {
        win.destroy();
    }
    if (splash && !splash.isDestroyed()) {
        splash.destroy();
    }
    
    // Force quit μετά από 500ms για να κλείσουν όλα
    setTimeout(() => {
        app.exit(0);
    }, 500);
}

// ============ AUTO-UPDATER SETUP ============
autoUpdater.autoDownload = true;

autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (win && !win.isDestroyed()) {
        win.webContents.send('update-available', info.version);
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    let percent = Math.floor(progressObj.percent);
    console.log(`Downloading... ${percent}%`);
    if (win && !win.isDestroyed()) {
        win.webContents.send('update-download-progress', percent);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded, ready to install');
    if (win && !win.isDestroyed()) {
        win.webContents.send('update-ready');
    }
    // Auto install after 2 seconds
    setTimeout(() => {
        performUpdate();
    }, 2000);
});

autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
});

autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'markout131-code',
    repo: 'aden-tracker'
});

// ============ APP READY ============
app.whenReady().then(() => {
    createSplashScreen();
    createMainWindow();
    
    // Logging για auto updater
    autoUpdater.logger = console;
    
    // Έλεγχος για updates 3 δευτερόλεπτα μετά το launch
    setTimeout(() => {
        console.log('Checking for updates on startup...');
        autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
    
    // Periodic check κάθε 15 λεπτά
    setInterval(() => {
        console.log('Periodic check for updates...');
        autoUpdater.checkForUpdatesAndNotify();
    }, 15 * 60 * 1000);
});

// Force quit όταν κλείνει όλα τα windows
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
        }
        app.exit(0);
    }
});

// Επιπλέον ασφάλεια: αν μείνει κάτι ανοιχτό, κλείστο
app.on('will-quit', () => {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
    if (userRef) {
        set(userRef, null).catch(() => {});
    }
    app.exit(0);
});
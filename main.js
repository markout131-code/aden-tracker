const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, onDisconnect, onValue } = require('firebase/database');

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
            count = Object.keys(users).length;
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
        timestamp: Date.now()
    }).catch(err => console.error('Error connecting user:', err));
    
    onDisconnect(userRef).remove();
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
    
    splash.loadFile('splash.html');
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
        app.isQuitting = true;
        app.quit();
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
                const count = users ? Object.keys(users).length : 0;
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
}

app.whenReady().then(() => {
    createSplashScreen();
    createMainWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
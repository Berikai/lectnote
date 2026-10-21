const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Determine persistent settings file path
const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function getDefaultLecturesDir() {
  if (app.isPackaged) {
    return path.join(app.getPath('documents'), 'LectNote', 'lectures');
  }
  const repoLectures = path.resolve(__dirname, '..', 'lectures');
  if (fs.existsSync(repoLectures) && !repoLectures.includes('.asar')) {
    return repoLectures;
  }
  return path.join(app.getPath('documents'), 'LectNote', 'lectures');
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return data || {};
    }
  } catch (err) {
    console.error('Failed to read settings.json:', err);
  }
  return {};
}

// Pre-initialize LECTURES_DIR before loading embedded server module
try {
  const currentSettings = loadSettings();
  const initialDir = currentSettings.lecturesDir || getDefaultLecturesDir();
  if (initialDir) {
    process.env.LECTURES_DIR = initialDir;
  }
} catch (e) {
  // Graceful fallback
}

const { startServer, setLecturesDir, getLecturesDir } = require('../server/app');

let mainWindow = null;
let serverInstance = null;
let serverPort = null;

function saveSettings(updates = {}) {
  try {
    const current = loadSettings();
    const next = { ...current, ...updates };
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (err) {
    console.error('Failed to save settings.json:', err);
    return updates;
  }
}

// Ensure single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function createWindow() {
  const settings = loadSettings();
  const defaultDir = getDefaultLecturesDir();
  const activeLecturesDir = settings.lecturesDir || defaultDir;

  // Set lectures directory before starting the embedded server
  setLecturesDir(activeLecturesDir);

  // Start internal server on preferred port, falling back to ephemeral port (port 0) if occupied
  const PREFERRED_PORT = 31872;
  try {
    try {
      const { server, port } = await startServer(PREFERRED_PORT, activeLecturesDir);
      serverInstance = server;
      serverPort = port;
    } catch (portErr) {
      console.warn(`Preferred port ${PREFERRED_PORT} unavailable (${portErr.message}), falling back to ephemeral port.`);
      const { server, port } = await startServer(0, activeLecturesDir);
      serverInstance = server;
      serverPort = port;
    }
  } catch (err) {
    console.error('Failed to start internal server:', err);
    dialog.showErrorBox('Initialization Error', `Failed to start LectNote backend: ${err.message}`);
    app.quit();
    return;
  }

  const bounds = settings.windowBounds || { width: 1400, height: 900 };

  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

  const windowOptions = {
    width: bounds.width || 1400,
    height: bounds.height || 900,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 620,
    title: 'LectNote Studio',
    backgroundColor: '#ffffff',
    show: false,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 14, y: 19 };
    if (app.dock && fs.existsSync(iconPath)) {
      try {
        app.dock.setIcon(iconPath);
      } catch (err) {
        console.warn('Failed to set dock icon:', err.message);
      }
    }
  } else if (isWin) {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: '#ffffff',
      symbolColor: '#181d26',
      height: 48
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Track window resizing and moving
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      saveSettings({ windowBounds: mainWindow.getBounds() });
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Broadcast fullscreen state changes to the renderer
  const notifyFullscreenChange = () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
    mainWindow.webContents.send('window:fullscreen-change', mainWindow.isFullScreen());
  };
  mainWindow.on('enter-full-screen', notifyFullscreenChange);
  mainWindow.on('leave-full-screen', notifyFullscreenChange);
  mainWindow.on('enter-html-full-screen', notifyFullscreenChange);
  mainWindow.on('leave-html-full-screen', notifyFullscreenChange);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      // Allow internal standalone print/render views inside app
      if (url.includes(`localhost:${serverPort}/api/lectures`)) {
        return { action: 'allow' };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  buildAppMenu();

  // Load the web studio UI hosted by the internal embedded server with saved workspace session parameters
  const query = new URLSearchParams();
  if (settings.lastCourse) query.set('course', settings.lastCourse);
  if (settings.lastLecture) query.set('lecture', settings.lastLecture);
  const lastView = settings.viewMode || settings.lastView;
  if (lastView) query.set('view', lastView);
  const queryString = query.toString() ? `?${query.toString()}` : '';
  await mainWindow.loadURL(`http://localhost:${serverPort}${queryString}`);
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Preferences...',
              accelerator: 'CmdOrCtrl+,',
              click: () => mainWindow?.webContents.send('menu:action', 'open-settings')
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Lecture',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:action', 'new-lecture')
        },
        {
          label: 'Save Notes',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:action', 'save-notes')
        },
        { type: 'separator' },
        {
          label: 'Export PDF',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:action', 'export-pdf')
        },
        {
          label: 'Print View',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:action', 'print-view')
        },
        { type: 'separator' },
        {
          label: 'Open Lectures Folder',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            await shell.openPath(getLecturesDir());
          }
        },
        ...(!isMac
          ? [
              { type: 'separator' },
              {
                label: 'Settings',
                accelerator: 'Ctrl+,',
                click: () => mainWindow?.webContents.send('menu:action', 'open-settings')
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          : [
              { type: 'separator' },
              { role: 'close' }
            ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:action', 'editor-find')
        },
        {
          label: 'Find and Replace...',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => mainWindow?.webContents.send('menu:action', 'editor-replace')
        },
        {
          label: 'Find Next',
          accelerator: 'CmdOrCtrl+G',
          click: () => mainWindow?.webContents.send('menu:action', 'editor-find-next')
        },
        {
          label: 'Find Previous',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => mainWindow?.webContents.send('menu:action', 'editor-find-prev')
        },
        { type: 'separator' },
        {
          label: 'Go to Line...',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('menu:action', 'editor-go-to-line')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Split View',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:action', 'view-split')
        },
        {
          label: 'Editor Only',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:action', 'view-editor')
        },
        {
          label: 'Preview Only',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('menu:action', 'view-preview')
        },
        { type: 'separator' },
        {
          label: 'Zoom In Preview',
          accelerator: 'CmdOrCtrl+Shift+=',
          click: () => mainWindow?.webContents.send('menu:action', 'preview-zoom-in')
        },
        {
          label: 'Zoom Out Preview',
          accelerator: 'CmdOrCtrl+Shift+-',
          click: () => mainWindow?.webContents.send('menu:action', 'preview-zoom-out')
        },
        {
          label: 'Reset Preview Zoom',
          accelerator: 'CmdOrCtrl+Shift+0',
          click: () => mainWindow?.webContents.send('menu:action', 'preview-zoom-reset')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ]
          : [{ role: 'close' }])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'LectNote on GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/berikai/lectnote');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// -----------------------------------------------------------------------------
// IPC Handlers
// -----------------------------------------------------------------------------

ipcMain.handle('settings:get', async () => {
  const settings = loadSettings();
  return {
    ...settings,
    lecturesDir: getLecturesDir(),
    defaultLecturesDir: getDefaultLecturesDir(),
    isElectron: true,
    appVersion: app.getVersion(),
    platform: process.platform
  };
});

ipcMain.handle('settings:save', async (_event, updates) => {
  if (!updates || typeof updates !== 'object') return { success: false };
  const updated = saveSettings(updates);
  return { success: true, settings: updated };
});

ipcMain.handle('window:is-fullscreen', async () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('settings:select-directory', async () => {
  if (!mainWindow) return { success: false, canceled: true };

  const currentDir = getLecturesDir();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Lectures Directory',
    defaultPath: currentDir && fs.existsSync(currentDir) ? currentDir : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const chosenPath = result.filePaths[0];
  setLecturesDir(chosenPath);
  saveSettings({ lecturesDir: chosenPath });

  return {
    success: true,
    lecturesDir: chosenPath
  };
});

ipcMain.handle('settings:open-folder', async (_event, folderPath) => {
  const target = folderPath || getLecturesDir();
  if (target && fs.existsSync(target)) {
    await shell.openPath(target);
    return { success: true };
  }
  return { success: false, error: 'Directory does not exist' };
});

ipcMain.handle('settings:reset-directory', async () => {
  const defaultDir = getDefaultLecturesDir();
  setLecturesDir(defaultDir);
  saveSettings({ lecturesDir: defaultDir });
  return {
    success: true,
    lecturesDir: defaultDir
  };
});

ipcMain.handle('theme:update-overlay', async (_event, colorMode) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  const isDark = colorMode === 'dark';
  const bgColor = isDark ? '#12161f' : '#ffffff';
  mainWindow.setBackgroundColor(bgColor);

  if (process.platform === 'win32') {
    try {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#12161f' : '#ffffff',
        symbolColor: isDark ? '#f0f6fc' : '#181d26',
        height: 48
      });
    } catch (e) {
      // Ignore if unsupported
    }
  }
  return { success: true };
});

ipcMain.handle('export:pdf', async (_event, { course, lecture, theme }) => {
  if (!serverPort) {
    return { success: false, error: 'Internal server is not running' };
  }

  const defaultFilename = `${course || 'Course'}_${lecture || 'Lecture'}.pdf`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Lecture to Vector PDF',
    defaultPath: path.join(app.getPath('documents'), defaultFilename),
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  const exportWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  try {
    const renderUrl = `http://localhost:${serverPort}/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/render?theme=${encodeURIComponent(theme || 'notebook')}`;
    await exportWindow.loadURL(renderUrl);

    // Wait until window.__LECTNOTE_READY__ is true
    await exportWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (window.__LECTNOTE_READY__) return resolve(true);
        const start = Date.now();
        const check = setInterval(() => {
          if (window.__LECTNOTE_READY__ || Date.now() - start > 12000) {
            clearInterval(check);
            resolve(true);
          }
        }, 100);
      });
    `);

    // Give Rough Notation layout settle time
    await new Promise(r => setTimeout(r, 450));

    // Generate PDF using Electron's native engine
    const pdfData = await exportWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: {
        top: 0.4,
        bottom: 0.5,
        left: 0.4,
        right: 0.4
      }
    });

    fs.writeFileSync(result.filePath, pdfData);

    return {
      success: true,
      filePath: result.filePath
    };
  } catch (err) {
    console.error('Electron native printToPDF error:', err);
    return { success: false, error: err.message };
  } finally {
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
  }
});

// App Lifecycle
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverInstance) {
    try {
      serverInstance.close();
    } catch (e) {
      // Ignore
    }
  }
});


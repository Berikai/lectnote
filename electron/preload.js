const { contextBridge, ipcRenderer } = require('electron');

/**
 * Securely expose desktop-specific APIs to LectNote renderer studio.
 */
contextBridge.exposeInMainWorld('lectnoteDesktop', {
  isElectron: true,
  platform: process.platform,

  /**
   * Fetch current desktop settings (lecturesDir, version, platform, lastCourse, lastLecture, lastScroll, etc.)
   */
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /**
   * Persist desktop settings updates (lastCourse, lastLecture, lastScroll, theme, etc.)
   */
  saveSettings: (updates) => ipcRenderer.invoke('settings:save', updates),

  /**
   * Prompt user with native directory picker to select lectures directory
   */
  selectLecturesDirectory: () => ipcRenderer.invoke('settings:select-directory'),

  /**
   * Open directory in native file manager (Finder / Windows Explorer)
   */
  openLecturesDirectory: (dir) => ipcRenderer.invoke('settings:open-folder', dir),

  /**
   * Reset lectures directory to default location
   */
  resetLecturesDirectory: () => ipcRenderer.invoke('settings:reset-directory'),

  /**
   * Update native titlebar overlay colors when theme or color mode changes
   */
  updateTitleBarTheme: (colorMode) => ipcRenderer.invoke('theme:update-overlay', colorMode),

  /**
   * Export lecture notes to vector PDF using Electron native printToPDF
   */
  exportPdf: (course, lecture, theme) => ipcRenderer.invoke('export:pdf', { course, lecture, theme }),

  /**
   * Check if window is currently in fullscreen mode
   */
  isFullScreen: () => ipcRenderer.invoke('window:is-fullscreen'),

  /**
   * Listen to window fullscreen state changes
   */
  onFullScreenChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isFs) => callback(isFs);
    ipcRenderer.on('window:fullscreen-change', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-change', listener);
  },

  /**
   * Listen to native menu actions (Cmd+N, Cmd+S, Cmd+E, Cmd+, etc.)
   */
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  }
});

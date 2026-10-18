const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('LectNote View Selection Persistence', () => {
  const VALID_VIEW_MODES = ['split', 'editor', 'preview'];

  function resolveInitialView({ urlQuery = '', desktopSettings = null, storage = {} } = {}) {
    let resolved = 'split';

    // 1. Storage default
    const savedStorage = storage['lectnote_view_mode'] || storage['lectnote_view'];
    if (savedStorage && VALID_VIEW_MODES.includes(savedStorage)) {
      resolved = savedStorage;
    }

    // 2. Desktop settings override
    if (desktopSettings) {
      const desktopView = desktopSettings.viewMode || desktopSettings.lastView || desktopSettings.view;
      if (desktopView && VALID_VIEW_MODES.includes(desktopView)) {
        resolved = desktopView;
      }
    }

    // 3. URL query parameter override
    try {
      const params = new URLSearchParams(urlQuery);
      const paramView = params.get('view') || params.get('viewMode');
      if (paramView && VALID_VIEW_MODES.includes(paramView)) {
        resolved = paramView;
      }
    } catch (_) {}

    return resolved;
  }

  function createViewManager(initialStorage = {}) {
    const storage = { ...initialStorage };
    const desktopSaves = [];
    const VALID = ['split', 'editor', 'preview'];

    const saved = storage['lectnote_view_mode'] || storage['lectnote_view'];
    let currentView = VALID.includes(saved) ? saved : 'split';
    let userSelectedView = currentView;

    return {
      getCurrentView: () => currentView,
      getUserSelectedView: () => userSelectedView,
      getStorage: () => storage,
      getDesktopSaves: () => desktopSaves,
      applyViewMode(mode, persist = true) {
        if (!VALID.includes(mode)) {
          mode = 'split';
        }
        currentView = mode;
        if (persist) {
          userSelectedView = mode;
          storage['lectnote_view_mode'] = mode;
          storage['lectnote_view'] = mode;
          desktopSaves.push({ viewMode: mode, lastView: mode });
        }
      },
      handleResponsiveLayout(screenWidth) {
        if (screenWidth <= 640) {
          if (currentView === 'split') {
            this.applyViewMode('preview', false);
          }
        } else {
          if (userSelectedView === 'split' && currentView !== 'split') {
            this.applyViewMode('split', false);
          }
        }
      }
    };
  }

  it('defaults to split view when no saved view is present', () => {
    const view = resolveInitialView();
    assert.strictEqual(view, 'split');
  });

  it('restores editor view from localStorage', () => {
    const view = resolveInitialView({
      storage: { lectnote_view_mode: 'editor' }
    });
    assert.strictEqual(view, 'editor');
  });

  it('restores preview view from legacy lectnote_view key', () => {
    const view = resolveInitialView({
      storage: { lectnote_view: 'preview' }
    });
    assert.strictEqual(view, 'preview');
  });

  it('ignores invalid view values and defaults to split', () => {
    const view = resolveInitialView({
      storage: { lectnote_view_mode: 'invalid_mode_name' }
    });
    assert.strictEqual(view, 'split');
  });

  it('prioritizes desktop settings over localStorage', () => {
    const view = resolveInitialView({
      storage: { lectnote_view_mode: 'split' },
      desktopSettings: { viewMode: 'editor' }
    });
    assert.strictEqual(view, 'editor');
  });

  it('prioritizes explicit URL query parameters over desktop and storage', () => {
    const view = resolveInitialView({
      urlQuery: '?view=preview',
      storage: { lectnote_view_mode: 'split' },
      desktopSettings: { viewMode: 'editor' }
    });
    assert.strictEqual(view, 'preview');
  });

  it('persists view changes across switching (split -> editor -> preview)', () => {
    const vm = createViewManager({ lectnote_view_mode: 'split' });
    assert.strictEqual(vm.getCurrentView(), 'split');

    // Switch to editor
    vm.applyViewMode('editor', true);
    assert.strictEqual(vm.getCurrentView(), 'editor');
    assert.strictEqual(vm.getStorage()['lectnote_view_mode'], 'editor');
    assert.strictEqual(vm.getStorage()['lectnote_view'], 'editor');
    assert.deepStrictEqual(vm.getDesktopSaves()[0], { viewMode: 'editor', lastView: 'editor' });

    // Switch to preview
    vm.applyViewMode('preview', true);
    assert.strictEqual(vm.getCurrentView(), 'preview');
    assert.strictEqual(vm.getStorage()['lectnote_view_mode'], 'preview');
    assert.strictEqual(vm.getStorage()['lectnote_view'], 'preview');

    // Switch back to split
    vm.applyViewMode('split', true);
    assert.strictEqual(vm.getCurrentView(), 'split');
    assert.strictEqual(vm.getStorage()['lectnote_view_mode'], 'split');
  });

  it('preserves user split selection during responsive mobile layout and restores on expand', () => {
    const vm = createViewManager({ lectnote_view_mode: 'split' });
    assert.strictEqual(vm.getCurrentView(), 'split');
    assert.strictEqual(vm.getUserSelectedView(), 'split');

    // Shrink to mobile width (500px)
    vm.handleResponsiveLayout(500);
    assert.strictEqual(vm.getCurrentView(), 'preview'); // Temporarily preview
    // Storage must NOT be overwritten!
    assert.strictEqual(vm.getUserSelectedView(), 'split');
    assert.strictEqual(vm.getStorage()['lectnote_view_mode'], 'split');

    // Expand back to desktop width (1200px)
    vm.handleResponsiveLayout(1200);
    assert.strictEqual(vm.getCurrentView(), 'split'); // Restored!
  });

  it('persists explicit view selection made while on mobile', () => {
    const vm = createViewManager({ lectnote_view_mode: 'split' });
    vm.handleResponsiveLayout(480); // mobile
    assert.strictEqual(vm.getCurrentView(), 'preview');

    // User explicitly clicks 'editor' while on mobile
    vm.applyViewMode('editor', true);
    assert.strictEqual(vm.getCurrentView(), 'editor');
    assert.strictEqual(vm.getUserSelectedView(), 'editor');
    assert.strictEqual(vm.getStorage()['lectnote_view_mode'], 'editor');

    // Resizing to desktop retains editor mode
    vm.handleResponsiveLayout(1024);
    assert.strictEqual(vm.getCurrentView(), 'editor');
  });
});


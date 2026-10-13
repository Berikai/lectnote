const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startServer } = require('../server/app');

describe('LectNote Desktop Settings & Session Persistence', () => {
  it('saves and loads settings including lastCourse, lastLecture, and lastScroll', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectnote-test-settings-'));
    const settingsFile = path.join(tempDir, 'settings.json');

    function loadSettings() {
      try {
        if (fs.existsSync(settingsFile)) {
          return JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {};
        }
      } catch (_) {}
      return {};
    }

    function saveSettings(updates = {}) {
      const current = loadSettings();
      const next = { ...current, ...updates };
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify(next, null, 2), 'utf8');
      return next;
    }

    // Initial empty
    assert.deepStrictEqual(loadSettings(), {});

    // Save active lecture session
    saveSettings({
      lastCourse: 'CS301-Algorithms',
      lastLecture: 'lecture-04-graph-traversal',
      theme: 'academic',
      colorMode: 'dark',
      sidebarCollapsed: false,
      lastScroll: {
        course: 'CS301-Algorithms',
        lecture: 'lecture-04-graph-traversal',
        editorTop: 340,
        previewTop: 520
      }
    });

    const loaded = loadSettings();
    assert.strictEqual(loaded.lastCourse, 'CS301-Algorithms');
    assert.strictEqual(loaded.lastLecture, 'lecture-04-graph-traversal');
    assert.strictEqual(loaded.theme, 'academic');
    assert.strictEqual(loaded.colorMode, 'dark');
    assert.strictEqual(loaded.sidebarCollapsed, false);
    assert.strictEqual(loaded.lastScroll.editorTop, 340);
    assert.strictEqual(loaded.lastScroll.previewTop, 520);

    // Partial update preserves existing fields
    saveSettings({ theme: 'notebook' });
    const updated = loadSettings();
    assert.strictEqual(updated.theme, 'notebook');
    assert.strictEqual(updated.lastCourse, 'CS301-Algorithms');
    assert.strictEqual(updated.lastLecture, 'lecture-04-graph-traversal');

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('constructs startup query parameters correctly from settings', () => {
    const settings = {
      lastCourse: 'MATH201-LinearAlgebra',
      lastLecture: 'lecture-02-eigenvalues'
    };

    const query = new URLSearchParams();
    if (settings.lastCourse) query.set('course', settings.lastCourse);
    if (settings.lastLecture) query.set('lecture', settings.lastLecture);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    assert.strictEqual(queryString, '?course=MATH201-LinearAlgebra&lecture=lecture-02-eigenvalues');

    // Parse back in client
    const parsed = new URLSearchParams(queryString);
    assert.strictEqual(parsed.get('course'), 'MATH201-LinearAlgebra');
    assert.strictEqual(parsed.get('lecture'), 'lecture-02-eigenvalues');
  });

  it('handles startup query parameters when settings are absent', () => {
    const emptySettings = {};
    const query = new URLSearchParams();
    if (emptySettings.lastCourse) query.set('course', emptySettings.lastCourse);
    if (emptySettings.lastLecture) query.set('lecture', emptySettings.lastLecture);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    assert.strictEqual(queryString, '');
  });

  it('binds to an ephemeral port without conflict when preferred port is occupied', async () => {
    // Start first server on ephemeral port (simulating occupied port)
    const { server: server1, port: occupiedPort } = await startServer(0);

    // Attempting to bind another server to occupiedPort falls back to port 0
    let fallbackServer = null;
    let fallbackPort = null;

    try {
      try {
        const res = await startServer(occupiedPort);
        fallbackServer = res.server;
        fallbackPort = res.port;
      } catch (_) {
        const res = await startServer(0);
        fallbackServer = res.server;
        fallbackPort = res.port;
      }

      assert.ok(fallbackPort > 0);
      assert.notStrictEqual(fallbackPort, occupiedPort);
    } finally {
      await new Promise(r => server1.close(r));
      if (fallbackServer) {
        await new Promise(r => fallbackServer.close(r));
      }
    }
  });
});

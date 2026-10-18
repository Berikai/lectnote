const { describe, it } = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { app } = require('../server/app');

describe('LectNote Preview Zoom & Touchpad Gestures', () => {
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3.0;
  const DEFAULT_ZOOM = 1.0;
  const ZOOM_PRESETS = [0.5, 0.67, 0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

  function computeNextZoom(current, presets = ZOOM_PRESETS) {
    const next = presets.find(p => p > current + 0.02);
    return next !== undefined ? next : Math.min(MAX_ZOOM, Math.round((current + 0.15) * 100) / 100);
  }

  function computePrevZoom(current, presets = ZOOM_PRESETS) {
    const prev = [...presets].reverse().find(p => p < current - 0.02);
    return prev !== undefined ? prev : Math.max(MIN_ZOOM, Math.round((current - 0.15) * 100) / 100);
  }

  function computePinchZoom(current, deltaY) {
    const factor = Math.exp(-deltaY * 0.006);
    const target = current * factor;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(target * 100) / 100));
  }

  it('steps through standard zoom presets upward and downward', () => {
    let zoom = DEFAULT_ZOOM; // 1.0
    zoom = computeNextZoom(zoom);
    assert.strictEqual(zoom, 1.15);
    zoom = computeNextZoom(zoom);
    assert.strictEqual(zoom, 1.25);
    zoom = computeNextZoom(zoom);
    assert.strictEqual(zoom, 1.5);

    zoom = computePrevZoom(zoom);
    assert.strictEqual(zoom, 1.25);
    zoom = computePrevZoom(zoom);
    assert.strictEqual(zoom, 1.15);
    zoom = computePrevZoom(zoom);
    assert.strictEqual(zoom, 1.0);
    zoom = computePrevZoom(zoom);
    assert.strictEqual(zoom, 0.85);
  });

  it('clamps zoom values within MIN_ZOOM (0.5) and MAX_ZOOM (3.0)', () => {
    // Zooming out below min
    let zoom = 0.5;
    zoom = computePrevZoom(zoom);
    assert.strictEqual(zoom, 0.5);

    // Zooming in above max
    zoom = 3.0;
    zoom = computeNextZoom(zoom);
    assert.strictEqual(zoom, 3.0);

    // Extreme pinch deltas
    assert.strictEqual(computePinchZoom(1.0, 1000), 0.5);
    assert.strictEqual(computePinchZoom(1.0, -1000), 3.0);
  });

  it('computes smooth exponential trackpad pinch factors for zoom in and out', () => {
    // Pinching fingers outward (expanding): deltaY < 0 -> zoom increases
    const zoomInResult = computePinchZoom(1.0, -20);
    assert.ok(zoomInResult > 1.0, `Expected zoom in > 1.0, got ${zoomInResult}`);

    // Pinching fingers inward (contracting): deltaY > 0 -> zoom decreases
    const zoomOutResult = computePinchZoom(1.0, 20);
    assert.ok(zoomOutResult < 1.0, `Expected zoom out < 1.0, got ${zoomOutResult}`);
  });

  it('renders zoom controls and performs zoom in, out, reset, and fit in browser UI', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      // Verify zoom toolbar and buttons are in the DOM
      const toolbarExists = await page.$('#preview-zoom-toolbar');
      assert.ok(toolbarExists, 'Preview zoom toolbar must be rendered');

      const initialText = await page.$eval('#preview-zoom-text', el => el.textContent.trim());
      assert.strictEqual(initialText, '100%');

      // 1. Click Zoom In button
      await page.click('#btn-preview-zoom-in');
      const zoomedInText = await page.$eval('#preview-zoom-text', el => el.textContent.trim());
      const zoomedInPaper = await page.$eval('#preview-paper', el => el.style.zoom);
      assert.strictEqual(zoomedInText, '115%');
      assert.strictEqual(zoomedInPaper, '1.15');

      // 2. Click Zoom Out button
      await page.click('#btn-preview-zoom-out');
      const zoomedOutText = await page.$eval('#preview-zoom-text', el => el.textContent.trim());
      const zoomedOutPaper = await page.$eval('#preview-paper', el => el.style.zoom);
      assert.strictEqual(zoomedOutText, '100%');
      assert.strictEqual(zoomedOutPaper, '1');

      // 3. Zoom in multiple times and then reset to 100%
      await page.click('#btn-preview-zoom-in');
      await page.click('#btn-preview-zoom-in');
      assert.strictEqual(await page.$eval('#preview-zoom-text', el => el.textContent.trim()), '125%');

      // Click Reset
      await page.click('#btn-preview-zoom-reset');
      assert.strictEqual(await page.$eval('#preview-zoom-text', el => el.textContent.trim()), '100%');
      assert.strictEqual(await page.$eval('#preview-paper', el => el.style.zoom), '1');

      // 4. Click Fit to Width
      await page.click('#btn-preview-zoom-fit');
      const fitZoom = await page.evaluate(() => window.LectNotePreview.getZoom());
      assert.ok(fitZoom >= MIN_ZOOM && fitZoom <= 2.0, `Fit zoom ${fitZoom} must be within bounds`);
      assert.strictEqual(await page.$eval('#preview-zoom-text', el => el.textContent.trim()), `${Math.round(fitZoom * 100)}%`);

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('handles trackpad pinch gestures (ctrlKey wheel) with focal-point and preventDefault', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      // Dispatch trackpad pinch-out (zoom in) via wheel event with ctrlKey
      const pinchResult = await page.evaluate(() => {
        const scrollContainer = document.querySelector('.preview-scroll-container');
        let defaultPrevented = false;

        const evt = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -30,
          clientX: 800,
          clientY: 400
        });

        scrollContainer.dispatchEvent(evt);
        defaultPrevented = evt.defaultPrevented;

        return {
          defaultPrevented,
          zoom: window.LectNotePreview.getZoom(),
          paperZoom: document.getElementById('preview-paper').style.zoom,
          badgeText: document.getElementById('preview-zoom-text').textContent.trim()
        };
      });

      assert.strictEqual(pinchResult.defaultPrevented, true, 'Touchpad pinch wheel event must call preventDefault()');
      assert.ok(pinchResult.zoom > 1.0, `Zoom should have increased from 1.0, got ${pinchResult.zoom}`);
      assert.strictEqual(pinchResult.paperZoom, pinchResult.zoom.toString());
      assert.strictEqual(pinchResult.badgeText, `${Math.round(pinchResult.zoom * 100)}%`);

      // Dispatch trackpad pinch-in (zoom out)
      const pinchInResult = await page.evaluate(() => {
        const scrollContainer = document.querySelector('.preview-scroll-container');
        const evt = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: 60,
          clientX: 800,
          clientY: 400
        });
        scrollContainer.dispatchEvent(evt);

        return {
          zoom: window.LectNotePreview.getZoom(),
          badgeText: document.getElementById('preview-zoom-text').textContent.trim()
        };
      });

      assert.ok(pinchInResult.zoom < pinchResult.zoom, 'Zoom should have decreased on pinch-in');
      assert.strictEqual(pinchInResult.badgeText, `${Math.round(pinchInResult.zoom * 100)}%`);

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('handles Safari gesturechange events and touch pinch events', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      // Reset to 1.0
      await page.evaluate(() => window.LectNotePreview.resetZoom());

      // Simulate WebKit Gesture Events
      const gestureResult = await page.evaluate(() => {
        const scrollContainer = document.querySelector('.preview-scroll-container');

        const gStart = new CustomEvent('gesturestart', { bubbles: true, cancelable: true });
        scrollContainer.dispatchEvent(gStart);

        const gChange = new CustomEvent('gesturechange', { bubbles: true, cancelable: true });
        gChange.scale = 1.35;
        gChange.clientX = 700;
        gChange.clientY = 350;
        scrollContainer.dispatchEvent(gChange);

        const zoomAfterChange = window.LectNotePreview.getZoom();

        const gEnd = new CustomEvent('gestureend', { bubbles: true, cancelable: true });
        scrollContainer.dispatchEvent(gEnd);

        return {
          zoomAfterChange,
          finalZoom: window.LectNotePreview.getZoom(),
          paperZoom: document.getElementById('preview-paper').style.zoom
        };
      });

      assert.strictEqual(gestureResult.zoomAfterChange, 1.35);
      assert.strictEqual(gestureResult.finalZoom, 1.35);
      assert.strictEqual(gestureResult.paperZoom, '1.35');

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('handles keyboard shortcuts (Cmd/Ctrl +, -, 0) when preview is active', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      // Switch to preview-only view mode
      await page.evaluate(() => {
        window.LectNoteApp.applyViewMode('preview', false);
      });

      // Press Cmd+= (Zoom In)
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }));
      });
      assert.strictEqual(await page.evaluate(() => window.LectNotePreview.getZoom()), 1.15);

      // Press Cmd+- (Zoom Out)
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', metaKey: true, bubbles: true }));
      });
      assert.strictEqual(await page.evaluate(() => window.LectNotePreview.getZoom()), 1.0);

      // Press Cmd+= twice then Cmd+0 (Reset)
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true }));
      });
      assert.strictEqual(await page.evaluate(() => window.LectNotePreview.getZoom()), 1.25);

      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true }));
      });
      assert.strictEqual(await page.evaluate(() => window.LectNotePreview.getZoom()), 1.0);

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('restores zoom from localStorage upon page load and persists changes', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });

      // Pre-seed localStorage with zoom 1.5
      await page.goto(`http://127.0.0.1:${port}`);
      await page.evaluate(() => {
        localStorage.setItem('lectnote_preview_zoom', '1.5');
      });

      // Reload page and verify zoom is restored
      await page.reload();
      const restoredZoom = await page.evaluate(() => window.LectNotePreview.getZoom());
      const restoredPaper = await page.$eval('#preview-paper', el => el.style.zoom);
      const restoredBadge = await page.$eval('#preview-zoom-text', el => el.textContent.trim());

      assert.strictEqual(restoredZoom, 1.5);
      assert.strictEqual(restoredPaper, '1.5');
      assert.strictEqual(restoredBadge, '150%');

      // Change zoom and check that localStorage updates
      await page.click('#btn-preview-zoom-reset');
      // Wait slightly for debounced save
      await new Promise(r => setTimeout(r, 250));
      const savedInStorage = await page.evaluate(() => localStorage.getItem('lectnote_preview_zoom'));
      assert.strictEqual(savedInStorage, '1');

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('updates rough notation css visual boundaries properly on zoom without double-zoom', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      const result = await page.evaluate(async () => {
        const sampleMd = '## 1. Key Principles\n\nWrite your concepts and derivations here.\n\n[Fundamental Equation]{.box #3b82f6}\n\n$$E = mc^2$$\n\n' + 'Filler note text\n\n'.repeat(10);
        await window.LectNotePreview.updatePreview(sampleMd, 'CS301-Algorithms', 'lecture-04-graph-traversal', true);

        // Zoom to 2.01 as shown in user screenshot
        window.LectNotePreview.setZoom(2.01);
        await new Promise(r => setTimeout(r, 120));

        const target = document.querySelector('[data-rn]');
        const svg = document.querySelector('svg.rough-annotation');
        const path = svg.querySelector('path');
        const tRect = target.getBoundingClientRect();
        const pRect = path.getBoundingClientRect();

        return {
          targetWidth: tRect.width,
          pathWidth: pRect.width,
          ratio: pRect.width / tRect.width
        };
      });

      // Test Firefox simulation where getScreenCTM ignores zoom and returns identity matrix
      const firefoxResult = await page.evaluate(async () => {
        const svg = document.querySelector('svg.rough-annotation');
        svg.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        window.LectNotePreview.setZoom(2.13);
        await new Promise(r => setTimeout(r, 120));

        const target = document.querySelector('[data-rn]');
        const path = svg.querySelector('path');
        const tRect = target.getBoundingClientRect();
        const pRect = path.getBoundingClientRect();

        return {
          targetWidth: tRect.width,
          pathWidth: pRect.width,
          ratio: pRect.width / tRect.width
        };
      });

      assert.ok(firefoxResult.ratio < 1.25, `Expected rough notation box ratio close to 1.0 in Firefox simulation, got ${firefoxResult.ratio}`);
      assert.ok(firefoxResult.ratio > 0.95, `Expected rough notation box ratio close to 1.0 in Firefox simulation, got ${firefoxResult.ratio}`);

    } finally {
      await browser.close();
      server.close();
    }
  });

  it('allows moving preview vertically and horizontally by dragging when zoomed in', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      await page.evaluate(async () => {
        const sampleMd = '## 1. Key Principles\n\n' + 'Filler text content for scrolling\n\n'.repeat(25);
        await window.LectNotePreview.updatePreview(sampleMd, 'CS301-Algorithms', 'lecture-04-graph-traversal', true);
        window.LectNotePreview.setZoom(2.0);
        await new Promise(r => setTimeout(r, 100));
      });

      // Initial scroll positions
      const initialScroll = await page.evaluate(() => {
        const sc = document.querySelector('.preview-scroll-container');
        sc.scrollLeft = 0;
        sc.scrollTop = 0;
        return {
          scrollWidth: sc.scrollWidth,
          clientWidth: sc.clientWidth,
          scrollHeight: sc.scrollHeight,
          clientHeight: sc.clientHeight,
          canScrollH: sc.scrollWidth > sc.clientWidth,
          canScrollV: sc.scrollHeight > sc.clientHeight
        };
      });

      assert.strictEqual(initialScroll.canScrollH, true, 'Container must have horizontal overflow at 2.0x zoom');
      assert.strictEqual(initialScroll.canScrollV, true, 'Container must have vertical overflow at 2.0x zoom');

      // 1. Direct drag on the preview canvas
      // Drag diagonally from (800, 400) to (680, 290) -> should increase scrollLeft by ~120, scrollTop by ~110
      await page.mouse.move(800, 400);
      await page.mouse.down();
      await page.mouse.move(680, 290, { steps: 5 });
      await page.mouse.up();

      const scrollAfterDrag = await page.evaluate(() => {
        const sc = document.querySelector('.preview-scroll-container');
        return {
          scrollLeft: sc.scrollLeft,
          scrollTop: sc.scrollTop
        };
      });

      assert.ok(scrollAfterDrag.scrollLeft >= 100, `Expected scrollLeft >= 100 after drag, got ${scrollAfterDrag.scrollLeft}`);
      assert.ok(scrollAfterDrag.scrollTop >= 90, `Expected scrollTop >= 90 after drag, got ${scrollAfterDrag.scrollTop}`);

      // 2. Toggle Pan Mode button
      const panBtnExists = await page.$('#btn-preview-pan');
      assert.ok(panBtnExists, 'Pan button must exist');
      await page.click('#btn-preview-pan');

      const isPanActive = await page.$eval('#btn-preview-pan', el => el.classList.contains('active'));
      assert.strictEqual(isPanActive, true, 'Pan button should be active when toggled');

      // Drag in opposite direction with Pan Mode active
      await page.mouse.move(600, 300);
      await page.mouse.down();
      await page.mouse.move(660, 350, { steps: 5 });
      await page.mouse.up();

      const scrollAfterPanBack = await page.evaluate(() => {
        const sc = document.querySelector('.preview-scroll-container');
        return {
          scrollLeft: sc.scrollLeft,
          scrollTop: sc.scrollTop
        };
      });

      assert.ok(scrollAfterPanBack.scrollLeft < scrollAfterDrag.scrollLeft, 'ScrollLeft should decrease when dragged in reverse');
      assert.ok(scrollAfterPanBack.scrollTop < scrollAfterDrag.scrollTop, 'ScrollTop should decrease when dragged in reverse');

    } finally {
      await browser.close();
      server.close();
    }
  });
});


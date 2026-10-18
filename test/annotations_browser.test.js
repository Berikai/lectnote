const { describe, it } = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { app } = require('../server/app');

describe('LectNote Sticky Notes & Drawing Overlay Browser Tests', () => {
  it('renders floating annotations toolbar, creates sticky notes, draws SVG paths, and toggles collapse', async () => {
    const server = app.listen(0);
    const port = server.address().port;

    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(`http://127.0.0.1:${port}`);

      // Wait for app and preview to be ready
      await page.waitForSelector('#preview-paper');
      await page.waitForSelector('#preview-annotations-toolbar');
      await page.waitForSelector('#preview-annotations-layer');
      await page.waitForSelector('#drawing-svg-canvas');

      // 1. Verify Floating Annotations Toolbar exists and has default Select tool active
      const activeTool = await page.$eval('.anno-btn.active', el => el.getAttribute('data-tool'));
      assert.strictEqual(activeTool, 'select', 'Default tool should be select');

      // 2. Add Sticky Note
      await page.click('#btn-tool-sticky');
      await page.waitForSelector('.floating-sticky-note');

      const stickyCount = await page.$$eval('.floating-sticky-note', els => els.length);
      assert.strictEqual(stickyCount, 1, 'Should create 1 floating sticky note');

      // 3. Type into sticky note
      await page.type('.sticky-note-textarea', 'Test sticky note content');
      const textVal = await page.$eval('.sticky-note-textarea', el => el.value);
      assert.strictEqual(textVal, 'Test sticky note content');

      // 4. Test Collapse / Minimize to circular pin badge
      const collapseBtn = await page.$('.sticky-btn-collapse');
      assert.ok(collapseBtn, 'Collapse button must exist');
      await collapseBtn.click();

      const isCollapsed = await page.$eval('.floating-sticky-note', el => el.classList.contains('is-collapsed'));
      assert.strictEqual(isCollapsed, true, 'Sticky note should be collapsed into a compact pin');

      // Click to expand back
      await page.click('.floating-sticky-note');
      const isExpanded = await page.$eval('.floating-sticky-note', el => !el.classList.contains('is-collapsed'));
      assert.strictEqual(isExpanded, true, 'Sticky note should expand back');

      // 5. Switch to Pen Tool
      await page.click('#btn-tool-pen');
      const penActive = await page.$eval('#btn-tool-pen', el => el.classList.contains('active'));
      assert.strictEqual(penActive, true, 'Pen tool should be active');

      // Verify SVG canvas now has pointer-events: auto
      const canvasPointerEvents = await page.$eval('#drawing-svg-canvas', el => el.style.pointerEvents);
      assert.strictEqual(canvasPointerEvents, 'auto', 'SVG canvas should capture pointer events in pen mode');

      // 6. Draw a stroke on the SVG canvas
      const canvasBox = await page.$eval('#drawing-svg-canvas', el => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + 50, y: rect.top + 50 };
      });

      await page.mouse.move(canvasBox.x, canvasBox.y);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 30, canvasBox.y + 30);
      await page.mouse.move(canvasBox.x + 60, canvasBox.y + 20);
      await page.mouse.up();

      // Wait a moment for DOM update
      await new Promise(r => setTimeout(r, 100));

      const pathCount = await page.$$eval('#drawing-strokes-group path', els => els.length);
      assert.strictEqual(pathCount, 1, 'Should render 1 drawn stroke path in SVG');

      // 7. Test Undo
      await page.click('#btn-anno-undo');
      await new Promise(r => setTimeout(r, 100));
      const afterUndoPathCount = await page.$$eval('#drawing-strokes-group path', els => els.length);
      assert.strictEqual(afterUndoPathCount, 0, 'Undo should remove the drawn stroke');

      // 8. Test Redo
      await page.click('#btn-anno-redo');
      await new Promise(r => setTimeout(r, 100));
      const afterRedoPathCount = await page.$$eval('#drawing-strokes-group path', els => els.length);
      assert.strictEqual(afterRedoPathCount, 1, 'Redo should restore the drawn stroke');

      // 9. Test Visibility Toggle
      await page.click('#btn-anno-visibility');
      const isHidden = await page.$eval('#preview-annotations-layer', el => el.classList.contains('is-hidden'));
      assert.strictEqual(isHidden, true, 'Annotations layer should be hidden when visibility toggled off');

      // Toggle visibility back on
      await page.click('#btn-anno-visibility');
      const isVisibleAgain = await page.$eval('#preview-annotations-layer', el => !el.classList.contains('is-hidden'));
      assert.strictEqual(isVisibleAgain, true, 'Annotations layer should be visible again');

      // 10. Switch back to Select tool
      await page.click('#btn-tool-select');
      const selectActive = await page.$eval('#btn-tool-select', el => el.classList.contains('active'));
      assert.strictEqual(selectActive, true, 'Select tool should be active');

    } finally {
      await browser.close();
      await new Promise(r => server.close(r));
    }
  });
});

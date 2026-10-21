const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const puppeteer = require('puppeteer');
const { app } = require('../server/app');

const PUPPETEER_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
};

describe('LectNote Editor Search, Replace, String Operations & Preview Sync', () => {
  let server;
  let baseUrl;
  let browser;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    browser = await puppeteer.launch(PUPPETEER_OPTIONS);
  });

  after(async () => {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    if (server) {
      try { await new Promise((r) => server.close(r)); } catch (_) {}
    }
  });

  it('opens and closes Find & Replace widget via toolbar and keyboard, auto-populating selection', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      // Set sample markdown
      await page.evaluate(() => {
        window.LectNoteEditor.setValue(
          "# Thermodynamics\n\nEntropy is a measure of molecular disorder.\nEntropy increases over time.\nAnother mention of entropy here."
        );
      });

      // Select "disorder" in editor
      await page.evaluate(() => {
        const ta = document.getElementById('markdown-input');
        const idx = ta.value.indexOf('disorder');
        ta.focus();
        ta.setSelectionRange(idx, idx + 'disorder'.length);
      });

      // Click toolbar find button
      await page.click('#btn-editor-find');
      const widgetHidden = await page.evaluate(() => {
        const w = document.getElementById('editor-find-widget');
        return w.classList.contains('hidden');
      });
      assert.strictEqual(widgetHidden, false, 'Find widget should be visible');

      // Verify find input pre-populated with "disorder"
      const findVal = await page.$eval('#find-input', el => el.value);
      assert.strictEqual(findVal, 'disorder', 'Find input should be pre-populated with selection');

      // Verify match count badge shows "1 of 1"
      const countText = await page.$eval('#find-matches-count', el => el.textContent.trim());
      assert.strictEqual(countText, '1 of 1', 'Count should display 1 of 1');

      // Close via Escape key
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => {
        return document.getElementById('editor-find-widget').classList.contains('hidden');
      });
      assert.strictEqual(closed, true, 'Find widget should be hidden after Escape');
    } finally {
      await page.close();
    }
  });

  it('cycles matches forward and backward with accurate count badges', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        window.LectNoteEditor.setValue(
          "First line with keyword.\nSecond line with keyword.\nThird line with keyword."
        );
        window.LectNoteEditor.openFind(false);
      });

      await page.type('#find-input', 'keyword');
      await page.waitForFunction(() => {
        const el = document.getElementById('find-matches-count');
        return el && el.textContent.includes('of 3');
      });

      let count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '1 of 3');

      // Next match via Enter
      await page.keyboard.press('Enter');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '2 of 3');

      // Next match via Enter again
      await page.keyboard.press('Enter');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '3 of 3');

      // Wrap around
      await page.keyboard.press('Enter');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '1 of 3');

      // Previous match via Shift+Enter
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '3 of 3');
    } finally {
      await page.close();
    }
  });

  it('filters matches with case-sensitive, whole-word, and regex options', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        window.LectNoteEditor.setValue(
          "Cat cat catalogue CAT scatter"
        );
        window.LectNoteEditor.openFind(false);
      });

      await page.$eval('#find-input', el => { el.value = 'cat'; el.dispatchEvent(new Event('input')); });
      await page.waitForFunction(() => document.getElementById('find-matches-count').textContent.includes('5'));
      let count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '1 of 5', 'Without case or whole-word, all 5 matches count');

      // Toggle Match Case
      await page.click('#btn-find-case');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '1 of 3', 'Case sensitive: "cat", "catalogue", and "scatter" match');

      // Toggle Whole Word (while case sensitive is on)
      await page.click('#btn-find-word');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.strictEqual(count, '1 of 1', 'Whole word and case sensitive: only lowercase "cat" matches');

      // Toggle Case off, keep whole word on
      await page.click('#btn-find-case');
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.ok(count.includes('of 3'), 'Whole word: "Cat", "cat", "CAT" match (3 total)');

      // Toggle Whole Word off, turn Regex on
      await page.click('#btn-find-word');
      await page.click('#btn-find-regex');
      await page.$eval('#find-input', el => { el.value = 'c[a-z]{2}'; el.dispatchEvent(new Event('input')); });
      count = await page.$eval('#find-matches-count', el => el.textContent);
      assert.ok(count.includes('of 5'), 'Regex matching 3-letter sequence starting with c (5 total matches)');
    } finally {
      await page.close();
    }
  });

  it('replaces single match and replaces all occurrences in batch', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        window.LectNoteEditor.setValue(
          "Alpha beta alpha gamma ALPHA delta"
        );
        window.LectNoteEditor.openFind(true);
      });

      await page.$eval('#find-input', el => { el.value = 'alpha'; el.dispatchEvent(new Event('input')); });
      await page.$eval('#replace-input', el => { el.value = 'omega'; el.dispatchEvent(new Event('input')); });

      // Click Replace Single
      await page.click('#btn-replace-single');
      let val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.ok(val.startsWith('omega beta'), 'First alpha should be replaced with omega');

      // Replace All (batch replace)
      await page.click('#btn-replace-all');
      await page.waitForFunction(() => document.getElementById('find-matches-count').textContent.includes('Replaced'));
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, 'omega beta omega gamma omega delta', 'All occurrences should be replaced');
    } finally {
      await page.close();
    }
  });

  it('performs case transformations (UPPERCASE, lowercase, Title Case)', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        window.LectNoteEditor.setValue("quantum mechanics equation");
        const ta = document.getElementById('markdown-input');
        ta.setSelectionRange(0, ta.value.length);
        window.LectNoteEditor.transformCase('upper');
      });

      let val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "QUANTUM MECHANICS EQUATION");

      await page.evaluate(() => {
        window.LectNoteEditor.transformCase('lower');
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "quantum mechanics equation");

      await page.evaluate(() => {
        window.LectNoteEditor.transformCase('title');
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Quantum Mechanics Equation");
    } finally {
      await page.close();
    }
  });

  it('performs line operations: duplicate line, move up/down, delete line, and join lines', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        window.LectNoteEditor.setValue("Line A\nLine B\nLine C");
        // Place cursor on Line B
        const ta = document.getElementById('markdown-input');
        const pos = ta.value.indexOf('Line B');
        ta.setSelectionRange(pos, pos);
      });

      // Duplicate Line Down
      await page.evaluate(() => window.LectNoteEditor.duplicateLineDown());
      let val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Line A\nLine B\nLine B\nLine C", 'Line B should be duplicated below');

      // Move Line Up
      await page.evaluate(() => {
        const ta = document.getElementById('markdown-input');
        const pos = ta.value.lastIndexOf('Line B');
        ta.setSelectionRange(pos, pos);
        window.LectNoteEditor.moveLineUp();
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Line A\nLine B\nLine B\nLine C");

      // Move top line down
      await page.evaluate(() => {
        const ta = document.getElementById('markdown-input');
        ta.setSelectionRange(0, 0);
        window.LectNoteEditor.moveLineDown();
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Line B\nLine A\nLine B\nLine C");

      // Delete current line (Line A)
      await page.evaluate(() => {
        const ta = document.getElementById('markdown-input');
        const pos = ta.value.indexOf('Line A');
        ta.setSelectionRange(pos, pos);
        window.LectNoteEditor.deleteLine();
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Line B\nLine B\nLine C");

      // Join lines (Line B and Line B)
      await page.evaluate(() => {
        const ta = document.getElementById('markdown-input');
        ta.setSelectionRange(0, 0);
        window.LectNoteEditor.joinLines();
      });
      val = await page.evaluate(() => window.LectNoteEditor.getValue());
      assert.strictEqual(val, "Line B Line B\nLine C");
    } finally {
      await page.close();
    }
  });

  it('navigates to line via Go To Line popover and selects next occurrence', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#markdown-input');

      await page.evaluate(() => {
        const lines = [];
        for (let i = 1; i <= 50; i++) {
          lines.push(`Line number ${i}`);
        }
        window.LectNoteEditor.setValue(lines.join('\n'));
        window.LectNoteEditor.openGoToLine();
      });

      const modalHidden = await page.evaluate(() => {
        return document.getElementById('editor-goto-line-modal').classList.contains('hidden');
      });
      assert.strictEqual(modalHidden, false, 'Go to Line modal should be visible');

      // Go to line 25
      await page.$eval('#goto-line-input', el => { el.value = '25'; });
      await page.click('#btn-goto-line-confirm');

      const currentLine = await page.evaluate(() => window.LectNoteEditor.getCursorLine() + 1);
      assert.strictEqual(currentLine, 25, 'Cursor should be positioned at line 25');

      // Test select next occurrence
      await page.evaluate(() => {
        window.LectNoteEditor.setValue("apple banana apple cherry apple");
        const ta = document.getElementById('markdown-input');
        // Select first "apple"
        ta.setSelectionRange(0, 5);
        window.LectNoteEditor.selectNextOccurrence();
      });

      const selStart = await page.evaluate(() => document.getElementById('markdown-input').selectionStart);
      assert.strictEqual(selStart, 13, 'Next occurrence of "apple" should be selected at index 13');
    } finally {
      await page.close();
    }
  });

  it('double-clicking text in preview view scrolls editor, selects word, and switches from preview-only mode to split mode', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1200, height: 800 });
      await page.goto(baseUrl);
      await page.waitForSelector('#preview-content');

      // Populate with multi-section content
      await page.evaluate(async () => {
        const md = `# Section One
Introductory paragraph discussing kinetics.

# Section Two
This section describes thermodynamic equilibrium in crystalline solids.

# Section Three
Concluding remarks and homework problems.`;
        window.LectNoteEditor.setValue(md);
        await window.LectNotePreview.updatePreview(md, 'CS301-Algorithms', 'lecture-04-graph-traversal', true);
      });

      // Switch to preview-only view mode
      await page.evaluate(() => {
        window.LectNoteApp.applyViewMode('preview', true);
      });

      let viewMode = await page.evaluate(() => window.LectNoteApp.getViewMode());
      assert.strictEqual(viewMode, 'preview', 'App should be in preview mode');

      // Verify editor is hidden
      const editorDisplay = await page.evaluate(() => {
        return document.getElementById('pane-editor').style.display;
      });
      assert.strictEqual(editorDisplay, 'none', 'Editor pane should be hidden');

      // Wait for rendered preview content
      await page.waitForSelector('#preview-content [data-source-line]');

      // Double-click on the paragraph in Section Two
      await page.evaluate(() => {
        const pElements = Array.from(document.querySelectorAll('#preview-content p'));
        const targetP = pElements.find(p => p.textContent.includes('thermodynamic'));
        if (targetP) {
          const dblClickEvt = new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          targetP.dispatchEvent(dblClickEvt);
        }
      });

      // Mode should have auto-switched to 'split' view
      viewMode = await page.evaluate(() => window.LectNoteApp.getViewMode());
      assert.strictEqual(viewMode, 'split', 'View mode should switch to split upon double-clicking preview text');

      // Editor should now be visible
      const editorVisible = await page.evaluate(() => {
        const el = document.getElementById('pane-editor');
        return el && el.style.display !== 'none';
      });
      assert.strictEqual(editorVisible, true, 'Editor pane should now be visible');

      // Selection or cursor should be on the target section line
      const lineNum = await page.evaluate(() => window.LectNoteEditor.getCursorLine() + 1);
      // "This section describes thermodynamic..." is on line 5
      assert.ok(lineNum >= 4 && lineNum <= 6, `Cursor line (${lineNum}) should correspond to clicked section line`);

      // Gutter highlight pulse should be triggered
      const hasGutterHighlight = await page.evaluate(() => {
        return document.querySelectorAll('.editor-gutter-line.preview-sync-highlight').length > 0;
      });
      assert.strictEqual(hasGutterHighlight, true, 'Gutter line should receive preview-sync-highlight pulse');
    } finally {
      await page.close();
    }
  });
});

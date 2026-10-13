/**
 * LectNote: Editor Controller
 * Handles toolbar shortcuts, textarea manipulation, stats, keybindings,
 * line numbers gutter with wrapped line alignment, auto-closing delimiters,
 * smart list continuation, and multi-line indent/outdent.
 */

window.LectNoteEditor = (function() {
  const textarea = document.getElementById('markdown-input');
  const gutterEl = document.getElementById('editor-gutter');
  const statsEl = document.getElementById('editor-stats');
  const saveStatusEl = document.getElementById('save-status');

  let isDirtyState = false;
  let autoSaveTimer = null;
  const AUTO_SAVE_DELAY_MS = 2000;

  let mirrorEl = null;
  let gutterRaf = null;

  const PAIRS = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`',
    '$': '$'
  };
  const CLOSERS = new Set([')', ']', '}', '"', "'", '`', '$']);

  function init() {
    if (!textarea) return;

    initMirror();

    // Listen to input changes
    textarea.addEventListener('input', () => {
      updateStats();
      markUnsaved();
      triggerAutoSave();
      scheduleGutterUpdate();
      if (window.LectNoteApp) {
        const selStart = textarea.selectionStart || 0;
        const lineIndex = textarea.value.substring(0, selStart).split('\n').length - 1;
        window.LectNoteApp.onMarkdownChange(textarea.value, { lineIndex, isUserEdit: true });
      }
    });

    // Keyboard navigation & smart editing
    textarea.addEventListener('keydown', handleKeydown);

    // Track cursor position on click and navigation
    textarea.addEventListener('keyup', () => {
      updateStats();
      scheduleGutterUpdate();
    });
    textarea.addEventListener('click', () => {
      updateStats();
      scheduleGutterUpdate();
    });
    textarea.addEventListener('select', () => {
      updateStats();
      scheduleGutterUpdate();
    });

    // Sync scroll between textarea and line gutter
    textarea.addEventListener('scroll', () => {
      if (gutterEl) gutterEl.scrollTop = textarea.scrollTop;
    });

    // Handle gutter clicks to jump cursor to line
    if (gutterEl) {
      gutterEl.addEventListener('click', (e) => {
        const lineEl = e.target.closest('.editor-gutter-line');
        if (!lineEl) return;
        const lineIdx = parseInt(lineEl.dataset.line, 10);
        if (isNaN(lineIdx)) return;
        const text = textarea.value;
        const lines = text.split('\n');
        let pos = 0;
        for (let i = 0; i < lineIdx; i++) {
          pos += lines[i].length + 1;
        }
        textarea.focus();
        textarea.setSelectionRange(pos, pos);
        updateStats();
        scheduleGutterUpdate();
      });
    }

    // Window resize observer for gutter
    window.addEventListener('resize', () => {
      scheduleGutterUpdate();
    });

    // Attach toolbar button actions
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        handleToolAction(action);
      });
    });

    // Initial render
    scheduleGutterUpdate();
  }

  function initMirror() {
    mirrorEl = document.createElement('div');
    mirrorEl.className = 'editor-line-mirror';
    mirrorEl.style.cssText = `
      position: absolute;
      visibility: hidden;
      top: -99999px;
      left: -99999px;
      font-family: var(--font-mono, monospace);
      font-size: 13.5px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 0;
      margin: 0;
      border: 0;
      box-sizing: content-box;
      pointer-events: none;
    `;
    document.body.appendChild(mirrorEl);
  }

  function handleKeydown(e) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // Ctrl+S or Cmd+S
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (window.LectNoteApp) {
        window.LectNoteApp.saveCurrentLecture();
      }
      return;
    }

    // 1. Tab & Shift+Tab handling (Indentation)
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.shiftKey && start === end) {
        insertText('  ');
      } else {
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = text.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = text.length;

        const lines = text.substring(lineStart, lineEnd).split('\n');
        let modifiedLines;
        if (!e.shiftKey) {
          modifiedLines = lines.map(l => '  ' + l);
        } else {
          modifiedLines = lines.map(l => l.replace(/^ {1,2}/, ''));
        }
        const newBlock = modifiedLines.join('\n');
        textarea.setRangeText(newBlock, lineStart, lineEnd, 'select');
        triggerChange();
      }
      return;
    }

    // 2. Overtyping closing delimiters
    if (CLOSERS.has(e.key) && start === end && text[start] === e.key) {
      e.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      updateStats();
      scheduleGutterUpdate();
      return;
    }

    // 3. Auto-closing pairs and wrapping
    if (PAIRS[e.key]) {
      const opener = e.key;
      const closer = PAIRS[e.key];

      // Non-empty selection -> wrap
      if (start < end) {
        e.preventDefault();
        wrapSelection(opener, closer);
        return;
      }

      // Avoid auto-closing single or double quotes inside words (e.g. don't)
      const prevChar = start > 0 ? text[start - 1] : '';
      const nextChar = text[start] || '';
      if ((opener === "'" || opener === '"') && /\w/.test(prevChar)) {
        return;
      }
      if (opener === '$' && /\w/.test(nextChar)) {
        return;
      }

      e.preventDefault();
      insertText(`${opener}${closer}`, -1, -1);
      return;
    }

    // 4. Wrapping selection for formatting markers (*, _, ~)
    if (start < end && (e.key === '*' || e.key === '_' || e.key === '~')) {
      e.preventDefault();
      wrapSelection(e.key, e.key);
      return;
    }

    // 5. Backspace between auto-closed pairs
    if (e.key === 'Backspace' && start === end && start > 0) {
      const charBefore = text[start - 1];
      const charAfter = text[start];
      if (PAIRS[charBefore] === charAfter) {
        e.preventDefault();
        textarea.setRangeText('', start - 1, start + 1, 'end');
        triggerChange();
        return;
      }
    }

    // 6. Smart Enter (List continuation & indentation preservation)
    if (e.key === 'Enter') {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const currentLine = text.substring(lineStart, start);

      // A. Empty checkbox list item: e.g. "- [ ] " or "* [ ] "
      const emptyCheckboxMatch = currentLine.match(/^(\s*[-*+]\s+\[[ xX]\]\s*)$/);
      if (emptyCheckboxMatch) {
        e.preventDefault();
        textarea.setRangeText('', lineStart, start, 'end');
        triggerChange();
        return;
      }

      // B. Active checkbox list item: e.g. "- [ ] do this"
      const activeCheckboxMatch = currentLine.match(/^(\s*)([-*+])\s+\[[ xX]\]\s+(.+)$/);
      if (activeCheckboxMatch) {
        e.preventDefault();
        const indent = activeCheckboxMatch[1];
        const bullet = activeCheckboxMatch[2];
        insertText(`\n${indent}${bullet} [ ] `);
        return;
      }

      // C. Empty unordered bullet: e.g. "- " or "* " or "+ "
      const emptyBulletMatch = currentLine.match(/^(\s*[-*+]\s*)$/);
      if (emptyBulletMatch) {
        e.preventDefault();
        textarea.setRangeText('', lineStart, start, 'end');
        triggerChange();
        return;
      }

      // D. Active unordered bullet: e.g. "- something"
      const activeBulletMatch = currentLine.match(/^(\s*)([-*+])\s+(.+)$/);
      if (activeBulletMatch) {
        e.preventDefault();
        const indent = activeBulletMatch[1];
        const bullet = activeBulletMatch[2];
        insertText(`\n${indent}${bullet} `);
        return;
      }

      // E. Empty ordered list: e.g. "1. "
      const emptyNumberedMatch = currentLine.match(/^(\s*\d+\.\s*)$/);
      if (emptyNumberedMatch) {
        e.preventDefault();
        textarea.setRangeText('', lineStart, start, 'end');
        triggerChange();
        return;
      }

      // F. Active ordered list: e.g. "2. something"
      const activeNumberedMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (activeNumberedMatch) {
        e.preventDefault();
        const indent = activeNumberedMatch[1];
        const num = parseInt(activeNumberedMatch[2], 10);
        insertText(`\n${indent}${num + 1}. `);
        return;
      }

      // G. Empty blockquote: e.g. "> "
      const emptyQuoteMatch = currentLine.match(/^(\s*>+\s*)$/);
      if (emptyQuoteMatch) {
        e.preventDefault();
        textarea.setRangeText('', lineStart, start, 'end');
        triggerChange();
        return;
      }

      // H. Active blockquote: e.g. "> something"
      const activeQuoteMatch = currentLine.match(/^(\s*>+\s*)(.+)$/);
      if (activeQuoteMatch) {
        e.preventDefault();
        const prefix = activeQuoteMatch[1];
        insertText(`\n${prefix}`);
        return;
      }

      // I. Preserving indentation on any line
      const indentMatch = currentLine.match(/^(\s+)/);
      if (indentMatch && indentMatch[1]) {
        e.preventDefault();
        insertText(`\n${indentMatch[1]}`);
        return;
      }
    }
  }

  function scheduleGutterUpdate() {
    if (gutterRaf) cancelAnimationFrame(gutterRaf);
    gutterRaf = requestAnimationFrame(updateGutter);
  }

  function updateGutter() {
    if (!gutterEl || !textarea) return;
    const text = textarea.value;
    const lines = text.split('\n');
    const totalLines = lines.length;

    // Calculate active line index based on cursor
    const selStart = textarea.selectionStart || 0;
    const textBefore = text.substring(0, selStart);
    const activeLineIdx = textBefore.split('\n').length - 1;

    // Setup mirror element for measuring wrapped lines
    if (!mirrorEl) initMirror();
    const style = window.getComputedStyle(textarea);
    const padLeft = parseFloat(style.paddingLeft) || 20;
    const padRight = parseFloat(style.paddingRight) || 20;
    const contentWidth = textarea.clientWidth - padLeft - padRight;
    mirrorEl.style.width = Math.max(20, contentWidth) + 'px';
    mirrorEl.style.fontFamily = style.fontFamily;
    mirrorEl.style.fontSize = style.fontSize;
    mirrorEl.style.lineHeight = style.lineHeight;

    let html = '';
    for (let i = 0; i < totalLines; i++) {
      mirrorEl.textContent = lines[i] || ' ';
      const h = mirrorEl.getBoundingClientRect().height;
      const isActive = (i === activeLineIdx);
      html += `<div class="editor-gutter-line ${isActive ? 'active' : ''}" data-line="${i}" style="height:${h}px; line-height:1.7;">${i + 1}</div>`;
    }
    gutterEl.innerHTML = html;
    gutterEl.scrollTop = textarea.scrollTop;
  }

  function triggerAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      if (isDirtyState && window.LectNoteApp && typeof window.LectNoteApp.saveCurrentLecture === 'function') {
        window.LectNoteApp.saveCurrentLecture(true); // silent auto-save
      }
    }, AUTO_SAVE_DELAY_MS);
  }

  function handleToolAction(action) {
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const selectedText = textarea.value.substring(selStart, selEnd);

    switch (action) {
      case 'highlight':
        wrapSelection('==', '==', 'highlighted text');
        break;
      case 'circle':
        wrapSelection('[', ']{.circle}', 'key formula or term');
        break;
      case 'box':
        wrapSelection('[', ']{.box}', 'definition or equation');
        break;
      case 'underline':
        wrapSelection('[', ']{.underline}', 'warning point');
        break;
      case 'math-inline':
        wrapSelection('$', '$', 'x');
        break;
      case 'math-block':
        wrapSelection('$$\n', '\n$$', '\\sigma_f = \\sqrt{\\frac{2E\\gamma}{\\pi a}}');
        break;
      case 'sticky':
        insertBlock(`> [!note] Professor Insight\n> ${selectedText || 'Pay attention to this exam concept and mechanism.'}\n`);
        break;
      case 'mermaid':
        insertBlock(`\`\`\`mermaid\nflowchart TD\n    A[Phase Alpha] -->|Cooling| B[Eutectic Alpha + Beta]\n    B --> C[Stable Microstructure]\n\`\`\`\n`);
        break;
      case 'svg':
        insertBlock(`\`\`\`svg\n<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" style="background:#fff;">\n  <line x1="40" y1="160" x2="360" y2="160" stroke="#334155" stroke-width="2" />\n  <line x1="40" y1="160" x2="40" y2="30" stroke="#334155" stroke-width="2" />\n  <path d="M 40 150 Q 180 40 360 40" fill="none" stroke="#2563eb" stroke-width="3" />\n  <text x="200" y="185" fill="#475569" font-size="12">Composition (wt% C)</text>\n  <text x="15" y="25" fill="#475569" font-size="12">Temp (°C)</text>\n</svg>\n\`\`\`\n`);
        break;
      case 'board-ref':
        insertBlock(`:::board-ref [photo_1.jpg] "Whiteboard Reference: Steady-state derivation" :::\n`);
        break;
    }
  }

  function wrapSelection(before, after, defaultText = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end) || defaultText;
    const replacement = `${before}${selected}${after}`;

    let handled = false;
    if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
      try {
        handled = document.execCommand('insertText', false, replacement);
      } catch (err) {
        handled = false;
      }
    }

    if (!handled) {
      textarea.setRangeText(replacement, start, end, 'end');
    }

    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    triggerChange();
  }

  function insertBlock(snippet) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const beforeChar = start > 0 ? text[start - 1] : '\n';
    const prefix = beforeChar === '\n' ? '' : '\n\n';

    insertText(prefix + snippet);
  }

  function insertText(snippet, selStartDelta = 0, selEndDelta = 0) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    let handled = false;
    if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
      try {
        handled = document.execCommand('insertText', false, snippet);
      } catch (err) {
        handled = false;
      }
    }

    if (!handled) {
      textarea.setRangeText(snippet, start, end, 'end');
    }

    if (selStartDelta !== 0 || selEndDelta !== 0) {
      const curPos = textarea.selectionStart;
      textarea.setSelectionRange(curPos + selStartDelta, curPos + selEndDelta);
    }

    triggerChange();
  }

  function triggerChange() {
    updateStats();
    markUnsaved();
    triggerAutoSave();
    scheduleGutterUpdate();
    if (window.LectNoteApp) {
      const selStart = textarea.selectionStart || 0;
      const lineIndex = textarea.value.substring(0, selStart).split('\n').length - 1;
      window.LectNoteApp.onMarkdownChange(textarea.value, { lineIndex, isUserEdit: true });
    }
  }

  function updateStats() {
    if (!textarea || !statsEl) return;
    const text = textarea.value;
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;

    const selStart = textarea.selectionStart || 0;
    const textBefore = text.substring(0, selStart);
    const lineNum = textBefore.split('\n').length;
    const colNum = selStart - textBefore.lastIndexOf('\n');

    statsEl.textContent = `Ln ${lineNum}, Col ${colNum} · ${lines} lines · ${words} words`;
  }

  function markUnsaved() {
    isDirtyState = true;
    if (saveStatusEl) {
      const dot = saveStatusEl.querySelector('.status-dot');
      const text = saveStatusEl.querySelector('.status-text');
      if (dot && text) {
        dot.className = 'status-dot unsaved';
        text.textContent = 'Unsaved changes';
      } else {
        saveStatusEl.textContent = '● Unsaved changes';
        saveStatusEl.style.color = '#f59e0b';
      }
    }
  }

  function markSaving() {
    if (saveStatusEl) {
      const dot = saveStatusEl.querySelector('.status-dot');
      const text = saveStatusEl.querySelector('.status-text');
      if (dot && text) {
        dot.className = 'status-dot saving';
        text.textContent = 'Saving...';
      } else {
        saveStatusEl.textContent = '... Saving...';
        saveStatusEl.style.color = '#3b82f6';
      }
    }
  }

  function markSaved() {
    isDirtyState = false;
    clearTimeout(autoSaveTimer);
    if (saveStatusEl) {
      const dot = saveStatusEl.querySelector('.status-dot');
      const text = saveStatusEl.querySelector('.status-text');
      if (dot && text) {
        dot.className = 'status-dot';
        text.textContent = 'All changes saved';
      } else {
        saveStatusEl.textContent = '✓ Saved';
        saveStatusEl.style.color = '#10b981';
      }
    }
  }

  function getValue() {
    return textarea ? textarea.value : '';
  }

  function setValue(val) {
    if (!textarea) return;
    textarea.value = val || '';
    updateStats();
    scheduleGutterUpdate();
    markSaved();
  }

  function isDirty() {
    return isDirtyState;
  }

  let searchGutterTimer = null;

  function highlightAndScrollSearch({ query, lineNum, matchIdx }) {
    if (!textarea) return;
    const text = textarea.value;
    let targetIdx = -1;

    if (typeof matchIdx === 'number' && matchIdx >= 0 && matchIdx < text.length) {
      targetIdx = matchIdx;
    } else if (query && query.trim()) {
      targetIdx = text.toLowerCase().indexOf(query.trim().toLowerCase());
    } else if (typeof lineNum === 'number') {
      const lines = text.split('\n');
      let pos = 0;
      for (let i = 0; i < Math.min(lineNum, lines.length); i++) {
        pos += lines[i].length + 1;
      }
      targetIdx = pos;
    }

    if (targetIdx !== -1) {
      const qLen = (query && query.trim() && targetIdx + query.trim().length <= text.length) ? query.trim().length : 0;
      textarea.focus();
      textarea.setSelectionRange(targetIdx, targetIdx + qLen);

      const textBefore = text.substring(0, targetIdx);
      const lineIndex = textBefore.split('\n').length - 1;

      clearTimeout(searchGutterTimer);
      if (gutterEl) {
        gutterEl.querySelectorAll('.search-gutter-highlight').forEach(el => el.classList.remove('search-gutter-highlight'));
        const gutterLine = gutterEl.querySelector(`.editor-gutter-line[data-line="${lineIndex}"]`);
        if (gutterLine) {
          gutterLine.classList.add('search-gutter-highlight');
          const targetScroll = Math.max(0, gutterLine.offsetTop - textarea.clientHeight / 2);
          textarea.scrollTo({ top: targetScroll, behavior: 'smooth' });
          searchGutterTimer = setTimeout(() => {
            gutterLine.classList.remove('search-gutter-highlight');
          }, 2800);
          return;
        }
      }

      const totalLines = text.split('\n').length || 1;
      const ratio = lineIndex / totalLines;
      const maxScroll = textarea.scrollHeight - textarea.clientHeight;
      textarea.scrollTo({ top: Math.max(0, ratio * maxScroll), behavior: 'smooth' });
    }
  }

  return {
    init,
    getValue,
    setValue,
    markSaved,
    markSaving,
    markUnsaved,
    isDirty,
    updateGutter: scheduleGutterUpdate,
    highlightAndScrollSearch,
    getCursorLine: () => {
      const sel = textarea ? (textarea.selectionStart || 0) : 0;
      return textarea ? (textarea.value.substring(0, sel).split('\n').length - 1) : 0;
    }
  };
})();

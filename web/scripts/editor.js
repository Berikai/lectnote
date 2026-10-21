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
  let syncHighlightLineIndex = -1;
  let syncHighlightTimer = null;

  // Find & Replace state and elements
  let findWidget = null;
  let findInput = null;
  let replaceInput = null;
  let matchesCountEl = null;
  let btnFindPrev = null;
  let btnFindNext = null;
  let btnFindCase = null;
  let btnFindWord = null;
  let btnFindRegex = null;
  let btnFindClose = null;
  let btnToggleReplace = null;
  let replaceRow = null;
  let btnReplaceSingle = null;
  let btnReplaceAll = null;

  let isFindOpen = false;
  let isReplaceOpen = false;
  let matchCase = false;
  let wholeWord = false;
  let isRegex = false;
  let matches = [];
  let currentMatchIdx = -1;

  // Go to Line state and elements
  let gotoLineModal = null;
  let gotoLineInput = null;
  let gotoLineRange = null;
  let btnGotoLineConfirm = null;
  let btnGotoLineClose = null;

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

    // Initialize Find & Replace widget and Go to Line popover
    initFindWidget();
    initGoToLine();

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

    // Find: Cmd+F or Ctrl+F
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openFind(false);
      return;
    }

    // Replace: Cmd+H or Ctrl+H, or Cmd+Alt+F / Ctrl+Alt+F
    if (((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) ||
        ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'f' || e.key === 'F'))) {
      e.preventDefault();
      openFind(true);
      return;
    }

    // Find Next / Prev: Cmd+G / Cmd+Shift+G
    if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
      return;
    }

    // Go to Line: Cmd+L or Ctrl+G
    if (((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) ||
        (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'g' || e.key === 'G'))) {
      e.preventDefault();
      openGoToLine();
      return;
    }

    // Select Next Occurrence / Word: Cmd+D or Ctrl+D
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      selectNextOccurrence();
      return;
    }

    // Case Transformations:
    // Ctrl+Shift+U -> UPPERCASE
    if (e.ctrlKey && e.shiftKey && (e.key === 'u' || e.key === 'U')) {
      e.preventDefault();
      transformCase('upper');
      return;
    }
    // Ctrl+Shift+L -> lowercase
    if (e.ctrlKey && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      transformCase('lower');
      return;
    }
    // Ctrl+Shift+T -> Title Case
    if (e.ctrlKey && e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      transformCase('title');
      return;
    }

    // Duplicate Line: Alt+Shift+Down
    if (e.altKey && e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault();
      duplicateLineDown();
      return;
    }

    // Move Line Up: Alt+Up
    if (e.altKey && !e.shiftKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveLineUp();
      return;
    }

    // Move Line Down: Alt+Down
    if (e.altKey && !e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveLineDown();
      return;
    }

    // Delete Line: Cmd+Shift+K or Ctrl+Shift+K
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      deleteLine();
      return;
    }

    // Join Lines: Cmd+J or Ctrl+J
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      joinLines();
      return;
    }

    // Escape: Close Find or Go To Line if open
    if (e.key === 'Escape') {
      if (isFindOpen) {
        e.preventDefault();
        closeFind();
        return;
      }
      if (gotoLineModal && !gotoLineModal.classList.contains('hidden')) {
        e.preventDefault();
        closeGoToLine();
        return;
      }
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
      const isSyncHighlight = (i === syncHighlightLineIndex);
      html += `<div class="editor-gutter-line ${isActive ? 'active' : ''} ${isSyncHighlight ? 'preview-sync-highlight' : ''}" data-line="${i}" style="height:${h}px; line-height:1.7;">${i + 1}</div>`;
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
      case 'find':
        openFind(false);
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

  // ==========================================================================
  // Find & Replace Controller
  // ==========================================================================
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildRegex(query) {
    if (!query) return null;
    const flags = 'g' + (matchCase ? '' : 'i') + 'm';
    if (isRegex) {
      if (wholeWord) {
        return new RegExp(`\\b(?:${query})\\b`, flags);
      }
      return new RegExp(query, flags);
    }
    const escaped = escapeRegExp(query);
    if (wholeWord) {
      return new RegExp(`\\b${escaped}\\b`, flags);
    }
    return new RegExp(escaped, flags);
  }

  function updateCountUI(text, isError = false) {
    if (!matchesCountEl) return;
    matchesCountEl.textContent = text;
    matchesCountEl.classList.toggle('no-matches', isError);
  }

  function updateOptionsUI() {
    if (btnFindCase) btnFindCase.classList.toggle('active', matchCase);
    if (btnFindWord) btnFindWord.classList.toggle('active', wholeWord);
    if (btnFindRegex) btnFindRegex.classList.toggle('active', isRegex);
  }

  function updateMatches(selectMatch = true, preferredStart = null) {
    if (!textarea || !findInput) return;
    const text = textarea.value;
    const query = findInput.value;

    if (!query) {
      matches = [];
      currentMatchIdx = -1;
      findInput.classList.remove('regex-invalid');
      updateCountUI('No results');
      return;
    }

    let regex = null;
    try {
      regex = buildRegex(query);
      findInput.classList.remove('regex-invalid');
    } catch (err) {
      findInput.classList.add('regex-invalid');
      updateCountUI('Invalid regex', true);
      matches = [];
      currentMatchIdx = -1;
      return;
    }

    if (!regex) {
      matches = [];
      currentMatchIdx = -1;
      updateCountUI('No results');
      return;
    }

    const newMatches = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      newMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    matches = newMatches;
    if (matches.length === 0) {
      currentMatchIdx = -1;
      updateCountUI('0 of 0', true);
      return;
    }

    const pos = preferredStart !== null ? preferredStart : (textarea.selectionStart || 0);
    let bestIdx = matches.findIndex(m => m.start >= pos);
    if (bestIdx === -1) {
      bestIdx = 0;
    }
    currentMatchIdx = bestIdx;
    updateCountUI(`${currentMatchIdx + 1} of ${matches.length}`);

    if (selectMatch && matches[currentMatchIdx]) {
      selectAndScrollMatch(matches[currentMatchIdx]);
    }
  }

  function selectAndScrollMatch(m, forceFocusTextarea = false) {
    if (!m || !textarea) return;
    const activeEl = document.activeElement;
    const isWidgetFocused = (activeEl === findInput || activeEl === replaceInput || (findWidget && findWidget.contains(activeEl)));
    if (forceFocusTextarea || !isWidgetFocused) {
      textarea.focus();
    }
    textarea.setSelectionRange(m.start, m.end);

    const text = textarea.value;
    const textBefore = text.substring(0, m.start);
    const lineIndex = textBefore.split('\n').length - 1;

    if (gutterEl) {
      const gutterLine = gutterEl.querySelector(`.editor-gutter-line[data-line="${lineIndex}"]`);
      if (gutterLine) {
        const targetScroll = Math.max(0, gutterLine.offsetTop - textarea.clientHeight / 2);
        textarea.scrollTo({ top: targetScroll, behavior: 'smooth' });
        return;
      }
    }
    const totalLines = text.split('\n').length || 1;
    const ratio = lineIndex / totalLines;
    const maxScroll = textarea.scrollHeight - textarea.clientHeight;
    textarea.scrollTo({ top: Math.max(0, ratio * maxScroll), behavior: 'smooth' });
  }

  function findNext() {
    if (matches.length === 0) {
      updateMatches(true);
      return;
    }
    currentMatchIdx = (currentMatchIdx + 1) % matches.length;
    updateCountUI(`${currentMatchIdx + 1} of ${matches.length}`);
    selectAndScrollMatch(matches[currentMatchIdx]);
  }

  function findPrev() {
    if (matches.length === 0) {
      updateMatches(true);
      return;
    }
    currentMatchIdx = (currentMatchIdx - 1 + matches.length) % matches.length;
    updateCountUI(`${currentMatchIdx + 1} of ${matches.length}`);
    selectAndScrollMatch(matches[currentMatchIdx]);
  }

  function openFind(showReplace = false) {
    if (!findWidget || !textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start < end) {
      const selected = textarea.value.substring(start, end);
      if (!selected.includes('\n') && findInput) {
        findInput.value = selected;
      }
    }

    findWidget.classList.remove('hidden');
    isFindOpen = true;

    if (showReplace) {
      toggleReplace(true);
    }

    updateOptionsUI();

    if (showReplace && findInput && findInput.value && replaceInput) {
      replaceInput.focus();
      replaceInput.select();
    } else if (findInput) {
      findInput.focus();
      findInput.select();
    }

    updateMatches(true);
  }

  function closeFind() {
    if (!findWidget) return;
    findWidget.classList.add('hidden');
    isFindOpen = false;
    if (textarea) textarea.focus();
  }

  function toggleReplace(force = null) {
    if (!replaceRow || !btnToggleReplace) return;
    const nextState = force !== null ? force : !isReplaceOpen;
    isReplaceOpen = nextState;
    replaceRow.classList.toggle('hidden', !isReplaceOpen);
    btnToggleReplace.classList.toggle('expanded', isReplaceOpen);
    if (isReplaceOpen && replaceInput) {
      replaceInput.focus();
    }
  }

  function replaceSingle() {
    if (!textarea || matches.length === 0 || currentMatchIdx < 0) return;
    const match = matches[currentMatchIdx];
    const repVal = replaceInput ? replaceInput.value : '';

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start !== match.start || end !== match.end) {
      selectAndScrollMatch(match);
    }

    let replacement = repVal;
    if (isRegex) {
      try {
        const reg = buildRegex(findInput.value);
        if (reg) {
          replacement = match.text.replace(reg, repVal);
        }
      } catch (_) {}
    }

    textarea.setRangeText(replacement, match.start, match.end, 'end');
    triggerChange();

    const nextPos = match.start + replacement.length;
    updateMatches(true, nextPos);
  }

  function replaceAll() {
    if (!textarea || !findInput) return;
    const query = findInput.value;
    if (!query) return;

    let regex = null;
    try {
      regex = buildRegex(query);
    } catch (_) { return; }
    if (!regex) return;

    const text = textarea.value;
    const repVal = replaceInput ? replaceInput.value : '';

    const allMatches = text.match(regex);
    const count = allMatches ? allMatches.length : 0;
    if (count === 0) {
      updateCountUI('0 matches');
      return;
    }

    const newText = text.replace(regex, repVal);
    const origScroll = textarea.scrollTop;
    textarea.setRangeText(newText, 0, text.length, 'preserve');
    triggerChange();
    textarea.scrollTop = origScroll;

    updateCountUI(`Replaced ${count}`);
    setTimeout(() => {
      updateMatches(false);
    }, 80);
  }

  function initFindWidget() {
    findWidget = document.getElementById('editor-find-widget');
    findInput = document.getElementById('find-input');
    replaceInput = document.getElementById('replace-input');
    matchesCountEl = document.getElementById('find-matches-count');
    btnFindPrev = document.getElementById('btn-find-prev');
    btnFindNext = document.getElementById('btn-find-next');
    btnFindCase = document.getElementById('btn-find-case');
    btnFindWord = document.getElementById('btn-find-word');
    btnFindRegex = document.getElementById('btn-find-regex');
    btnFindClose = document.getElementById('btn-find-close');
    btnToggleReplace = document.getElementById('find-toggle-replace');
    replaceRow = document.getElementById('find-replace-row');
    btnReplaceSingle = document.getElementById('btn-replace-single');
    btnReplaceAll = document.getElementById('btn-replace-all');

    if (!findWidget) return;

    if (findInput) {
      findInput.addEventListener('input', () => {
        updateMatches(true);
      });
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            findPrev();
          } else {
            findNext();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        } else if (e.altKey && e.key === 'ArrowDown') {
          e.preventDefault();
          toggleReplace();
        }
      });
    }

    if (replaceInput) {
      replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if ((e.metaKey || e.ctrlKey) && e.altKey) {
            replaceAll();
          } else if (e.altKey || e.shiftKey) {
            replaceAll();
          } else {
            replaceSingle();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      });
    }

    if (btnFindNext) btnFindNext.addEventListener('click', () => findNext());
    if (btnFindPrev) btnFindPrev.addEventListener('click', () => findPrev());

    if (btnFindCase) {
      btnFindCase.addEventListener('click', () => {
        matchCase = !matchCase;
        updateOptionsUI();
        updateMatches(true);
      });
    }

    if (btnFindWord) {
      btnFindWord.addEventListener('click', () => {
        wholeWord = !wholeWord;
        updateOptionsUI();
        updateMatches(true);
      });
    }

    if (btnFindRegex) {
      btnFindRegex.addEventListener('click', () => {
        isRegex = !isRegex;
        updateOptionsUI();
        updateMatches(true);
      });
    }

    if (btnFindClose) btnFindClose.addEventListener('click', () => closeFind());
    if (btnToggleReplace) btnToggleReplace.addEventListener('click', () => toggleReplace());
    if (btnReplaceSingle) btnReplaceSingle.addEventListener('click', () => replaceSingle());
    if (btnReplaceAll) btnReplaceAll.addEventListener('click', () => replaceAll());
  }

  // ==========================================================================
  // String & Line Operations
  // ==========================================================================
  function transformCase(type) {
    if (!textarea) return;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    const text = textarea.value;

    if (start === end) {
      let wStart = start;
      let wEnd = start;
      while (wStart > 0 && /\w/.test(text[wStart - 1])) wStart--;
      while (wEnd < text.length && /\w/.test(text[wEnd])) wEnd++;
      if (wStart === wEnd) return;
      start = wStart;
      end = wEnd;
      textarea.setSelectionRange(start, end);
    }

    const selected = text.substring(start, end);
    let transformed = selected;
    if (type === 'upper') {
      transformed = selected.toUpperCase();
    } else if (type === 'lower') {
      transformed = selected.toLowerCase();
    } else if (type === 'title') {
      transformed = selected.replace(/\b[a-z]/gi, char => char.toUpperCase());
    }

    textarea.focus();
    textarea.setRangeText(transformed, start, end, 'end');
    textarea.setSelectionRange(start, start + transformed.length);
    triggerChange();
  }

  function duplicateLineDown() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const lineBlock = text.substring(lineStart, lineEnd);
    const insertion = '\n' + lineBlock;
    textarea.setRangeText(insertion, lineEnd, lineEnd, 'end');
    const delta = lineEnd - lineStart + 1;
    textarea.setSelectionRange(start + delta, end + delta);
    triggerChange();
  }

  function moveLineUp() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    if (lineStart === 0) return; // already top line
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = text.length;

    const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLineEnd = lineStart - 1;

    const prevLine = text.substring(prevLineStart, prevLineEnd);
    const currentLines = text.substring(lineStart, lineEnd);

    const newBlock = currentLines + '\n' + prevLine;
    textarea.setRangeText(newBlock, prevLineStart, lineEnd, 'preserve');
    const diff = prevLine.length + 1;
    textarea.setSelectionRange(start - diff, end - diff);
    triggerChange();
  }

  function moveLineDown() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1 || lineEnd >= text.length) return; // already bottom line

    let nextLineEnd = text.indexOf('\n', lineEnd + 1);
    if (nextLineEnd === -1) nextLineEnd = text.length;

    const currentLines = text.substring(lineStart, lineEnd);
    const nextLine = text.substring(lineEnd + 1, nextLineEnd);

    const newBlock = nextLine + '\n' + currentLines;
    textarea.setRangeText(newBlock, lineStart, nextLineEnd, 'preserve');
    const diff = nextLine.length + 1;
    textarea.setSelectionRange(start + diff, end + diff);
    triggerChange();
  }

  function deleteLine() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    let deleteEnd = lineEnd;
    if (lineEnd === -1) {
      deleteEnd = text.length;
    } else {
      deleteEnd = lineEnd + 1;
    }
    textarea.setRangeText('', lineStart, deleteEnd, 'end');
    textarea.setSelectionRange(lineStart, lineStart);
    triggerChange();
  }

  function joinLines() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) return;
    let nextLineEnd = text.indexOf('\n', lineEnd + 1);
    if (nextLineEnd === -1) nextLineEnd = text.length;

    const nextLineText = text.substring(lineEnd + 1, nextLineEnd).trimStart();
    textarea.setRangeText(' ' + nextLineText, lineEnd, nextLineEnd, 'end');
    textarea.setSelectionRange(lineEnd, lineEnd);
    triggerChange();
  }

  function selectNextOccurrence() {
    if (!textarea) return;
    const text = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end) {
      let wStart = start;
      let wEnd = start;
      while (wStart > 0 && /\w/.test(text[wStart - 1])) wStart--;
      while (wEnd < text.length && /\w/.test(text[wEnd])) wEnd++;
      if (wStart < wEnd) {
        textarea.setSelectionRange(wStart, wEnd);
      }
      return;
    }

    const selectedText = text.substring(start, end);
    let nextIdx = text.indexOf(selectedText, end);
    if (nextIdx === -1) {
      nextIdx = text.indexOf(selectedText, 0);
    }
    if (nextIdx !== -1) {
      textarea.focus();
      textarea.setSelectionRange(nextIdx, nextIdx + selectedText.length);
      const textBefore = text.substring(0, nextIdx);
      const lineIndex = textBefore.split('\n').length - 1;
      const gutterLine = gutterEl ? gutterEl.querySelector(`.editor-gutter-line[data-line="${lineIndex}"]`) : null;
      if (gutterLine) {
        const targetScroll = Math.max(0, gutterLine.offsetTop - textarea.clientHeight / 2);
        textarea.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  }

  // ==========================================================================
  // Go to Line Popover & Navigation
  // ==========================================================================
  function initGoToLine() {
    gotoLineModal = document.getElementById('editor-goto-line-modal');
    gotoLineInput = document.getElementById('goto-line-input');
    gotoLineRange = document.getElementById('goto-line-range');
    btnGotoLineConfirm = document.getElementById('btn-goto-line-confirm');
    btnGotoLineClose = document.getElementById('btn-goto-line-close');

    if (!gotoLineModal) return;

    if (btnGotoLineConfirm) btnGotoLineConfirm.addEventListener('click', () => confirmGoToLine());
    if (btnGotoLineClose) btnGotoLineClose.addEventListener('click', () => closeGoToLine());

    if (gotoLineInput) {
      gotoLineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmGoToLine();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeGoToLine();
        }
      });
    }
  }

  function openGoToLine() {
    if (!gotoLineModal || !textarea) return;
    const lines = textarea.value.split('\n').length;
    if (gotoLineRange) gotoLineRange.textContent = `1 - ${lines}`;
    if (gotoLineInput) {
      const curLine = (textarea.value.substring(0, textarea.selectionStart || 0).split('\n').length);
      gotoLineInput.max = String(lines);
      gotoLineInput.value = String(curLine);
    }
    gotoLineModal.classList.remove('hidden');
    if (gotoLineInput) {
      gotoLineInput.focus();
      gotoLineInput.select();
    }
  }

  function closeGoToLine() {
    if (!gotoLineModal) return;
    gotoLineModal.classList.add('hidden');
    if (textarea) textarea.focus();
  }

  function confirmGoToLine() {
    if (!gotoLineInput || !textarea) return;
    const lineNum = parseInt(gotoLineInput.value, 10);
    if (!isNaN(lineNum) && lineNum >= 1) {
      scrollToLineAndSelect(lineNum - 1);
    }
    closeGoToLine();
  }

  function scrollToLineAndSelect(lineIndex, word = null) {
    if (!textarea) return;
    const text = textarea.value;
    const lines = text.split('\n');
    const clampedLine = Math.max(0, Math.min(lineIndex, lines.length - 1));

    let pos = 0;
    for (let i = 0; i < clampedLine; i++) {
      pos += lines[i].length + 1;
    }

    let selStart = pos;
    let selEnd = pos;

    if (word && word.trim()) {
      const cleanWord = word.trim();
      const lineText = lines[clampedLine] || '';
      const wordIdxInLine = lineText.toLowerCase().indexOf(cleanWord.toLowerCase());
      if (wordIdxInLine !== -1) {
        selStart = pos + wordIdxInLine;
        selEnd = selStart + cleanWord.length;
      } else {
        let checkOffset = 0;
        let foundPos = -1;
        for (let i = 0; i < lines.length; i++) {
          if (Math.abs(i - clampedLine) <= 2) {
            const idx = lines[i].toLowerCase().indexOf(cleanWord.toLowerCase());
            if (idx !== -1) {
              foundPos = checkOffset + idx;
              break;
            }
          }
          checkOffset += lines[i].length + 1;
        }
        if (foundPos !== -1) {
          selStart = foundPos;
          selEnd = foundPos + cleanWord.length;
        }
      }
    }

    textarea.focus();
    textarea.setSelectionRange(selStart, selEnd);
    updateStats();

    syncHighlightLineIndex = clampedLine;
    clearTimeout(syncHighlightTimer);
    syncHighlightTimer = setTimeout(() => {
      syncHighlightLineIndex = -1;
      scheduleGutterUpdate();
    }, 2200);

    updateGutter();

    if (gutterEl) {
      const gutterLine = gutterEl.querySelector(`.editor-gutter-line[data-line="${clampedLine}"]`);
      if (gutterLine) {
        const targetScroll = Math.max(0, gutterLine.offsetTop - textarea.clientHeight / 2);
        textarea.scrollTo({ top: targetScroll, behavior: 'smooth' });
        return;
      }
    }

    const ratio = clampedLine / Math.max(1, lines.length);
    const maxScroll = textarea.scrollHeight - textarea.clientHeight;
    textarea.scrollTo({ top: Math.max(0, ratio * maxScroll), behavior: 'smooth' });
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
    },
    // Find & Replace
    openFind,
    closeFind,
    findNext,
    findPrev,
    replaceSingle,
    replaceAll,
    toggleReplace,
    // String & Line Ops
    transformCase,
    duplicateLineDown,
    moveLineUp,
    moveLineDown,
    deleteLine,
    joinLines,
    selectNextOccurrence,
    // Go to Line
    openGoToLine,
    closeGoToLine,
    confirmGoToLine,
    scrollToLineAndSelect
  };
})();

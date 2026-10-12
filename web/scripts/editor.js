/**
 * LectNote: Editor Controller
 * Handles toolbar shortcuts, textarea manipulation, stats, and keybindings.
 */

window.LectNoteEditor = (function() {
  const textarea = document.getElementById('markdown-input');
  const statsEl = document.getElementById('editor-stats');
  const saveStatusEl = document.getElementById('save-status');

  function init() {
    if (!textarea) return;

    // Listen to input changes
    textarea.addEventListener('input', () => {
      updateStats();
      markUnsaved();
      if (window.LectNoteApp) {
        window.LectNoteApp.onMarkdownChange(textarea.value);
      }
    });

    // Handle Tab key
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertText('  ');
      }

      // Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (window.LectNoteApp) {
          window.LectNoteApp.saveCurrentLecture();
        }
      }
    });

    // Track cursor position on click and navigation
    textarea.addEventListener('keyup', updateStats);
    textarea.addEventListener('click', updateStats);
    textarea.addEventListener('select', updateStats);

    // Attach toolbar button actions
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        handleToolAction(action);
      });
    });
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
    textarea.value = text.substring(0, start) + replacement + text.substring(end);
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

    textarea.value = text.substring(0, start) + prefix + snippet + text.substring(end);
    textarea.focus();
    const newPos = start + prefix.length + snippet.length;
    textarea.setSelectionRange(newPos, newPos);

    triggerChange();
  }

  function insertText(snippet) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + snippet + text.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + snippet.length, start + snippet.length);

    triggerChange();
  }

  function triggerChange() {
    updateStats();
    markUnsaved();
    if (window.LectNoteApp) {
      window.LectNoteApp.onMarkdownChange(textarea.value);
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

  function markSaved() {
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
    markSaved();
  }

  return {
    init,
    getValue,
    setValue,
    markSaved
  };
})();


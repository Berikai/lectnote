/**
 * LectNote: AI Study Assistant & Tutor Controller
 * Manages per-lecture conversational tutoring drawer, chat history,
 * KaTeX mathematical rendering in chat, and note insertion.
 */

window.LectNoteAssistant = (function() {
  let drawer = null;
  let btnToggle = null;
  let btnClose = null;
  let btnClear = null;
  let btnSend = null;
  let inputEl = null;
  let messagesContainer = null;

  let currentCourse = '';
  let currentLecture = '';
  let isLoading = false;

  function init() {
    drawer = document.getElementById('assistant-drawer');
    btnToggle = document.getElementById('btn-toggle-assistant');
    btnClose = document.getElementById('btn-close-assistant');
    btnClear = document.getElementById('btn-clear-chat');
    btnSend = document.getElementById('btn-send-assistant');
    inputEl = document.getElementById('assistant-input');
    messagesContainer = document.getElementById('assistant-messages');

    if (!drawer) return;

    if (btnToggle) {
      btnToggle.addEventListener('click', toggle);
    }
    if (btnClose) {
      btnClose.addEventListener('click', close);
    }
    if (btnClear) {
      btnClear.addEventListener('click', clearHistory);
    }
    if (btnSend) {
      btnSend.addEventListener('click', handleSend);
    }

    const btnStatus = document.getElementById('btn-assistant-ai-status');
    if (btnStatus) {
      btnStatus.addEventListener('click', () => {
        if (window.LectNoteSettings) {
          window.LectNoteSettings.open('ai');
        } else if (window.LectNoteApp) {
          window.LectNoteApp.openSettings('ai');
        }
      });
    }

    if (inputEl) {
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    // Quick prompt chip triggers
    document.querySelectorAll('.assistant-prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        if (prompt && inputEl) {
          inputEl.value = prompt;
          handleSend();
        }
      });
    });

    // Global keyboard shortcut: Cmd+J or Ctrl+J to toggle Tutor
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        close();
      }
    });
  }

  function toggle() {
    if (!drawer) return;
    if (drawer.classList.contains('open')) {
      close();
    } else {
      open();
    }
  }

  function open() {
    if (!drawer) return;
    // Close photo drawer if open
    const photoDrawer = document.getElementById('photo-drawer');
    if (photoDrawer && photoDrawer.classList.contains('open')) {
      photoDrawer.classList.remove('open');
    }

    drawer.classList.add('open');
    if (btnToggle) btnToggle.classList.add('active');
    if (window.LectNoteSettings) {
      window.LectNoteSettings.updateAssistantStatusBadge();
    }
    if (inputEl) {
      setTimeout(() => inputEl.focus(), 120);
    }
  }

  function close() {
    if (!drawer) return;
    drawer.classList.remove('open');
    if (btnToggle) btnToggle.classList.remove('active');
  }

  async function setWorkspace(course, lecture) {
    currentCourse = course;
    currentLecture = lecture;
    await loadHistory();
  }

  async function loadHistory() {
    if (!currentCourse || !currentLecture || !messagesContainer) return;
    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/chat`);
      if (!res.ok) throw new Error('Failed to load chat history');
      const data = await res.json();
      renderMessages(data.history || []);
    } catch (err) {
      messagesContainer.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:12px;">Welcome to your Study Assistant! Ask questions or click a quick prompt above.</div>`;
    }
  }

  function renderMessages(messages) {
    if (!messagesContainer) return;
    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div style="text-align:center;padding:32px 16px;color:var(--text-dim);font-size:12px;">
          <svg style="width:36px;height:36px;margin:0 auto 8px;opacity:0.6;display:block;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <strong>No study questions yet</strong><br>
          Ask questions, get formula explanations, or generate practice exam problems.
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = messages.map((m, idx) => {
      const isUser = m.role === 'user';
      const hasSetupTip = !isUser && (m.content.includes('Direct AI Tutoring Setup') || m.content.includes('Workspace Settings (⌘,)'));
      return `
        <div class="assistant-msg ${isUser ? 'user' : 'assistant'}" data-index="${idx}">
          <div class="assistant-msg-content">${renderMarkdownText(m.content)}</div>
          ${hasSetupTip ? `
            <div class="assistant-msg-setup-banner" style="margin-top:10px;padding:8px 12px;background:var(--bg-surface-raised);border:1px solid var(--border-default);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span style="font-size:11.5px;color:var(--text-secondary);">⚡ Configure Gemini API Key for step-by-step derivations:</span>
              <button class="btn btn-primary btn-xs btn-open-settings-ai" style="white-space:nowrap;">Open AI Settings</button>
            </div>
          ` : ''}
          ${!isUser ? `
            <div class="assistant-msg-actions">
              <button class="assistant-msg-btn btn-append-note" title="Insert this explanation into your lecture notes">
                <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Add to Notes</span>
              </button>
              <button class="assistant-msg-btn btn-copy-msg" title="Copy answer to clipboard">
                <svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    renderKaTeXInFeed();
    attachMessageActionListeners(messages);
    scrollToBottom();
  }

  function renderMarkdownText(text) {
    if (window.markdownit) {
      const md = window.markdownit({ html: true, linkify: true, breaks: true });
      return md.render(text || '');
    }
    return escapeHtml(text || '').replace(/\n/g, '<br>');
  }

  function renderKaTeXInFeed() {
    if (window.renderMathInElement && messagesContainer) {
      try {
        window.renderMathInElement(messagesContainer, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false
        });
      } catch (e) {
        // Ignore math render error
      }
    }
  }

  function attachMessageActionListeners(messages) {
    if (!messagesContainer) return;

    messagesContainer.querySelectorAll('.btn-open-settings-ai').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.LectNoteSettings) {
          window.LectNoteSettings.open('ai');
        } else if (window.LectNoteApp) {
          window.LectNoteApp.openSettings('ai');
        }
      });
    });

    messagesContainer.querySelectorAll('.btn-append-note').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const msgEl = btn.closest('.assistant-msg');
        if (!msgEl) return;
        const idx = parseInt(msgEl.dataset.index, 10);
        const msg = messages[idx];
        if (!msg) return;

        try {
          const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/chat/append`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: msg.content })
          });
          if (!res.ok) throw new Error('Failed to append to notes');
          const data = await res.json();
          if (window.LectNoteEditor) {
            window.LectNoteEditor.setValue(data.markdown);
          }
          if (window.LectNoteApp) {
            window.LectNoteApp.showToast('Appended explanation to notes!', 'success');
          }
          btn.innerHTML = `<span>✓ Added</span>`;
        } catch (err) {
          if (window.LectNoteApp) {
            window.LectNoteApp.showToast(`Error: ${err.message}`, 'error');
          }
        }
      });
    });

    messagesContainer.querySelectorAll('.btn-copy-msg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const msgEl = btn.closest('.assistant-msg');
        if (!msgEl) return;
        const idx = parseInt(msgEl.dataset.index, 10);
        const msg = messages[idx];
        if (!msg) return;

        navigator.clipboard.writeText(msg.content);
        btn.innerHTML = `<span>✓ Copied</span>`;
        setTimeout(() => {
          btn.innerHTML = `<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>`;
        }, 2000);
      });
    });
  }

  async function handleSend() {
    if (!inputEl || isLoading) return;
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    isLoading = true;
    if (btnSend) btnSend.disabled = true;

    // Append optimistic user message
    const emptyPlaceholder = messagesContainer.querySelector('strong');
    if (emptyPlaceholder) messagesContainer.innerHTML = '';

    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'assistant-msg user';
    userMsgEl.innerHTML = `<div class="assistant-msg-content">${renderMarkdownText(text)}</div>`;
    messagesContainer.appendChild(userMsgEl);

    // Typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'assistant-msg assistant typing-indicator';
    typingEl.innerHTML = `<div style="font-size:12px;color:var(--text-dim);font-style:italic;">Thinking and formulating explanation...</div>`;
    messagesContainer.appendChild(typingEl);
    scrollToBottom();

    try {
      const aiConfig = window.LectNoteSettings ? window.LectNoteSettings.getAIConfig() : {
        apiKey: localStorage.getItem('lectnote_api_key') || '',
        provider: localStorage.getItem('lectnote_ai_provider') || 'gemini',
        model: localStorage.getItem('lectnote_ai_model') || '',
        baseUrl: localStorage.getItem('lectnote_ai_base_url') || ''
      };

      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model,
          baseUrl: aiConfig.baseUrl
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      renderMessages(data.history || []);
    } catch (err) {
      typingEl.remove();
      const errEl = document.createElement('div');
      errEl.className = 'assistant-msg assistant';
      errEl.style.borderColor = '#ef4444';
      errEl.innerHTML = `<div style="color:#ef4444;font-size:12px;">Failed to get response: ${escapeHtml(err.message)}</div>`;
      messagesContainer.appendChild(errEl);
      scrollToBottom();
    } finally {
      isLoading = false;
      if (btnSend) btnSend.disabled = false;
      if (inputEl) inputEl.focus();
    }
  }

  async function clearHistory() {
    if (!confirm('Clear all study assistant chat history for this lecture?')) return;
    try {
      await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/chat`, {
        method: 'DELETE'
      });
      renderMessages([]);
      if (window.LectNoteApp) {
        window.LectNoteApp.showToast('Chat history cleared', 'info');
      }
    } catch (err) {
      if (window.LectNoteApp) {
        window.LectNoteApp.showToast(`Error: ${err.message}`, 'error');
      }
    }
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  return {
    init,
    open,
    close,
    toggle,
    setWorkspace
  };
})();


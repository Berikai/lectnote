/**
 * LectNote: Workspace & AI Settings Controller
 * Handles tabbed settings navigation, multi-provider credentials (Gemini, DeepSeek, OpenAI),
 * API testing diagnostics, local/desktop storage directory management, and MCP integrations.
 */

window.LectNoteSettings = (function() {
  const modal = document.getElementById('modal-settings');
  const navTabs = document.querySelectorAll('.settings-tab-btn');
  const panes = document.querySelectorAll('.settings-tab-pane');

  // Storage elements
  const pathDisplay = document.getElementById('settings-lectures-path-display');
  const btnCopyPath = document.getElementById('btn-copy-lectures-path');
  const btnChangeDir = document.getElementById('btn-change-lectures-dir');
  const btnRevealDir = document.getElementById('btn-reveal-lectures-dir');
  const btnResetDir = document.getElementById('btn-reset-lectures-dir');
  const revealBtnText = document.getElementById('reveal-btn-text');
  const storageBadge = document.getElementById('settings-storage-mode-badge');
  const storageInfoText = document.getElementById('settings-storage-info-text');

  // AI elements
  const providerCards = document.querySelectorAll('.settings-provider-card');
  const inputApiKey = document.getElementById('settings-ai-api-key');
  const btnToggleKeyVis = document.getElementById('btn-toggle-key-visibility');
  const inputModel = document.getElementById('settings-ai-model');
  const groupBaseUrl = document.getElementById('settings-base-url-group');
  const inputBaseUrl = document.getElementById('settings-ai-base-url');
  const linkApiKey = document.getElementById('settings-key-link');
  const btnTestAI = document.getElementById('btn-test-ai-connection');
  const btnSaveAI = document.getElementById('btn-save-ai-settings');
  const testStatusBox = document.getElementById('settings-ai-test-status');
  const modelPresetsContainer = document.getElementById('settings-model-presets');

  // MCP elements
  const mcpCodeSnippet = document.getElementById('mcp-config-json');
  const btnCopyMcpCmd = document.getElementById('btn-copy-mcp-cmd');
  const btnCopyMcpJson = document.getElementById('btn-copy-mcp-json');

  // About elements
  const aboutAppMeta = document.getElementById('about-app-meta');

  let activeTab = 'storage';
  let selectedProvider = 'gemini';
  let isKeyVisible = false;
  let isElectron = Boolean(window.lectnoteDesktop);
  let currentLecturesDir = '';

  const defaultModels = {
    gemini: 'gemini-2.5-flash',
    deepseek: 'deepseek-chat',
    openai: 'gpt-4o',
    offline: ''
  };

  const providerModelPresets = {
    gemini: [
      { label: '2.5 Flash (Recommended)', model: 'gemini-2.5-flash' },
      { label: '2.0 Flash', model: 'gemini-2.0-flash' },
      { label: '1.5 Flash', model: 'gemini-1.5-flash' },
      { label: '1.5 Pro', model: 'gemini-1.5-pro' }
    ],
    deepseek: [
      { label: 'DeepSeek Chat', model: 'deepseek-chat' },
      { label: 'DeepSeek Reasoner (R1)', model: 'deepseek-reasoner' }
    ],
    openai: [
      { label: 'GPT-4o', model: 'gpt-4o' },
      { label: 'GPT-4o-mini', model: 'gpt-4o-mini' },
      { label: 'Ollama / Local (llama3)', model: 'llama3' }
    ],
    offline: []
  };

  function init() {
    setupTabNavigation();
    setupStorageActions();
    setupAIActions();
    setupMCPActions();
    loadSettings();
  }

  function setupTabNavigation() {
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        switchTab(target);
      });
    });

    // Close buttons
    document.querySelectorAll('.btn-close-modal[data-modal="modal-settings"]').forEach(btn => {
      btn.addEventListener('click', close);
    });
  }

  function switchTab(tabId) {
    activeTab = tabId || 'storage';
    navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
    panes.forEach(p => p.classList.toggle('active', p.dataset.pane === activeTab));
  }

  function setupStorageActions() {
    if (btnCopyPath) {
      btnCopyPath.addEventListener('click', () => {
        if (!currentLecturesDir) return;
        copyToClipboard(currentLecturesDir, btnCopyPath, 'Copied Path!');
      });
    }

    if (btnChangeDir) {
      btnChangeDir.addEventListener('click', async () => {
        if (!isElectron) {
          if (window.LectNoteApp) window.LectNoteApp.showToast('Directory selection is only available in Desktop mode', 'info');
          return;
        }
        try {
          const result = await window.lectnoteDesktop.selectLecturesDirectory();
          if (result.success && result.lecturesDir) {
            currentLecturesDir = result.lecturesDir;
            if (pathDisplay) pathDisplay.textContent = currentLecturesDir;
            if (window.LectNoteApp) {
              window.LectNoteApp.showToast(`Lectures directory updated: ${result.lecturesDir}`, 'success');
              await window.LectNoteApp.loadCourses();
            }
            updateMCPConfigSnippet();
          }
        } catch (err) {
          if (window.LectNoteApp) window.LectNoteApp.showToast(`Failed to change directory: ${err.message}`, 'error');
        }
      });
    }

    if (btnRevealDir) {
      btnRevealDir.addEventListener('click', async () => {
        if (!isElectron) return;
        try {
          await window.lectnoteDesktop.openLecturesDirectory(currentLecturesDir);
        } catch (err) {
          if (window.LectNoteApp) window.LectNoteApp.showToast(`Cannot open folder: ${err.message}`, 'error');
        }
      });
    }

    if (btnResetDir) {
      btnResetDir.addEventListener('click', async () => {
        if (!isElectron) return;
        try {
          const result = await window.lectnoteDesktop.resetLecturesDirectory();
          if (result.success && result.lecturesDir) {
            currentLecturesDir = result.lecturesDir;
            if (pathDisplay) pathDisplay.textContent = currentLecturesDir;
            if (window.LectNoteApp) {
              window.LectNoteApp.showToast(`Reset to default directory: ${result.lecturesDir}`, 'info');
              await window.LectNoteApp.loadCourses();
            }
            updateMCPConfigSnippet();
          }
        } catch (err) {
          if (window.LectNoteApp) window.LectNoteApp.showToast(`Failed to reset directory: ${err.message}`, 'error');
        }
      });
    }
  }

  function setupAIActions() {
    // Provider card selections
    providerCards.forEach(card => {
      card.addEventListener('click', () => {
        const p = card.dataset.provider;
        selectProvider(p);
      });
    });

    // Eye toggle for API key password visibility
    if (btnToggleKeyVis && inputApiKey) {
      btnToggleKeyVis.addEventListener('click', () => {
        isKeyVisible = !isKeyVisible;
        inputApiKey.type = isKeyVisible ? 'text' : 'password';
        btnToggleKeyVis.innerHTML = isKeyVisible
          ? `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
          : `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      });
    }

    // Test Connection
    if (btnTestAI) {
      btnTestAI.addEventListener('click', testAIConnection);
    }

    // Save AI Settings
    if (btnSaveAI) {
      btnSaveAI.addEventListener('click', saveAISettings);
    }
  }

  function selectProvider(p) {
    selectedProvider = p;
    providerCards.forEach(c => c.classList.toggle('selected', c.dataset.provider === selectedProvider));

    // Show/hide base URL field
    if (groupBaseUrl) {
      groupBaseUrl.style.display = (selectedProvider === 'openai') ? 'block' : 'none';
    }

    // Update link
    if (linkApiKey) {
      if (selectedProvider === 'gemini') {
        linkApiKey.href = 'https://aistudio.google.com/apikey';
        linkApiKey.textContent = 'Get free Gemini API Key ↗';
        linkApiKey.style.display = 'inline';
      } else if (selectedProvider === 'deepseek') {
        linkApiKey.href = 'https://platform.deepseek.com/api_keys';
        linkApiKey.textContent = 'Get DeepSeek API Key ↗';
        linkApiKey.style.display = 'inline';
      } else if (selectedProvider === 'openai') {
        linkApiKey.href = 'https://platform.openai.com/api-keys';
        linkApiKey.textContent = 'Get OpenAI API Key ↗';
        linkApiKey.style.display = 'inline';
      } else {
        linkApiKey.style.display = 'none';
      }
    }

    // Disable / enable key input if offline
    if (inputApiKey) {
      inputApiKey.disabled = (selectedProvider === 'offline');
      if (selectedProvider === 'offline') {
        inputApiKey.placeholder = 'Offline mode active (no external API calls)';
      } else {
        inputApiKey.placeholder = `Enter ${selectedProvider === 'gemini' ? 'Gemini' : selectedProvider} API Key`;
      }
    }

    // Load saved key & model for this provider
    const savedKey = localStorage.getItem(`lectnote_${selectedProvider}_key`) || (selectedProvider === 'gemini' ? localStorage.getItem('lectnote_api_key') : '') || '';
    if (inputApiKey) inputApiKey.value = savedKey;

    const savedModel = localStorage.getItem(`lectnote_${selectedProvider}_model`) || defaultModels[selectedProvider] || '';
    if (inputModel) inputModel.value = savedModel;

    if (inputBaseUrl && selectedProvider === 'openai') {
      inputBaseUrl.value = localStorage.getItem('lectnote_openai_baseurl') || 'http://localhost:11434/v1';
    }

    renderModelPresets();
    hideTestStatus();
  }

  function renderModelPresets() {
    if (!modelPresetsContainer) return;
    const presets = providerModelPresets[selectedProvider] || [];
    if (presets.length === 0) {
      modelPresetsContainer.innerHTML = '';
      return;
    }

    modelPresetsContainer.innerHTML = presets.map(p => `
      <button type="button" class="settings-chip" data-model="${p.model}">${p.label}</button>
    `).join('');

    modelPresetsContainer.querySelectorAll('.settings-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (inputModel) inputModel.value = btn.dataset.model;
      });
    });
  }

  function setupMCPActions() {
    if (btnCopyMcpCmd) {
      btnCopyMcpCmd.addEventListener('click', () => {
        copyToClipboard('node bin/lectnote-mcp.js', btnCopyMcpCmd, 'Copied Command!');
      });
    }

    if (btnCopyMcpJson && mcpCodeSnippet) {
      btnCopyMcpJson.addEventListener('click', () => {
        copyToClipboard(mcpCodeSnippet.textContent.trim(), btnCopyMcpJson, 'Copied Config JSON!');
      });
    }
  }

  function updateMCPConfigSnippet() {
    if (!mcpCodeSnippet) return;
    // Compute absolute path to bin/lectnote-mcp.js based on current directory if possible
    let mcpPath = 'bin/lectnote-mcp.js';
    if (currentLecturesDir) {
      // Typically lectures is inside repo root or documents
      const candidateRoot = currentLecturesDir.replace(/\/lectures\/?$/, '');
      if (candidateRoot && candidateRoot !== currentLecturesDir) {
        mcpPath = `${candidateRoot}/bin/lectnote-mcp.js`;
      }
    }
    const config = {
      mcpServers: {
        lectnote: {
          command: "node",
          args: [mcpPath]
        }
      }
    };
    mcpCodeSnippet.textContent = JSON.stringify(config, null, 2);
  }

  async function loadSettings() {
    try {
      let platform = 'web';
      let appVersion = '1.0.0';

      if (isElectron) {
        const data = await window.lectnoteDesktop.getSettings();
        currentLecturesDir = data.lecturesDir || '';
        platform = data.platform || 'darwin';
        appVersion = data.appVersion || '1.0.0';
      } else {
        const res = await fetch('/api/settings');
        const data = await res.json();
        currentLecturesDir = data.lecturesDir || '';
      }

      // Populate path
      if (pathDisplay) {
        pathDisplay.textContent = currentLecturesDir || 'Default: ./lectures';
      }

      // Storage badge
      if (storageBadge) {
        if (isElectron) {
          storageBadge.className = 'settings-badge badge-success';
          storageBadge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;"></span> Native Desktop Storage`;
          if (btnChangeDir) btnChangeDir.style.display = 'inline-flex';
          if (btnRevealDir) btnRevealDir.style.display = 'inline-flex';
          if (btnResetDir) btnResetDir.style.display = 'inline-flex';
        } else {
          storageBadge.className = 'settings-badge';
          storageBadge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#64748b;display:inline-block;"></span> Web Server Directory`;
          if (btnChangeDir) btnChangeDir.style.display = 'none';
          if (btnRevealDir) btnRevealDir.style.display = 'none';
          if (btnResetDir) btnResetDir.style.display = 'none';
        }
      }

      if (storageInfoText) {
        storageInfoText.textContent = isElectron
          ? 'Native file-system storage active. You can change folders anytime or reveal in OS file manager.'
          : 'Storage path is controlled by the LectNote backend via LECTURES_DIR. For native file browsing, use LectNote Desktop.';
      }

      // Platform text
      if (revealBtnText) {
        if (platform === 'darwin') revealBtnText.textContent = 'Reveal in Finder';
        else if (platform === 'win32') revealBtnText.textContent = 'Reveal in Explorer';
        else revealBtnText.textContent = 'Open File Manager';
      }

      if (aboutAppMeta) {
        aboutAppMeta.textContent = isElectron
          ? `LectNote Desktop v${appVersion} (${platform}) · Node ${window.process?.versions?.node || 'runtime'}`
          : `LectNote Web Studio v${appVersion} · Node.js Server`;
      }

      updateMCPConfigSnippet();

      // Load AI Provider & Keys
      const savedProvider = localStorage.getItem('lectnote_provider') || localStorage.getItem('lectnote_ai_provider') || 'gemini';
      selectProvider(savedProvider);

      updateAssistantStatusBadge();
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function testAIConnection() {
    if (!testStatusBox) return;
    const key = inputApiKey ? inputApiKey.value.trim() : '';
    const model = inputModel ? inputModel.value.trim() : '';
    const baseUrl = inputBaseUrl ? inputBaseUrl.value.trim() : '';

    if (selectedProvider !== 'offline' && !key) {
      showTestStatus('error', `Please enter a valid API key for ${selectedProvider === 'gemini' ? 'Google Gemini' : selectedProvider}.`);
      return;
    }

    showTestStatus('loading', `Verifying connection to ${selectedProvider}...`);

    try {
      const res = await fetch('/api/settings/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: key,
          model,
          baseUrl
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server returned error (${res.status})`);
      }

      showTestStatus('success', data.message || 'Connection successful!');
    } catch (err) {
      showTestStatus('error', err.message);
    }
  }

  function showTestStatus(type, msg) {
    if (!testStatusBox) return;
    testStatusBox.className = `settings-status-box show ${type}`;
    const icon = type === 'success'
      ? `<svg class="ui-icon" style="color:#10b981;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
      : type === 'error'
      ? `<svg class="ui-icon" style="color:#ef4444;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<svg class="ui-icon spin" style="color:#3b82f6;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

    testStatusBox.innerHTML = `${icon}<span>${escapeHtml(msg)}</span>`;
  }

  function hideTestStatus() {
    if (!testStatusBox) return;
    testStatusBox.className = 'settings-status-box';
    testStatusBox.innerHTML = '';
  }

  async function saveAISettings() {
    const key = inputApiKey ? inputApiKey.value.trim() : '';
    const model = inputModel ? inputModel.value.trim() : '';
    const baseUrl = inputBaseUrl ? inputBaseUrl.value.trim() : '';

    // Persist to localStorage
    localStorage.setItem('lectnote_provider', selectedProvider);
    localStorage.setItem('lectnote_ai_provider', selectedProvider);

    if (key) {
      localStorage.setItem(`lectnote_${selectedProvider}_key`, key);
      localStorage.setItem('lectnote_api_key', key);
      if (selectedProvider === 'gemini') {
        localStorage.setItem('lectnote_gemini_key', key);
      }
    } else if (selectedProvider === 'offline') {
      // keep existing
    }

    if (model) {
      localStorage.setItem(`lectnote_${selectedProvider}_model`, model);
      localStorage.setItem('lectnote_ai_model', model);
      if (selectedProvider === 'gemini') {
        localStorage.setItem('lectnote_gemini_model', model);
      }
    }

    if (selectedProvider === 'openai' && baseUrl) {
      localStorage.setItem('lectnote_openai_baseurl', baseUrl);
      localStorage.setItem('lectnote_ai_base_url', baseUrl);
    }

    // Persist to Electron settings.json if desktop
    if (isElectron && window.lectnoteDesktop?.saveSettings) {
      await window.lectnoteDesktop.saveSettings({
        aiProvider: selectedProvider,
        aiModel: model,
        aiBaseUrl: baseUrl
      }).catch(console.error);
    }

    // Sync to server runtime
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: selectedProvider,
        aiModel: model,
        aiBaseUrl: baseUrl
      })
    }).catch(console.error);

    if (window.LectNoteApp) {
      window.LectNoteApp.showToast('AI Study Assistant settings saved!', 'success');
    }

    updateAssistantStatusBadge();
  }

  function getAIConfig() {
    const provider = localStorage.getItem('lectnote_provider') || localStorage.getItem('lectnote_ai_provider') || 'gemini';
    const apiKey = localStorage.getItem(`lectnote_${provider}_key`) || localStorage.getItem('lectnote_api_key') || localStorage.getItem('lectnote_gemini_key') || '';
    const model = localStorage.getItem(`lectnote_${provider}_model`) || localStorage.getItem('lectnote_ai_model') || defaultModels[provider] || 'gemini-2.5-flash';
    const baseUrl = localStorage.getItem('lectnote_openai_baseurl') || localStorage.getItem('lectnote_ai_base_url') || '';

    return {
      provider,
      apiKey,
      model,
      baseUrl
    };
  }

  function updateAssistantStatusBadge() {
    const pill = document.getElementById('btn-assistant-ai-status');
    const statusText = document.getElementById('assistant-status-text');
    const dot = pill ? pill.querySelector('.status-dot-indicator') : null;

    if (!pill || !statusText) return;

    const config = getAIConfig();
    const isOnline = config.provider !== 'offline' && Boolean(config.apiKey);

    if (isOnline) {
      if (dot) dot.className = 'status-dot-indicator online';
      statusText.textContent = config.provider === 'gemini' ? (config.model || 'Gemini Flash') : `${config.provider} (${config.model || 'Active'})`;
      pill.title = 'AI Tutor is Online · Click to open Settings';
    } else {
      if (dot) dot.className = 'status-dot-indicator';
      statusText.textContent = 'Offline Mode';
      pill.title = 'AI Tutor in Offline Mode · Click to configure API Key';
    }
  }

  function copyToClipboard(text, btnElement, feedbackText = 'Copied!') {
    if (!text) return;
    const originalHtml = btnElement ? btnElement.innerHTML : '';

    const executeFeedback = () => {
      if (btnElement) {
        btnElement.innerHTML = `<span>✓ ${escapeHtml(feedbackText)}</span>`;
        setTimeout(() => {
          btnElement.innerHTML = originalHtml;
        }, 2000);
      }
      if (window.LectNoteApp) {
        window.LectNoteApp.showToast(feedbackText, 'info');
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(executeFeedback).catch(() => {
        fallbackCopy(text);
        executeFeedback();
      });
    } else {
      fallbackCopy(text);
      executeFeedback();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  function open(targetTab = 'storage') {
    if (!modal) return;
    modal.classList.add('active');
    switchTab(targetTab);
    loadSettings();
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('active');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init,
    open,
    close,
    switchTab,
    getAIConfig,
    updateAssistantStatusBadge
  };
})();


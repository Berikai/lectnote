/**
 * LectNote: Ingestion & Multi-Provider AI Modal
 * Handles switching between Gemini 3.8 Flash, DeepSeek v4.1 Flash, OpenAI-Compatible, and Manual mode.
 */

window.LectNoteIngestion = (function() {
  const modal = document.getElementById('modal-ingestion');
  const providerCards = document.querySelectorAll('.provider-card');
  const fieldBaseUrl = document.getElementById('field-base-url');
  const fieldApiKey = document.getElementById('field-api-key');
  const fieldModelName = document.getElementById('field-model-name');
  const inputBaseUrl = document.getElementById('input-base-url');
  const inputApiKey = document.getElementById('input-api-key');
  const inputModelName = document.getElementById('input-model-name');
  const inputCourse = document.getElementById('input-context-course');
  const inputSubject = document.getElementById('input-context-subject');
  const inputCustomPrompt = document.getElementById('input-custom-prompt');
  const dropzone = document.getElementById('ingest-dropzone');
  const fileInput = document.getElementById('ingest-file-input');
  const stagedPhotosList = document.getElementById('ingest-staged-photos');
  const btnRunIngest = document.getElementById('btn-run-ingest');

  let selectedProvider = 'gemini';
  let stagedFiles = [];

  const defaultModels = {
    gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-v4.1-flash',
    openai: 'gpt-4o',
    manual: ''
  };

  function init() {
    loadSavedSettings();

    // Provider Card Clicks
    providerCards.forEach(card => {
      card.addEventListener('click', () => {
        providerCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedProvider = card.dataset.provider;
        updateProviderForm();
      });
    });

    // Dropzone Events
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFiles(e.dataTransfer.files);
        }
      });
    }

    // Run Ingestion
    if (btnRunIngest) {
      btnRunIngest.addEventListener('click', runIngestion);
    }

    updateProviderForm();
  }

  function handleFiles(files) {
    stagedFiles = Array.from(files);
    if (stagedPhotosList) {
      stagedPhotosList.innerHTML = stagedFiles.length > 0
        ? `Staged for upload: <strong>${stagedFiles.length} photo(s)</strong> (${stagedFiles.map(f => f.name).slice(0, 3).join(', ')}${stagedFiles.length > 3 ? '...' : ''})`
        : '';
    }
  }

  function updateProviderForm() {
    // Show/hide fields based on selected provider
    if (selectedProvider === 'manual') {
      fieldBaseUrl.style.display = 'none';
      fieldApiKey.style.display = 'none';
      fieldModelName.style.display = 'none';
      btnRunIngest.querySelector('.btn-text').textContent = 'Apply Template & Attach Photos';
    } else if (selectedProvider === 'openai') {
      fieldBaseUrl.style.display = 'flex';
      fieldApiKey.style.display = 'flex';
      fieldModelName.style.display = 'flex';
      btnRunIngest.querySelector('.btn-text').textContent = 'Run AI Transcription';
    } else {
      fieldBaseUrl.style.display = 'none';
      fieldApiKey.style.display = 'flex';
      fieldModelName.style.display = 'flex';
      btnRunIngest.querySelector('.btn-text').textContent = 'Run AI Transcription';
    }

    // Set model default if not customized
    const savedModel = localStorage.getItem(`lectnote_${selectedProvider}_model`);
    inputModelName.value = savedModel || defaultModels[selectedProvider] || '';

    // Load saved API key for provider
    const savedKey = localStorage.getItem(`lectnote_${selectedProvider}_key`);
    inputApiKey.value = savedKey || '';

    // Load saved Base URL if applicable
    if (selectedProvider === 'openai') {
      inputBaseUrl.value = localStorage.getItem('lectnote_openai_baseurl') || 'http://localhost:11434/v1';
    }
  }

  function loadSavedSettings() {
    const lastProvider = localStorage.getItem('lectnote_provider');
    if (lastProvider) {
      selectedProvider = lastProvider;
      providerCards.forEach(c => {
        c.classList.toggle('selected', c.dataset.provider === selectedProvider);
      });
    }
  }

  function saveSettings() {
    localStorage.setItem('lectnote_provider', selectedProvider);
    if (inputApiKey.value) {
      localStorage.setItem(`lectnote_${selectedProvider}_key`, inputApiKey.value.trim());
    }
    if (inputModelName.value) {
      localStorage.setItem(`lectnote_${selectedProvider}_model`, inputModelName.value.trim());
    }
    if (selectedProvider === 'openai' && inputBaseUrl.value) {
      localStorage.setItem('lectnote_openai_baseurl', inputBaseUrl.value.trim());
    }
  }

  async function runIngestion() {
    if (!window.LectNoteApp) return;
    const { course, lecture } = window.LectNoteApp.getCurrentWorkspace();
    if (!course || !lecture) {
      window.LectNoteApp.showToast('Please select or create a lecture first.', 'error');
      return;
    }

    saveSettings();

    const apiKey = inputApiKey.value.trim();
    const baseUrl = inputBaseUrl.value.trim();
    const model = inputModelName.value.trim();
    const subject = inputSubject.value.trim() || 'Engineering & Science';
    const customPrompt = inputCustomPrompt.value.trim();

    if (selectedProvider !== 'manual' && selectedProvider !== 'openai' && !apiKey) {
      window.LectNoteApp.showToast(`Please enter your ${selectedProvider.toUpperCase()} API key.`, 'error');
      return;
    }

    const btnText = btnRunIngest.querySelector('.btn-text');
    const originalText = btnText.textContent;
    btnText.innerHTML = `<span class="spinner"></span> Processing Lecture Photos...`;
    btnRunIngest.disabled = true;

    try {
      // 1. Upload staged photos if any
      if (stagedFiles.length > 0) {
        window.LectNoteApp.showToast('Uploading lecture whiteboard photos...', 'info');
        const formData = new FormData();
        stagedFiles.forEach(f => formData.append('photos', f));

        const upRes = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/upload`, {
          method: 'POST',
          body: formData
        });
        const upData = await upRes.json();
        if (!upData.success) throw new Error(upData.error || 'Photo upload failed');
      }

      // 2. Call AI Transcription endpoint
      window.LectNoteApp.showToast(`Synthesizing lecture notes with ${selectedProvider.toUpperCase()}...`, 'info');
      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/ai-transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey,
          baseUrl,
          model,
          subject,
          lectureTitle: lecture.replace(/[-_]/g, ' '),
          customInstructions: customPrompt
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'AI transcription failed');
      }

      // 3. Update Editor & Workspace
      window.LectNoteApp.showToast('Notes generated successfully!', 'success');
      window.LectNoteEditor.setValue(data.markdown);
      await window.LectNoteApp.reloadCurrentLecture();

      // Close modal
      modal.classList.remove('active');
    } catch (err) {
      console.error(err);
      window.LectNoteApp.showToast(`Error: ${err.message}`, 'error');
    } finally {
      btnText.textContent = originalText;
      btnRunIngest.disabled = false;
    }
  }

  function openModal() {
    if (modal) {
      // Pre-fill course if available
      const { course } = window.LectNoteApp.getCurrentWorkspace();
      if (course && inputCourse) inputCourse.value = course;
      modal.classList.add('active');
    }
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
  }

  return {
    init,
    openModal,
    closeModal
  };
})();


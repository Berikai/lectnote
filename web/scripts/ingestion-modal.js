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
  const selectCourse = document.getElementById('ingest-course-select');
  const wrapNewCourse = document.getElementById('wrap-ingest-new-course');
  const inputNewCourse = document.getElementById('input-ingest-new-course');
  const selectLecture = document.getElementById('ingest-lecture-select');
  const wrapNewLecture = document.getElementById('wrap-ingest-new-lecture');
  const inputNewLectureTitle = document.getElementById('input-ingest-new-lecture-title');
  const inputNewLectureSlug = document.getElementById('input-ingest-new-lecture-slug');
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

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  function getNextLectureNumber(courseId, coursesData) {
    const course = (coursesData || []).find(c => c.id === courseId);
    if (!course || !course.lectures || course.lectures.length === 0) return 1;
    let maxNum = 0;
    course.lectures.forEach(l => {
      const m = l.id.match(/lecture-?(\d+)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return maxNum + 1;
  }

  function updateIngestSuggestedSlug() {
    if (!inputNewLectureTitle || !inputNewLectureSlug || !selectCourse) return;
    const coursesData = (window.LectNoteApp && window.LectNoteApp.getCourses()) || [];
    const courseId = selectCourse.value;
    const nextNum = courseId === '__new__' ? 1 : getNextLectureNumber(courseId, coursesData);
    const padNum = String(nextNum).padStart(2, '0');
    const title = inputNewLectureTitle.value.trim();

    if (title) {
      const cleanSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      inputNewLectureSlug.value = cleanSlug ? `lecture-${padNum}-${cleanSlug}` : `lecture-${padNum}`;
    } else {
      inputNewLectureSlug.value = `lecture-${padNum}`;
    }
  }

  function updateLectureDropdown(selectedLectureId = null) {
    if (!selectCourse || !selectLecture) return;
    const coursesData = (window.LectNoteApp && window.LectNoteApp.getCourses()) || [];
    const courseId = selectCourse.value;

    if (courseId === '__new__') {
      if (wrapNewCourse) wrapNewCourse.style.display = 'block';
      selectLecture.innerHTML = '<option value="__new__">+ Create New Lecture</option>';
      selectLecture.value = '__new__';
      if (wrapNewLecture) wrapNewLecture.style.display = 'flex';
      updateIngestSuggestedSlug();
      return;
    }

    if (wrapNewCourse) wrapNewCourse.style.display = 'none';
    const course = coursesData.find(c => c.id === courseId);
    const lectures = (course && course.lectures) || [];

    let lectureOptions = lectures.map(l => {
      const photoText = l.photoCount > 0 ? ` (${l.photoCount} photos)` : '';
      return `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title || l.id)}${photoText}</option>`;
    }).join('');

    lectureOptions += `<option value="__new__">+ Create New Lecture in this course...</option>`;
    selectLecture.innerHTML = lectureOptions;

    if (selectedLectureId && lectures.some(l => l.id === selectedLectureId)) {
      selectLecture.value = selectedLectureId;
      if (wrapNewLecture) wrapNewLecture.style.display = 'none';
    } else if (lectures.length > 0) {
      selectLecture.value = lectures[0].id;
      if (wrapNewLecture) wrapNewLecture.style.display = 'none';
    } else {
      selectLecture.value = '__new__';
      if (wrapNewLecture) wrapNewLecture.style.display = 'flex';
      updateIngestSuggestedSlug();
    }
  }

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

    // Cascading Course / Lecture Change Listeners
    if (selectCourse) {
      selectCourse.addEventListener('change', () => {
        updateLectureDropdown();
      });
    }

    if (selectLecture) {
      selectLecture.addEventListener('change', () => {
        if (selectLecture.value === '__new__') {
          if (wrapNewLecture) wrapNewLecture.style.display = 'flex';
          updateIngestSuggestedSlug();
          if (inputNewLectureTitle) inputNewLectureTitle.focus();
        } else {
          if (wrapNewLecture) wrapNewLecture.style.display = 'none';
        }
      });
    }

    if (inputNewLectureTitle) {
      inputNewLectureTitle.addEventListener('input', () => {
        updateIngestSuggestedSlug();
      });
    }

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
    const savedModel = localStorage.getItem(`lectnote_${selectedProvider}_model`) || (selectedProvider === 'gemini' ? localStorage.getItem('lectnote_ai_model') : '');
    inputModelName.value = savedModel || defaultModels[selectedProvider] || '';

    // Load saved API key for provider
    const savedKey = localStorage.getItem(`lectnote_${selectedProvider}_key`) || (selectedProvider === 'gemini' ? localStorage.getItem('lectnote_api_key') : '');
    inputApiKey.value = savedKey || '';

    // Load saved Base URL if applicable
    if (selectedProvider === 'openai') {
      inputBaseUrl.value = localStorage.getItem('lectnote_openai_baseurl') || localStorage.getItem('lectnote_ai_base_url') || 'http://localhost:11434/v1';
    }
  }

  function loadSavedSettings() {
    const lastProvider = localStorage.getItem('lectnote_provider') || localStorage.getItem('lectnote_ai_provider');
    if (lastProvider) {
      selectedProvider = lastProvider;
      providerCards.forEach(c => {
        c.classList.toggle('selected', c.dataset.provider === selectedProvider);
      });
    }
  }

  function saveSettings() {
    localStorage.setItem('lectnote_provider', selectedProvider);
    localStorage.setItem('lectnote_ai_provider', selectedProvider);
    if (inputApiKey.value) {
      const keyVal = inputApiKey.value.trim();
      localStorage.setItem(`lectnote_${selectedProvider}_key`, keyVal);
      if (selectedProvider === 'gemini') {
        localStorage.setItem('lectnote_api_key', keyVal);
        localStorage.setItem('lectnote_gemini_key', keyVal);
      }
    }
    if (inputModelName.value) {
      const modelVal = inputModelName.value.trim();
      localStorage.setItem(`lectnote_${selectedProvider}_model`, modelVal);
      if (selectedProvider === 'gemini') {
        localStorage.setItem('lectnote_ai_model', modelVal);
      }
    }
    if (selectedProvider === 'openai' && inputBaseUrl.value) {
      const urlVal = inputBaseUrl.value.trim();
      localStorage.setItem('lectnote_openai_baseurl', urlVal);
      localStorage.setItem('lectnote_ai_base_url', urlVal);
    }
    if (window.LectNoteSettings) {
      window.LectNoteSettings.updateAssistantStatusBadge();
    }
  }

  async function runIngestion() {
    if (!window.LectNoteApp) return;

    // 1. Resolve Target Course
    const isNewCourse = selectCourse && selectCourse.value === '__new__';
    let targetCourse = isNewCourse
      ? (inputNewCourse ? inputNewCourse.value.trim() : '')
      : (selectCourse ? selectCourse.value : '');

    if (!targetCourse) {
      window.LectNoteApp.showToast('Please select or enter a course name.', 'error');
      return;
    }

    // 2. Resolve Target Lecture
    const isNewLecture = isNewCourse || (selectLecture && selectLecture.value === '__new__');
    let targetLecture = '';
    let targetLectureTitle = '';

    if (isNewLecture) {
      targetLecture = inputNewLectureSlug ? inputNewLectureSlug.value.trim() : '';
      targetLectureTitle = (inputNewLectureTitle && inputNewLectureTitle.value.trim()) || targetLecture;
      if (!targetLecture) {
        window.LectNoteApp.showToast('Please enter a lecture identifier/slug.', 'error');
        return;
      }
    } else {
      targetLecture = selectLecture ? selectLecture.value : '';
      const selectedOption = selectLecture ? selectLecture.options[selectLecture.selectedIndex] : null;
      targetLectureTitle = selectedOption ? selectedOption.text.replace(/\s*\(\d+\s*photos\)$/i, '') : targetLecture;
    }

    if (!targetLecture) {
      window.LectNoteApp.showToast('Please select or create a lecture.', 'error');
      return;
    }

    saveSettings();

    const apiKey = inputApiKey.value.trim();
    const baseUrl = inputBaseUrl.value.trim();
    const model = inputModelName.value.trim();
    const subject = (inputSubject && inputSubject.value.trim()) || 'Engineering & Science';
    const customPrompt = inputCustomPrompt ? inputCustomPrompt.value.trim() : '';

    if (selectedProvider !== 'manual' && selectedProvider !== 'openai' && !apiKey) {
      window.LectNoteApp.showToast(`Please enter your ${selectedProvider.toUpperCase()} API key.`, 'error');
      return;
    }

    const btnText = btnRunIngest.querySelector('.btn-text');
    const originalText = btnText.textContent;
    btnText.innerHTML = `<span class="spinner"></span> Processing Lecture Photos...`;
    btnRunIngest.disabled = true;

    try {
      // Step A: If new lecture or course, ensure workspace is created on backend
      if (isNewLecture) {
        window.LectNoteApp.showToast(`Creating workspace for ${targetLecture}...`, 'info');
        const createRes = await fetch('/api/lectures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course: targetCourse,
            lecture: targetLecture,
            title: targetLectureTitle,
            subject: subject
          })
        });
        const createData = await createRes.json();
        if (!createRes.ok || !createData.success) {
          throw new Error(createData?.error || 'Failed to initialize new lecture workspace');
        }
        targetCourse = createData.course;
        targetLecture = createData.lecture;
      }

      // Step B: Upload staged photos if any
      if (stagedFiles.length > 0) {
        window.LectNoteApp.showToast(`Uploading ${stagedFiles.length} lecture whiteboard photo(s)...`, 'info');
        const formData = new FormData();
        stagedFiles.forEach(f => formData.append('photos', f));

        const upRes = await fetch(`/api/lectures/${encodeURIComponent(targetCourse)}/${encodeURIComponent(targetLecture)}/upload`, {
          method: 'POST',
          body: formData
        });

        const upText = await upRes.text();
        let upData;
        try {
          upData = JSON.parse(upText);
        } catch (e) {
          throw new Error(`Upload server error (${upRes.status}): ${upText.slice(0, 150)}`);
        }

        if (!upRes.ok || !upData.success) {
          throw new Error(upData?.error || `Photo upload failed (${upRes.status})`);
        }
        window.LectNoteApp.showToast(`Uploaded ${upData.uploaded?.length || stagedFiles.length} photo(s) successfully!`, 'success');
      }

      // Step C: Call AI Transcription endpoint
      window.LectNoteApp.showToast(`Synthesizing lecture notes with ${selectedProvider.toUpperCase()}...`, 'info');
      const res = await fetch(`/api/lectures/${encodeURIComponent(targetCourse)}/${encodeURIComponent(targetLecture)}/ai-transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey,
          baseUrl,
          model,
          course: targetCourse,
          subject,
          lectureTitle: targetLectureTitle.replace(/[-_]/g, ' '),
          customInstructions: customPrompt
        })
      });

      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Transcription server error (${res.status}): ${resText.slice(0, 150)}`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data?.error || 'AI transcription failed');
      }

      // Step D: Update Editor & Workspace
      window.LectNoteApp.showToast('Notes generated successfully!', 'success');
      await window.LectNoteApp.loadCourses(targetCourse, targetLecture);
      window.LectNoteEditor.setValue(data.markdown);

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
    if (!modal) return;
    const coursesData = (window.LectNoteApp && window.LectNoteApp.getCourses()) || [];
    const currentWs = (window.LectNoteApp && window.LectNoteApp.getCurrentWorkspace()) || {};

    if (selectCourse) {
      let courseOptions = coursesData.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`
      ).join('');
      courseOptions += `<option value="__new__">+ Create New Course...</option>`;
      selectCourse.innerHTML = courseOptions;

      if (currentWs.course && coursesData.some(c => c.id === currentWs.course)) {
        selectCourse.value = currentWs.course;
      } else if (coursesData.length > 0) {
        selectCourse.value = coursesData[0].id;
      } else {
        selectCourse.value = '__new__';
      }

      updateLectureDropdown(currentWs.lecture);
    }

    if (inputNewCourse) inputNewCourse.value = '';
    if (inputNewLectureTitle) inputNewLectureTitle.value = '';

    // Reset staged photos
    stagedFiles = [];
    if (stagedPhotosList) stagedPhotosList.innerHTML = '';
    if (fileInput) fileInput.value = '';

    modal.classList.add('active');
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


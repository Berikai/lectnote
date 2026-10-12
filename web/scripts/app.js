/**
 * LectNote: Main Application Controller
 * Coordinates workspace state, theme toggling, view segmentation, and PDF export.
 */

window.LectNoteApp = (function() {
  let coursesData = [];
  let currentCourse = '';
  let currentLecture = '';
  let currentTheme = localStorage.getItem('lectnote_theme') || 'notebook'; // 'notebook' or 'academic'
  let currentView = 'split'; // 'split', 'editor', 'preview'

  const courseSelect = document.getElementById('course-select');
  const lectureSelect = document.getElementById('lecture-select');
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  const themeStylesheet = document.getElementById('theme-stylesheet');
  const previewPaper = document.getElementById('preview-paper');
  const previewCourseTag = document.getElementById('preview-course-tag');
  const previewLectureTag = document.getElementById('preview-lecture-tag');
  const paneEditor = document.getElementById('pane-editor');
  const panePreview = document.getElementById('pane-preview');
  const btnSave = document.getElementById('btn-save');
  const btnExportPdf = document.getElementById('btn-export-pdf');
  const btnNewLecture = document.getElementById('btn-new-lecture');
  const btnOpenIngestion = document.getElementById('btn-open-ingestion');

  async function init() {
    // 1. Initialize submodules
    window.LectNoteEditor.init();
    window.LectNotePhotoDrawer.init();
    window.LectNoteIngestion.init();

    // 2. Setup theme
    applyTheme(currentTheme, false);

    // 3. Setup event listeners
    setupEventListeners();

    // 4. Fetch lectures
    await loadCourses();
  }

  function setupEventListeners() {
    // Course dropdown change
    courseSelect.addEventListener('change', () => {
      currentCourse = courseSelect.value;
      updateLectureDropdown();
      if (lectureSelect.options.length > 0) {
        currentLecture = lectureSelect.value;
        loadLecture(currentCourse, currentLecture);
      }
    });

    // Lecture dropdown change
    lectureSelect.addEventListener('change', () => {
      currentLecture = lectureSelect.value;
      loadLecture(currentCourse, currentLecture);
    });

    // Theme Toggle
    themeToggleBtn.addEventListener('click', () => {
      const nextTheme = currentTheme === 'notebook' ? 'academic' : 'notebook';
      applyTheme(nextTheme, true);
    });

    // View segmentation (Split / Editor / Preview)
    document.querySelectorAll('.view-segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-segmented-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyViewMode(btn.dataset.view);
      });
    });

    // Save button
    btnSave.addEventListener('click', saveCurrentLecture);

    // Print View button (instant browser print)
    const btnPrintView = document.getElementById('btn-print-view');
    if (btnPrintView) {
      btnPrintView.addEventListener('click', openPrintView);
    }

    // PDF Export button
    btnExportPdf.addEventListener('click', exportPdf);

    // Ingestion modal button
    btnOpenIngestion.addEventListener('click', () => {
      window.LectNoteIngestion.openModal();
    });

    // New Lecture modal handling
    btnNewLecture.addEventListener('click', openNewLectureModal);

    const selectNewCourse = document.getElementById('select-new-course');
    const wrapNewCourse = document.getElementById('wrap-new-course-input');
    const inputNewTitle = document.getElementById('input-new-title');

    if (selectNewCourse) {
      selectNewCourse.addEventListener('change', () => {
        if (selectNewCourse.value === '__new__') {
          wrapNewCourse.style.display = 'block';
          const inp = document.getElementById('input-new-course');
          if (inp) inp.focus();
        } else {
          wrapNewCourse.style.display = 'none';
        }
        updateSuggestedSlug();
      });
    }

    if (inputNewTitle) {
      inputNewTitle.addEventListener('input', () => {
        updateSuggestedSlug();
      });
    }

    // Create lecture confirm
    document.getElementById('btn-create-lecture').addEventListener('click', createNewLecture);

    // Modal close buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        if (modalId) {
          document.getElementById(modalId).classList.remove('active');
        }
      });
    });
  }

  function applyTheme(theme, reRender = true) {
    currentTheme = theme;
    localStorage.setItem('lectnote_theme', theme);

    const iconSlot = themeToggleBtn.querySelector('.theme-icon-slot');
    const labelText = themeToggleBtn.querySelector('.theme-label-text');

    if (theme === 'academic') {
      document.body.classList.remove('theme-notebook');
      document.body.classList.add('theme-academic');
      themeStylesheet.href = '/styles/theme-academic.css';
      previewPaper.className = 'academic-paper';
      if (labelText) labelText.textContent = 'Academic View';
      else themeToggleBtn.textContent = 'Academic View';
      if (iconSlot) {
        iconSlot.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
      }
    } else {
      document.body.classList.remove('theme-academic');
      document.body.classList.add('theme-notebook');
      themeStylesheet.href = '/styles/theme-notebook.css';
      previewPaper.className = 'notebook-paper';
      if (labelText) labelText.textContent = 'Ruled Notebook';
      else themeToggleBtn.textContent = 'Ruled Notebook';
      if (iconSlot) {
        iconSlot.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
      }
    }

    if (reRender && window.LectNotePreview) {
      window.LectNotePreview.updatePreview(
        window.LectNoteEditor.getValue(),
        currentCourse,
        currentLecture,
        true
      );
    }
  }

  function applyViewMode(mode) {
    currentView = mode;
    if (mode === 'editor') {
      paneEditor.style.display = 'flex';
      panePreview.style.display = 'none';
    } else if (mode === 'preview') {
      paneEditor.style.display = 'none';
      panePreview.style.display = 'flex';
    } else {
      paneEditor.style.display = 'flex';
      panePreview.style.display = 'flex';
    }
  }

  async function loadCourses(targetCourse = null, targetLecture = null) {
    try {
      const res = await fetch('/api/lectures');
      const data = await res.json();
      coursesData = data.courses || [];

      if (coursesData.length === 0) {
        // Create initial default sample lecture
        await createSampleCourse();
        return;
      }

      courseSelect.innerHTML = coursesData.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`).join('');

      const resolvedCourse = (targetCourse && coursesData.some(c => c.id === targetCourse))
        ? targetCourse
        : (currentCourse && coursesData.some(c => c.id === currentCourse))
        ? currentCourse
        : coursesData[0].id;

      currentCourse = resolvedCourse;
      courseSelect.value = currentCourse;
      updateLectureDropdown();

      const courseObj = coursesData.find(c => c.id === currentCourse);
      const resolvedLecture = (targetLecture && courseObj && courseObj.lectures && courseObj.lectures.some(l => l.id === targetLecture))
        ? targetLecture
        : (currentLecture && courseObj && courseObj.lectures && courseObj.lectures.some(l => l.id === currentLecture))
        ? currentLecture
        : (courseObj && courseObj.lectures && courseObj.lectures[0] ? courseObj.lectures[0].id : null);

      if (resolvedLecture) {
        currentLecture = resolvedLecture;
        lectureSelect.value = currentLecture;
        await loadLecture(currentCourse, currentLecture);
      }
    } catch (err) {
      showToast(`Failed to load courses: ${err.message}`, 'error');
    }
  }

  function updateLectureDropdown() {
    const course = coursesData.find(c => c.id === currentCourse);
    if (!course || !course.lectures || course.lectures.length === 0) {
      lectureSelect.innerHTML = '<option value="">No lectures yet</option>';
      return;
    }

    lectureSelect.innerHTML = course.lectures.map(l =>
      `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)}</option>`
    ).join('');
  }

  async function loadLecture(course, lecture) {
    if (!course || !lecture) return;
    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`);
      const data = await res.json();

      previewCourseTag.textContent = course.replace(/[-_]/g, ' ');
      previewLectureTag.textContent = lecture.replace(/[-_]/g, ' ');

      window.LectNoteEditor.setValue(data.markdown);
      window.LectNotePhotoDrawer.setPhotos(data.photos, course, lecture);

      window.LectNotePreview.updatePreview(data.markdown, course, lecture, true);
    } catch (err) {
      showToast(`Error loading lecture: ${err.message}`, 'error');
    }
  }

  async function reloadCurrentLecture() {
    await loadCourses();
    await loadLecture(currentCourse, currentLecture);
  }

  async function saveCurrentLecture() {
    if (!currentCourse || !currentLecture) return;
    const markdown = window.LectNoteEditor.getValue();

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown })
      });
      const data = await res.json();
      if (data.success) {
        window.LectNoteEditor.markSaved();
        showToast('Lecture saved successfully', 'success');
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  function openPrintView() {
    if (!currentCourse || !currentLecture) {
      showToast('Select a lecture first', 'error');
      return;
    }
    const renderUrl = `/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/render?theme=${currentTheme}`;
    const win = window.open(renderUrl, '_blank');
    if (win) {
      win.focus();
    } else {
      window.location.href = renderUrl;
    }
  }

  async function exportPdf() {
    if (!currentCourse || !currentLecture) {
      showToast('Select a lecture first', 'error');
      return;
    }

    // Auto-save before exporting
    await saveCurrentLecture();

    const originalHtml = btnExportPdf.innerHTML;
    btnExportPdf.innerHTML = `<span class="spinner"></span> <span>Exporting...</span>`;
    btnExportPdf.disabled = true;
    showToast('Rendering vector PDF via Headless Chrome...', 'info');

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/export-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: currentTheme })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(errJson.error || 'Headless Chrome export failed');
      }

      // Trigger browser download
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${currentCourse}_${currentLecture}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      showToast('PDF exported successfully!', 'success');
    } catch (err) {
      console.warn('Headless export error:', err);
      showToast(`${err.message}. Opening printable view instead!`, 'info');
      openPrintView();
    } finally {
      btnExportPdf.innerHTML = originalHtml;
      btnExportPdf.disabled = false;
    }
  }


  function getNextLectureNumber(courseId) {
    const course = coursesData.find(c => c.id === courseId);
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

  function updateSuggestedSlug() {
    const selectCourse = document.getElementById('select-new-course');
    const inputTitle = document.getElementById('input-new-title');
    const inputSlug = document.getElementById('input-new-lecture');
    if (!selectCourse || !inputTitle || !inputSlug) return;

    const courseId = selectCourse.value;
    const nextNum = courseId === '__new__' ? 1 : getNextLectureNumber(courseId);
    const padNum = String(nextNum).padStart(2, '0');
    const title = inputTitle.value.trim();

    if (title) {
      const cleanSlug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      inputSlug.value = cleanSlug ? `lecture-${padNum}-${cleanSlug}` : `lecture-${padNum}`;
    } else {
      inputSlug.value = `lecture-${padNum}`;
    }
  }

  function openNewLectureModal() {
    const modal = document.getElementById('modal-new-lecture');
    const selectCourse = document.getElementById('select-new-course');
    const wrapNewCourse = document.getElementById('wrap-new-course-input');
    const inputNewCourse = document.getElementById('input-new-course');
    const inputTitle = document.getElementById('input-new-title');

    if (!modal || !selectCourse) return;

    let options = coursesData.map(c => 
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`
    ).join('');
    options += `<option value="__new__">+ Create New Course...</option>`;
    selectCourse.innerHTML = options;

    if (currentCourse && coursesData.some(c => c.id === currentCourse)) {
      selectCourse.value = currentCourse;
      if (wrapNewCourse) wrapNewCourse.style.display = 'none';
    } else if (coursesData.length > 0) {
      selectCourse.value = coursesData[0].id;
      if (wrapNewCourse) wrapNewCourse.style.display = 'none';
    } else {
      selectCourse.value = '__new__';
      if (wrapNewCourse) wrapNewCourse.style.display = 'block';
    }

    if (inputNewCourse) inputNewCourse.value = '';
    if (inputTitle) inputTitle.value = '';

    updateSuggestedSlug();
    modal.classList.add('active');

    setTimeout(() => {
      if (selectCourse.value === '__new__' && inputNewCourse) {
        inputNewCourse.focus();
      } else if (inputTitle) {
        inputTitle.focus();
      }
    }, 80);
  }

  async function switchToLecture(courseId, lectureId) {
    currentCourse = courseId;
    courseSelect.value = courseId;
    updateLectureDropdown();
    currentLecture = lectureId;
    lectureSelect.value = lectureId;
    await loadLecture(currentCourse, currentLecture);
  }

  async function createNewLecture() {
    const selectCourse = document.getElementById('select-new-course');
    const isNewCourse = selectCourse && selectCourse.value === '__new__';
    const courseInput = isNewCourse 
      ? document.getElementById('input-new-course').value.trim()
      : (selectCourse ? selectCourse.value : '');
    const lectureInput = document.getElementById('input-new-lecture').value.trim();
    const titleInput = document.getElementById('input-new-title').value.trim();

    if (!courseInput) {
      showToast('Course name or selection is required', 'error');
      return;
    }
    if (!lectureInput) {
      showToast('Lecture identifier is required', 'error');
      return;
    }

    try {
      const res = await fetch('/api/lectures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: courseInput,
          lecture: lectureInput,
          title: titleInput || lectureInput
        })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('modal-new-lecture').classList.remove('active');
        showToast('Lecture created successfully', 'success');
        await loadCourses(data.course, data.lecture);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast(`Creation failed: ${err.message}`, 'error');
    }
  }

  async function createSampleCourse() {
    try {
      await fetch('/api/lectures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: 'MCE306-MaterialsScience',
          lecture: 'lecture-03-diffusion-fick',
          subject: 'Materials Science & Mechatronics',
          title: 'Diffusion in Solids & Fick\'s Laws'
        })
      });
      await loadCourses();
    } catch (e) {
      console.error(e);
    }
  }

  function onMarkdownChange(newMarkdown) {
    window.LectNotePreview.updatePreview(newMarkdown, currentCourse, currentLecture);
  }

  function getCurrentWorkspace() {
    return { course: currentCourse, lecture: currentLecture };
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconSvg = type === 'success'
      ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
      : type === 'error'
      ? `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      : `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

    toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // Auto-init on page load
  document.addEventListener('DOMContentLoaded', init);

  return {
    onMarkdownChange,
    saveCurrentLecture,
    reloadCurrentLecture,
    getCurrentWorkspace,
    getCourses: () => coursesData,
    switchToLecture,
    loadCourses,
    showToast
  };
})();


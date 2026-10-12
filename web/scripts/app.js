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

    // New Lecture button
    btnNewLecture.addEventListener('click', () => {
      document.getElementById('modal-new-lecture').classList.add('active');
    });

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

    if (theme === 'academic') {
      document.body.classList.remove('theme-notebook');
      document.body.classList.add('theme-academic');
      themeStylesheet.href = '/styles/theme-academic.css';
      previewPaper.className = 'academic-paper';
      themeToggleBtn.textContent = '🎓 Academic View';
    } else {
      document.body.classList.remove('theme-academic');
      document.body.classList.add('theme-notebook');
      themeStylesheet.href = '/styles/theme-notebook.css';
      previewPaper.className = 'notebook-paper';
      themeToggleBtn.textContent = '📓 Ruled Notebook';
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

  async function loadCourses() {
    try {
      const res = await fetch('/api/lectures');
      const data = await res.json();
      coursesData = data.courses || [];

      if (coursesData.length === 0) {
        // Create initial default sample lecture
        await createSampleCourse();
        return;
      }

      courseSelect.innerHTML = coursesData.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');

      // Select first course & lecture
      currentCourse = coursesData[0].id;
      courseSelect.value = currentCourse;
      updateLectureDropdown();

      if (coursesData[0].lectures && coursesData[0].lectures.length > 0) {
        currentLecture = coursesData[0].lectures[0].id;
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

    const originalText = btnExportPdf.textContent;
    btnExportPdf.innerHTML = `<span class="spinner"></span> Generating PDF...`;
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
      btnExportPdf.textContent = originalText;
      btnExportPdf.disabled = false;
    }
  }


  async function createNewLecture() {
    const courseInput = document.getElementById('input-new-course').value.trim();
    const lectureInput = document.getElementById('input-new-lecture').value.trim();
    const titleInput = document.getElementById('input-new-title').value.trim();

    if (!courseInput || !lectureInput) {
      showToast('Course and lecture identifier are required', 'error');
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
        await loadCourses();
        courseSelect.value = data.course;
        currentCourse = data.course;
        updateLectureDropdown();
        lectureSelect.value = data.lecture;
        currentLecture = data.lecture;
        await loadLecture(currentCourse, currentLecture);
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
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
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
    showToast
  };
})();


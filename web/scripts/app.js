/**
 * LectNote: Main Application Controller
 * Coordinates workspace state, theme toggling, view segmentation, and PDF export.
 */

window.LectNoteApp = (function() {
  let coursesData = [];
  let currentCourse = localStorage.getItem('lectnote_selected_course') || '';
  let currentLecture = localStorage.getItem('lectnote_selected_lecture') || '';
  let currentTheme = localStorage.getItem('lectnote_theme') || 'notebook'; // 'notebook' or 'academic'
  let currentColorMode = localStorage.getItem('lectnote_color_mode') || 'light'; // 'light' or 'dark'
  let currentView = 'split'; // 'split', 'editor', 'preview'

  const courseSelect = document.getElementById('course-select');
  const overflowCourseSelect = document.getElementById('overflow-course-select');
  const lectureSelect = document.getElementById('lecture-select');
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  const btnModeToggle = document.getElementById('btn-mode-toggle');
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
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const modalSettings = document.getElementById('modal-settings');
  const settingsLecturesPath = document.getElementById('settings-lectures-path');
  const btnCopyLecturesPath = document.getElementById('btn-copy-lectures-path');
  const btnChangeLecturesDir = document.getElementById('btn-change-lectures-dir');
  const btnRevealLecturesDir = document.getElementById('btn-reveal-lectures-dir');
  const btnResetLecturesDir = document.getElementById('btn-reset-lectures-dir');
  const settingsPlatformBadge = document.getElementById('settings-platform-badge');
  const settingsAppVersion = document.getElementById('settings-app-version');
  const revealBtnText = document.getElementById('reveal-btn-text');
  const editorTextarea = document.getElementById('markdown-input');
  const previewScrollContainer = document.querySelector('.preview-scroll-container');
  const studioSidebar = document.getElementById('studio-sidebar');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const sidebarSearchInput = document.getElementById('sidebar-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const sidebarBtnNewLecture = document.getElementById('sidebar-btn-new-lecture');
  const sidebarTree = document.getElementById('sidebar-tree');
  const sidebarSearchResults = document.getElementById('sidebar-search-results');

  const isElectron = !!(window.lectnoteDesktop && window.lectnoteDesktop.isElectron);

  let collapsedCourses = new Set(
    JSON.parse(localStorage.getItem('lectnote_collapsed_courses') || '[]')
  );
  let initialDesktopSettings = null;
  let searchDebounceTimer = null;
  let activeScrollSource = null;
  let scrollSyncTimeout = null;
  let saveScrollTimeout = null;

  async function init() {
    // 0. Setup desktop platform classes & query persistent settings
    if (isElectron) {
      document.body.classList.add('is-electron');
      const platform = window.lectnoteDesktop?.platform || 'darwin';
      document.body.classList.add(`platform-${platform}`);

      // Query initial desktop settings
      if (typeof window.lectnoteDesktop?.getSettings === 'function') {
        try {
          initialDesktopSettings = await window.lectnoteDesktop.getSettings();
          if (initialDesktopSettings) {
            if (initialDesktopSettings.theme) {
              currentTheme = initialDesktopSettings.theme;
            }
            if (initialDesktopSettings.colorMode) {
              currentColorMode = initialDesktopSettings.colorMode;
            }
            if (Array.isArray(initialDesktopSettings.collapsedCourses)) {
              collapsedCourses = new Set(initialDesktopSettings.collapsedCourses);
            }
          }
        } catch (_) {}
      }

      // Query initial fullscreen state
      if (typeof window.lectnoteDesktop?.isFullScreen === 'function') {
        try {
          const isFs = await window.lectnoteDesktop.isFullScreen();
          document.body.classList.toggle('is-fullscreen', !!isFs);
        } catch (_) {}
      }

      // Listen for native Electron window fullscreen state changes
      if (typeof window.lectnoteDesktop?.onFullScreenChange === 'function') {
        window.lectnoteDesktop.onFullScreenChange((isFs) => {
          document.body.classList.toggle('is-fullscreen', !!isFs);
        });
      }
    }

    // Standard CSS display-mode media query synchronization (works across Electron & browsers)
    if (window.matchMedia) {
      const fsQuery = window.matchMedia('(display-mode: fullscreen)');
      if (fsQuery.matches) {
        document.body.classList.add('is-fullscreen');
      }
      fsQuery.addEventListener('change', (e) => {
        document.body.classList.toggle('is-fullscreen', e.matches);
      });
    }

    // 1. Initialize submodules
    window.LectNoteEditor.init();
    window.LectNotePhotoDrawer.init();
    window.LectNoteIngestion.init();
    if (window.LectNoteAssistant) window.LectNoteAssistant.init();
    initSidebar();

    // 2. Setup theme & color mode
    applyTheme(currentTheme, false);
    applyColorMode(currentColorMode);

    // 3. Setup event listeners & scroll sync
    setupEventListeners();
    setupScrollSync();

    // 4. Fetch lectures
    await loadCourses();
  }

  function setupEventListeners() {
    // Course dropdown change
    courseSelect.addEventListener('change', async () => {
      saveScrollPosition(true);
      if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
        await saveCurrentLecture(true);
      }
      currentCourse = courseSelect.value;
      if (overflowCourseSelect) overflowCourseSelect.value = currentCourse;
      localStorage.setItem('lectnote_selected_course', currentCourse);
      updateLectureDropdown();
      if (lectureSelect.options.length > 0) {
        currentLecture = lectureSelect.value;
        localStorage.setItem('lectnote_selected_lecture', currentLecture);
        loadLecture(currentCourse, currentLecture);
      }
    });

    // Overflow menu Course dropdown change (mobile view)
    if (overflowCourseSelect) {
      overflowCourseSelect.addEventListener('change', async () => {
        saveScrollPosition(true);
        if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
          await saveCurrentLecture(true);
        }
        currentCourse = overflowCourseSelect.value;
        courseSelect.value = currentCourse;
        localStorage.setItem('lectnote_selected_course', currentCourse);
        updateLectureDropdown();
        if (lectureSelect.options.length > 0) {
          currentLecture = lectureSelect.value;
          localStorage.setItem('lectnote_selected_lecture', currentLecture);
          loadLecture(currentCourse, currentLecture);
        }
        const headerOverflowMenu = document.getElementById('header-overflow-menu');
        const btnHeaderMore = document.getElementById('btn-header-more');
        if (headerOverflowMenu) headerOverflowMenu.classList.remove('open');
        if (btnHeaderMore) btnHeaderMore.setAttribute('aria-expanded', 'false');
      });
    }

    // Lecture dropdown change
    lectureSelect.addEventListener('change', async () => {
      saveScrollPosition(true);
      if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
        await saveCurrentLecture(true);
      }
      currentLecture = lectureSelect.value;
      localStorage.setItem('lectnote_selected_lecture', currentLecture);
      loadLecture(currentCourse, currentLecture);
    });

    // Warn on window close / refresh if there are unsaved changes and flush pending scroll
    window.addEventListener('beforeunload', (e) => {
      saveScrollPosition(true);
      if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
        saveCurrentLecture(true);
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Support browser back/forward buttons
    window.addEventListener('popstate', async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const c = urlParams.get('course');
      const l = urlParams.get('lecture');
      if (c && l && (c !== currentCourse || l !== currentLecture)) {
        if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
          await saveCurrentLecture(true);
        }
        switchToLecture(c, l);
      }
    });

    // Theme Toggle (Notebook vs Academic)
    themeToggleBtn.addEventListener('click', () => {
      const nextTheme = currentTheme === 'notebook' ? 'academic' : 'notebook';
      applyTheme(nextTheme, true);
    });

    // Color Mode Toggle (Dark vs Light)
    if (btnModeToggle) {
      btnModeToggle.addEventListener('click', () => {
        const nextMode = currentColorMode === 'dark' ? 'light' : 'dark';
        applyColorMode(nextMode);
        showToast(`Switched to ${nextMode} mode`, 'info');
      });
    }

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

    // Settings modal triggers
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener('click', openSettingsModal);
    }
    if (btnCopyLecturesPath) {
      btnCopyLecturesPath.addEventListener('click', copyLecturesPath);
    }
    if (btnChangeLecturesDir) {
      btnChangeLecturesDir.addEventListener('click', changeLecturesDirectory);
    }
    if (btnRevealLecturesDir) {
      btnRevealLecturesDir.addEventListener('click', revealLecturesDirectory);
    }
    if (btnResetLecturesDir) {
      btnResetLecturesDir.addEventListener('click', resetLecturesDirectory);
    }

    // Global keyboard shortcut for settings: Cmd+, or Ctrl+,
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        openSettingsModal();
      }
    });

    // Native desktop menu integration
    if (isElectron && window.lectnoteDesktop && window.lectnoteDesktop.onMenuAction) {
      window.lectnoteDesktop.onMenuAction((action) => {
        if (action === 'open-settings') {
          openSettingsModal();
        } else if (action === 'new-lecture') {
          openNewLectureModal();
        } else if (action === 'save-notes') {
          saveCurrentLecture();
        } else if (action === 'export-pdf') {
          exportPdf();
        } else if (action === 'print-view') {
          openPrintView();
        }
      });
    }

    // Modal close buttons
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        if (modalId) {
          const m = document.getElementById(modalId);
          if (m) m.classList.remove('active');
        }
      });
    });

    // Close modals on overlay backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    // Rename modal submit on click and enter key
    const btnConfirmRename = document.getElementById('btn-confirm-rename');
    const inputRenameValue = document.getElementById('input-rename-value');
    if (btnConfirmRename) {
      btnConfirmRename.addEventListener('click', confirmRename);
    }
    if (inputRenameValue) {
      inputRenameValue.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmRename();
        } else if (e.key === 'Escape') {
          const modalRename = document.getElementById('modal-rename');
          if (modalRename) modalRename.classList.remove('active');
        }
      });
    }

    // Setup lecture & course management actions dropdown menu
    setupLectureActionsMenu();

    // Setup header overflow actions dropdown menu
    setupHeaderOverflowMenu();

    // Responsive view mode safeguard: If viewport is mobile, disable split mode
    window.addEventListener('resize', handleResponsiveLayout);
    handleResponsiveLayout();
  }

  function setupLectureActionsMenu() {
    const btnLectureMore = document.getElementById('btn-lecture-more');
    const lectureActionsMenu = document.getElementById('lecture-actions-menu');

    if (!btnLectureMore || !lectureActionsMenu) return;

    btnLectureMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = lectureActionsMenu.classList.toggle('open');
      btnLectureMore.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    lectureActionsMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        lectureActionsMenu.classList.remove('open');
        btnLectureMore.setAttribute('aria-expanded', 'false');

        const action = item.dataset.action;
        if (action === 'rename-lecture') {
          await renameCurrentLecture();
        } else if (action === 'delete-lecture') {
          await deleteCurrentLecture();
        } else if (action === 'rename-course') {
          await renameCurrentCourse();
        } else if (action === 'delete-course') {
          await deleteCurrentCourse();
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!lectureActionsMenu.contains(e.target) && e.target !== btnLectureMore && !btnLectureMore.contains(e.target)) {
        lectureActionsMenu.classList.remove('open');
        btnLectureMore.setAttribute('aria-expanded', 'false');
      }
    });
  }

  let pendingRenameType = null; // 'lecture' | 'course'

  function updateUrlParams(course, lecture) {
    if (!window.history || !window.history.replaceState) return;
    try {
      const url = new URL(window.location.href);
      if (course) url.searchParams.set('course', course);
      else url.searchParams.delete('course');
      if (lecture) url.searchParams.set('lecture', lecture);
      else url.searchParams.delete('lecture');
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
    } catch (_) {}
  }

  async function openRenameModal(type) {
    const modalRename = document.getElementById('modal-rename');
    const modalRenameTitle = document.getElementById('modal-rename-title');
    const modalRenameSubtitle = document.getElementById('modal-rename-subtitle');
    const labelRenameInput = document.getElementById('label-rename-input');
    const inputRenameValue = document.getElementById('input-rename-value');
    const renameModalError = document.getElementById('rename-modal-error');
    if (!modalRename || !inputRenameValue) return;

    if (type === 'lecture' && (!currentCourse || !currentLecture)) {
      showToast('Select a lecture first', 'error');
      return;
    }
    if (type === 'course' && !currentCourse) {
      showToast('Select a course first', 'error');
      return;
    }

    if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
      await saveCurrentLecture(true);
    }

    pendingRenameType = type;
    const isLecture = type === 'lecture';
    const currentVal = isLecture ? currentLecture : currentCourse;

    if (modalRenameTitle) modalRenameTitle.textContent = isLecture ? 'Rename Lecture' : 'Rename Course';
    if (modalRenameSubtitle) modalRenameSubtitle.textContent = `Rename "${currentVal}"`;
    if (labelRenameInput) labelRenameInput.textContent = isLecture ? 'Lecture Identifier / Name' : 'Course Code / Name';
    inputRenameValue.value = currentVal;
    if (renameModalError) {
      renameModalError.textContent = '';
      renameModalError.style.display = 'none';
    }

    modalRename.classList.add('active');
    setTimeout(() => {
      inputRenameValue.focus();
      inputRenameValue.select();
    }, 60);
  }

  async function confirmRename() {
    const modalRename = document.getElementById('modal-rename');
    const inputRenameValue = document.getElementById('input-rename-value');
    const renameModalError = document.getElementById('rename-modal-error');
    const btnConfirmRename = document.getElementById('btn-confirm-rename');

    if (!pendingRenameType || !inputRenameValue || !modalRename) return;
    const nextVal = inputRenameValue.value.trim();
    const isLecture = pendingRenameType === 'lecture';
    const currentVal = isLecture ? currentLecture : currentCourse;

    if (!nextVal) {
      if (renameModalError) {
        renameModalError.textContent = 'Name cannot be empty';
        renameModalError.style.display = 'block';
      }
      inputRenameValue.focus();
      return;
    }

    if (nextVal === currentVal) {
      modalRename.classList.remove('active');
      return;
    }

    if (btnConfirmRename) {
      btnConfirmRename.disabled = true;
      btnConfirmRename.textContent = 'Renaming...';
    }

    try {
      if (isLecture) {
        const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newLecture: nextVal })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          modalRename.classList.remove('active');
          showToast(`Lecture renamed to ${data.lecture}`, 'success');
          currentLecture = data.lecture;
          localStorage.setItem('lectnote_selected_lecture', data.lecture);
          updateUrlParams(currentCourse, data.lecture);
          if (isElectron && window.lectnoteDesktop?.saveSettings) {
            window.lectnoteDesktop.saveSettings({ lastLecture: data.lecture }).catch(() => {});
          }
          await loadCourses(data.course, data.lecture);
        } else {
          throw new Error(data.error || 'Failed to rename lecture');
        }
      } else {
        const res = await fetch(`/api/courses/${encodeURIComponent(currentCourse)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newCourse: nextVal })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          modalRename.classList.remove('active');
          showToast(`Course renamed to ${data.course}`, 'success');
          currentCourse = data.course;
          localStorage.setItem('lectnote_selected_course', data.course);
          updateUrlParams(data.course, currentLecture);
          if (isElectron && window.lectnoteDesktop?.saveSettings) {
            window.lectnoteDesktop.saveSettings({ lastCourse: data.course }).catch(() => {});
          }
          await loadCourses(data.course, currentLecture);
        } else {
          throw new Error(data.error || 'Failed to rename course');
        }
      }
    } catch (err) {
      if (renameModalError) {
        renameModalError.textContent = err.message || 'Rename failed';
        renameModalError.style.display = 'block';
      } else {
        showToast(`Rename failed: ${err.message}`, 'error');
      }
      inputRenameValue.focus();
    } finally {
      if (btnConfirmRename) {
        btnConfirmRename.disabled = false;
        btnConfirmRename.textContent = 'Rename';
      }
    }
  }

  function renameCurrentLecture() {
    return openRenameModal('lecture');
  }

  function renameCurrentCourse() {
    return openRenameModal('course');
  }

  async function deleteCurrentLecture() {
    if (!currentCourse || !currentLecture) {
      showToast('Select a lecture first', 'error');
      return;
    }
    if (!confirm(`Are you sure you want to delete lecture "${currentLecture}" and all its notes and photos? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Lecture "${currentLecture}" deleted`, 'info');
        currentLecture = '';
        localStorage.removeItem('lectnote_selected_lecture');
        updateUrlParams(currentCourse, '');
        if (isElectron && window.lectnoteDesktop?.saveSettings) {
          window.lectnoteDesktop.saveSettings({ lastLecture: '' }).catch(() => {});
        }
        await loadCourses(currentCourse);
      } else {
        throw new Error(data.error || 'Failed to delete lecture');
      }
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  async function deleteCurrentCourse() {
    if (!currentCourse) {
      showToast('Select a course first', 'error');
      return;
    }
    if (!confirm(`Are you sure you want to delete course "${currentCourse}" and ALL its lectures and photos? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(currentCourse)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Course "${currentCourse}" deleted`, 'info');
        currentCourse = '';
        currentLecture = '';
        localStorage.removeItem('lectnote_selected_course');
        localStorage.removeItem('lectnote_selected_lecture');
        updateUrlParams('', '');
        if (isElectron && window.lectnoteDesktop?.saveSettings) {
          window.lectnoteDesktop.saveSettings({ lastCourse: '', lastLecture: '' }).catch(() => {});
        }
        await loadCourses();
      } else {
        throw new Error(data.error || 'Failed to delete course');
      }
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  function setupHeaderOverflowMenu() {
    const btnHeaderMore = document.getElementById('btn-header-more');
    const headerOverflowMenu = document.getElementById('header-overflow-menu');

    if (!btnHeaderMore || !headerOverflowMenu) return;

    btnHeaderMore.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = headerOverflowMenu.classList.toggle('open');
      btnHeaderMore.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        updateOverflowLabels();
      }
    });

    headerOverflowMenu.querySelectorAll('.overflow-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        headerOverflowMenu.classList.remove('open');
        btnHeaderMore.setAttribute('aria-expanded', 'false');

        const action = item.dataset.action;
        if (action === 'tutor') {
          if (window.LectNoteAssistant) window.LectNoteAssistant.toggle();
        } else if (action === 'ingest') {
          if (window.LectNoteIngestion) window.LectNoteIngestion.openModal();
        } else if (action === 'photos') {
          if (window.LectNotePhotoDrawer) window.LectNotePhotoDrawer.toggleDrawer();
        } else if (action === 'save') {
          saveCurrentLecture();
        } else if (action === 'print') {
          openPrintView();
        } else if (action === 'export-pdf') {
          exportPdf();
        } else if (action === 'theme') {
          const nextTheme = currentTheme === 'notebook' ? 'academic' : 'notebook';
          applyTheme(nextTheme, true);
        } else if (action === 'mode') {
          const nextMode = currentColorMode === 'dark' ? 'light' : 'dark';
          applyColorMode(nextMode);
          showToast(`Switched to ${nextMode} mode`, 'info');
        } else if (action === 'rename-lecture') {
          renameCurrentLecture();
        } else if (action === 'delete-lecture') {
          deleteCurrentLecture();
        } else if (action === 'rename-course') {
          renameCurrentCourse();
        } else if (action === 'delete-course') {
          deleteCurrentCourse();
        } else if (action === 'settings') {
          openSettingsModal();
        }
      });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!headerOverflowMenu.contains(e.target) && e.target !== btnHeaderMore && !btnHeaderMore.contains(e.target)) {
        headerOverflowMenu.classList.remove('open');
        btnHeaderMore.setAttribute('aria-expanded', 'false');
      }
    });

    // Close menu when Esc is pressed
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && headerOverflowMenu.classList.contains('open')) {
        headerOverflowMenu.classList.remove('open');
        btnHeaderMore.setAttribute('aria-expanded', 'false');
        btnHeaderMore.focus();
      }
    });
  }

  function updateOverflowLabels() {
    if (overflowCourseSelect && currentCourse) {
      overflowCourseSelect.value = currentCourse;
    }
    const overflowThemeLabel = document.getElementById('overflow-theme-label');
    const overflowModeLabel = document.getElementById('overflow-mode-label');
    if (overflowThemeLabel) {
      overflowThemeLabel.textContent = currentTheme === 'notebook' ? 'Switch to Academic View' : 'Switch to Ruled Notebook';
    }
    if (overflowModeLabel) {
      overflowModeLabel.textContent = currentColorMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  function handleResponsiveLayout() {
    // If screen is mobile-sized (<= 640px) and view is currently 'split', auto-switch to 'preview'
    if (window.innerWidth <= 640 && currentView === 'split') {
      applyViewMode('preview');
      document.querySelectorAll('.view-segmented-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'preview');
      });
    }
  }

  function applyTheme(theme, reRender = true) {
    currentTheme = theme;
    localStorage.setItem('lectnote_theme', theme);
    if (isElectron && window.lectnoteDesktop?.saveSettings) {
      window.lectnoteDesktop.saveSettings({ theme }).catch(() => {});
    }

    const iconSlot = themeToggleBtn.querySelector('.theme-icon-slot');
    const labelText = themeToggleBtn.querySelector('.theme-label-text');

    if (theme === 'academic') {
      document.body.classList.remove('theme-notebook');
      document.body.classList.add('theme-academic');
      themeStylesheet.href = '/styles/theme-academic.css';
      previewPaper.className = 'academic-paper';
      if (labelText) labelText.textContent = 'Academic';
      else themeToggleBtn.textContent = 'Academic';
      if (iconSlot) {
        iconSlot.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
      }
    } else {
      document.body.classList.remove('theme-academic');
      document.body.classList.add('theme-notebook');
      themeStylesheet.href = '/styles/theme-notebook.css';
      previewPaper.className = 'notebook-paper';
      if (labelText) labelText.textContent = 'Notebook';
      else themeToggleBtn.textContent = 'Notebook';
      if (iconSlot) {
        iconSlot.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
      }
    }

    updateOverflowLabels();

    if (reRender && window.LectNotePreview) {
      window.LectNotePreview.updatePreview(
        window.LectNoteEditor.getValue(),
        currentCourse,
        currentLecture,
        true
      );
    }
  }

  function applyColorMode(mode) {
    currentColorMode = mode;
    localStorage.setItem('lectnote_color_mode', mode);
    if (isElectron && window.lectnoteDesktop?.saveSettings) {
      window.lectnoteDesktop.saveSettings({ colorMode: mode }).catch(() => {});
    }
    if (mode === 'dark') {
      document.body.classList.add('mode-dark');
      if (btnModeToggle) btnModeToggle.title = 'Switch to Light Mode';
    } else {
      document.body.classList.remove('mode-dark');
      if (btnModeToggle) btnModeToggle.title = 'Switch to Dark Mode';
    }
    const hlStylesheet = document.getElementById('highlight-stylesheet');
    if (hlStylesheet) {
      hlStylesheet.href = mode === 'dark' ? '/vendor/highlight-github-dark.min.css' : '/vendor/highlight-github.min.css';
    }
    updateOverflowLabels();

    if (isElectron && window.lectnoteDesktop && window.lectnoteDesktop.updateTitleBarTheme) {
      window.lectnoteDesktop.updateTitleBarTheme(mode);
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
      // When entering split view, scroll preview to current editing section
      if (editorTextarea && window.LectNotePreview && typeof window.LectNotePreview.scrollToLine === 'function') {
        const selStart = editorTextarea.selectionStart || 0;
        const lineIdx = editorTextarea.value.substring(0, selStart).split('\n').length - 1;
        window.LectNotePreview.scrollToLine(lineIdx, false);
      }
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
      if (overflowCourseSelect) {
        overflowCourseSelect.innerHTML = coursesData.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`).join('');
      }

      const urlParams = new URLSearchParams(window.location.search);
      const paramCourse = urlParams.get('course');
      const paramLecture = urlParams.get('lecture');

      const savedCourse = paramCourse
        || localStorage.getItem('lectnote_selected_course')
        || (initialDesktopSettings && initialDesktopSettings.lastCourse)
        || currentCourse;
      const savedLecture = paramLecture
        || localStorage.getItem('lectnote_selected_lecture')
        || (initialDesktopSettings && initialDesktopSettings.lastLecture)
        || currentLecture;

      const resolvedCourse = (targetCourse && coursesData.some(c => c.id === targetCourse))
        ? targetCourse
        : (savedCourse && coursesData.some(c => c.id === savedCourse))
        ? savedCourse
        : coursesData[0].id;

      currentCourse = resolvedCourse;
      courseSelect.value = currentCourse;
      if (overflowCourseSelect) overflowCourseSelect.value = currentCourse;
      updateLectureDropdown();
      renderSidebarTree();

      const courseObj = coursesData.find(c => c.id === currentCourse);
      const resolvedLecture = (targetLecture && courseObj && courseObj.lectures && courseObj.lectures.some(l => l.id === targetLecture))
        ? targetLecture
        : (savedLecture && courseObj && courseObj.lectures && courseObj.lectures.some(l => l.id === savedLecture))
        ? savedLecture
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

  async function loadLecture(course, lecture, skipRestoreScroll = false) {
    if (!course || !lecture) return;
    try {
      localStorage.setItem('lectnote_selected_course', course);
      localStorage.setItem('lectnote_selected_lecture', lecture);

      if (isElectron && window.lectnoteDesktop?.saveSettings) {
        window.lectnoteDesktop.saveSettings({
          lastCourse: course,
          lastLecture: lecture
        }).catch(() => {});
      }

      if (window.history && window.history.replaceState) {
        const url = new URL(window.location);
        if (url.searchParams.get('course') !== course || url.searchParams.get('lecture') !== lecture) {
          url.searchParams.set('course', course);
          url.searchParams.set('lecture', lecture);
          window.history.replaceState({}, '', url);
        }
      }

      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`);
      if (!res.ok) {
        throw new Error(`Failed to load lecture (${res.status})`);
      }
      const data = await res.json();

      previewCourseTag.textContent = course.replace(/[-_]/g, ' ');
      previewLectureTag.textContent = lecture.replace(/[-_]/g, ' ');

      window.LectNoteEditor.setValue(data.markdown);
      window.LectNotePhotoDrawer.setPhotos(data.photos, course, lecture);
      if (window.LectNoteAssistant) {
        window.LectNoteAssistant.setWorkspace(course, lecture);
      }

      await window.LectNotePreview.updatePreview(data.markdown, course, lecture, true);

      // Restore saved scroll position for this lecture unless skipped (e.g. search click)
      if (!skipRestoreScroll) {
        restoreScrollPosition(course, lecture);
      }
      updateSidebarActiveItem(course, lecture);
    } catch (err) {
      showToast(`Error loading lecture: ${err.message}`, 'error');
    }
  }

  function setupScrollSync() {
    if (!editorTextarea || !previewScrollContainer) return;

    // Independent scroll position tracking for editor (no sync to preview)
    editorTextarea.addEventListener('scroll', () => {
      if (activeScrollSource === 'restoring') return;
      saveScrollPosition();
    }, { passive: true });

    // Independent scroll position tracking for preview (no sync to editor)
    previewScrollContainer.addEventListener('scroll', () => {
      if (activeScrollSource === 'restoring') return;
      saveScrollPosition();
    }, { passive: true });
  }

  function saveScrollPosition(immediate = false) {
    if (!currentCourse || !currentLecture || activeScrollSource === 'restoring') return;
    clearTimeout(saveScrollTimeout);

    const doSave = () => {
      try {
        const payloadObj = {
          editorTop: editorTextarea ? editorTextarea.scrollTop : 0,
          previewTop: previewScrollContainer ? previewScrollContainer.scrollTop : 0
        };
        const payload = JSON.stringify(payloadObj);
        localStorage.setItem(`lectnote_scroll_${currentCourse}_${currentLecture}`, payload);

        if (isElectron && window.lectnoteDesktop?.saveSettings) {
          window.lectnoteDesktop.saveSettings({
            lastScroll: {
              course: currentCourse,
              lecture: currentLecture,
              ...payloadObj
            }
          }).catch(() => {});
        }
      } catch (e) {}
    };

    if (immediate) {
      doSave();
    } else {
      saveScrollTimeout = setTimeout(doSave, 150);
    }
  }

  function restoreScrollPosition(course, lecture) {
    if (!editorTextarea || !previewScrollContainer || !course || !lecture) return;
    const key = `lectnote_scroll_${course}_${lecture}`;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(key));
    } catch (e) {}

    // Fall back to initial desktop settings if available for this lecture
    if (!saved && initialDesktopSettings?.lastScroll) {
      const ls = initialDesktopSettings.lastScroll;
      if (ls.course === course && ls.lecture === lecture) {
        saved = ls;
      }
    }

    if (!saved) {
      editorTextarea.scrollTop = 0;
      previewScrollContainer.scrollTop = 0;
      return;
    }

    activeScrollSource = 'restoring';

    const apply = () => {
      if (!editorTextarea || !previewScrollContainer) return;
      if (saved.editorTop !== undefined) editorTextarea.scrollTop = saved.editorTop;
      if (saved.previewTop !== undefined) previewScrollContainer.scrollTop = saved.previewTop;
    };

    apply();
    setTimeout(apply, 80);
    setTimeout(apply, 200);
    setTimeout(() => {
      apply();
      activeScrollSource = null;
    }, 450);
  }

  async function reloadCurrentLecture() {
    await loadCourses();
    await loadLecture(currentCourse, currentLecture);
  }

  async function saveCurrentLecture(isAutoSave = false) {
    if (!currentCourse || !currentLecture) return;
    const markdown = window.LectNoteEditor.getValue();

    if (isAutoSave && window.LectNoteEditor && typeof window.LectNoteEditor.markSaving === 'function') {
      window.LectNoteEditor.markSaving();
    }

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown })
      });
      const data = await res.json();
      if (data.success) {
        window.LectNoteEditor.markSaved();
        if (!isAutoSave) {
          showToast('Lecture saved successfully', 'success');
        }
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      if (!isAutoSave) {
        showToast(`Save failed: ${err.message}`, 'error');
      } else {
        console.warn('Auto-save error:', err);
      }
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
    await saveCurrentLecture(true);

    const originalHtml = btnExportPdf.innerHTML;
    btnExportPdf.innerHTML = `<span class="spinner"></span> <span>Exporting...</span>`;
    btnExportPdf.disabled = true;

    if (isElectron && window.lectnoteDesktop && window.lectnoteDesktop.exportPdf) {
      showToast('Rendering vector PDF via native engine...', 'info');
      try {
        const result = await window.lectnoteDesktop.exportPdf(currentCourse, currentLecture, currentTheme);
        if (result.success && result.filePath) {
          showToast(`PDF exported: ${result.filePath}`, 'success');
        } else if (result.canceled) {
          showToast('PDF export canceled', 'info');
        } else {
          throw new Error(result.error || 'Native export failed');
        }
      } catch (err) {
        console.warn('Native export error:', err);
        showToast(`${err.message}. Opening printable view instead!`, 'info');
        openPrintView();
      } finally {
        btnExportPdf.innerHTML = originalHtml;
        btnExportPdf.disabled = false;
      }
      return;
    }

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

  async function switchToLecture(courseId, lectureId, skipRestoreScroll = false) {
    saveScrollPosition(true);
    if (window.LectNoteEditor && window.LectNoteEditor.isDirty()) {
      await saveCurrentLecture(true);
    }
    currentCourse = courseId;
    courseSelect.value = courseId;
    updateLectureDropdown();
    currentLecture = lectureId;
    lectureSelect.value = lectureId;
    await loadLecture(currentCourse, currentLecture, skipRestoreScroll);
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

  async function openSettingsModal(targetTab = 'storage') {
    if (window.LectNoteSettings) {
      window.LectNoteSettings.open(targetTab);
      return;
    }
    if (!modalSettings) return;
    modalSettings.classList.add('active');
    await refreshSettingsView();
  }

  async function refreshSettingsView() {
    try {
      let lecturesDir = '';
      let platform = 'web';
      let appVersion = '1.0.0';

      if (isElectron) {
        const data = await window.lectnoteDesktop.getSettings();
        lecturesDir = data.lecturesDir || '';
        platform = data.platform || 'desktop';
        appVersion = data.appVersion || '1.0.0';
      } else {
        const res = await fetch('/api/settings');
        const data = await res.json();
        lecturesDir = data.lecturesDir || '';
      }

      if (settingsLecturesPath) {
        settingsLecturesPath.value = lecturesDir;
      }

      if (revealBtnText) {
        if (platform === 'darwin') revealBtnText.textContent = 'Reveal in Finder';
        else if (platform === 'win32') revealBtnText.textContent = 'Reveal in Explorer';
        else revealBtnText.textContent = 'Open in File Manager';
      }

      if (settingsAppVersion) {
        settingsAppVersion.textContent = isElectron 
          ? `LectNote Desktop v${appVersion} (${platform})`
          : `LectNote Web Studio v${appVersion}`;
      }

      if (settingsPlatformBadge) {
        if (isElectron) {
          settingsPlatformBadge.className = 'settings-info-banner banner-desktop';
          settingsPlatformBadge.innerHTML = `
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <div>
              <strong>Desktop Storage Active</strong>: You can change the lectures directory anytime. All courses and notes reload dynamically without restarting.
            </div>
          `;
          if (btnChangeLecturesDir) btnChangeLecturesDir.style.display = 'inline-flex';
          if (btnRevealLecturesDir) btnRevealLecturesDir.style.display = 'inline-flex';
          if (btnResetLecturesDir) btnResetLecturesDir.style.display = 'inline-flex';
        } else {
          settingsPlatformBadge.className = 'settings-info-banner banner-web';
          settingsPlatformBadge.innerHTML = `
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div>
              <strong>Web Studio Mode</strong>: Storage directory is configured by the server (via <code>LECTURES_DIR</code> environment variable). Launch LectNote Desktop for native OS directory selection.
            </div>
          `;
          if (btnRevealLecturesDir) btnRevealLecturesDir.style.display = 'none';
          if (btnChangeLecturesDir) btnChangeLecturesDir.style.display = 'none';
          if (btnResetLecturesDir) btnResetLecturesDir.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  function copyLecturesPath() {
    if (!settingsLecturesPath || !settingsLecturesPath.value) return;
    const pathVal = settingsLecturesPath.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pathVal).then(() => {
        showToast('Path copied to clipboard', 'info');
      }).catch(() => {
        settingsLecturesPath.select();
        document.execCommand('copy');
        showToast('Path copied to clipboard', 'info');
      });
    } else {
      settingsLecturesPath.select();
      document.execCommand('copy');
      showToast('Path copied to clipboard', 'info');
    }
  }

  async function changeLecturesDirectory() {
    if (!isElectron) {
      showToast('Directory selection is only available in Desktop mode', 'info');
      return;
    }
    try {
      const result = await window.lectnoteDesktop.selectLecturesDirectory();
      if (result.success && result.lecturesDir) {
        settingsLecturesPath.value = result.lecturesDir;
        showToast(`Lectures directory updated: ${result.lecturesDir}`, 'success');
        await loadCourses();
        if (lectureSelect.options.length > 0) {
          currentLecture = lectureSelect.value;
          loadLecture(currentCourse, currentLecture);
        }
      }
    } catch (err) {
      showToast(`Failed to change directory: ${err.message}`, 'error');
    }
  }

  async function revealLecturesDirectory() {
    if (!isElectron) return;
    try {
      const pathVal = settingsLecturesPath ? settingsLecturesPath.value : '';
      await window.lectnoteDesktop.openLecturesDirectory(pathVal);
    } catch (err) {
      showToast(`Cannot open folder: ${err.message}`, 'error');
    }
  }

  async function resetLecturesDirectory() {
    if (!isElectron) return;
    try {
      const result = await window.lectnoteDesktop.resetLecturesDirectory();
      if (result.success && result.lecturesDir) {
        settingsLecturesPath.value = result.lecturesDir;
        showToast(`Reset to default directory: ${result.lecturesDir}`, 'info');
        await loadCourses();
        if (lectureSelect.options.length > 0) {
          currentLecture = lectureSelect.value;
          loadLecture(currentCourse, currentLecture);
        }
      }
    } catch (err) {
      showToast(`Failed to reset directory: ${err.message}`, 'error');
    }
  }

  function onMarkdownChange(newMarkdown, editInfo = null) {
    window.LectNotePreview.updatePreview(newMarkdown, currentCourse, currentLecture, false, editInfo);
  }

  function getCurrentWorkspace() {
    return { course: currentCourse, lecture: currentLecture };
  }

  function initSidebar() {
    if (!studioSidebar) return;

    // Restore sidebar collapse state (collapsed by default)
    const isSidebarCollapsed = (initialDesktopSettings && initialDesktopSettings.sidebarCollapsed !== undefined)
      ? initialDesktopSettings.sidebarCollapsed
      : (localStorage.getItem('lectnote_sidebar_collapsed') !== 'false');
    if (isSidebarCollapsed) {
      studioSidebar.classList.add('collapsed');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
    } else {
      studioSidebar.classList.remove('collapsed');
      if (btnToggleSidebar) btnToggleSidebar.classList.add('active');
    }

    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', () => toggleSidebar());
    }

    if (sidebarBtnNewLecture) {
      sidebarBtnNewLecture.addEventListener('click', openNewLectureModal);
    }

    if (sidebarSearchInput) {
      sidebarSearchInput.addEventListener('input', handleSidebarSearch);
      sidebarSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          clearSearch();
          sidebarSearchInput.blur();
        }
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        clearSearch();
        if (sidebarSearchInput) sidebarSearchInput.focus();
      });
    }

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Cmd+B / Ctrl+B: Toggle Sidebar
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggleSidebar();
      }
      // Cmd+K / Ctrl+K: Focus Search
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (studioSidebar && studioSidebar.classList.contains('collapsed')) {
          toggleSidebar(true);
        }
        if (sidebarSearchInput) {
          sidebarSearchInput.focus();
          sidebarSearchInput.select();
        }
      }
    });
  }

  function toggleSidebar(forceOpen = null) {
    if (!studioSidebar) return;
    const shouldOpen = forceOpen !== null ? forceOpen : studioSidebar.classList.contains('collapsed');
    if (shouldOpen) {
      studioSidebar.classList.remove('collapsed');
      localStorage.setItem('lectnote_sidebar_collapsed', 'false');
      if (btnToggleSidebar) btnToggleSidebar.classList.add('active');
      if (isElectron && window.lectnoteDesktop?.saveSettings) {
        window.lectnoteDesktop.saveSettings({ sidebarCollapsed: false }).catch(() => {});
      }
    } else {
      studioSidebar.classList.add('collapsed');
      localStorage.setItem('lectnote_sidebar_collapsed', 'true');
      if (btnToggleSidebar) btnToggleSidebar.classList.remove('active');
      if (isElectron && window.lectnoteDesktop?.saveSettings) {
        window.lectnoteDesktop.saveSettings({ sidebarCollapsed: true }).catch(() => {});
      }
    }
  }

  function clearSearch() {
    if (sidebarSearchInput) sidebarSearchInput.value = '';
    if (btnClearSearch) btnClearSearch.style.display = 'none';
    if (sidebarSearchResults) {
      sidebarSearchResults.style.display = 'none';
      sidebarSearchResults.innerHTML = '';
    }
    if (sidebarTree) sidebarTree.style.display = 'block';
    if (window.LectNotePreview && typeof window.LectNotePreview.clearSearchHighlights === 'function') {
      window.LectNotePreview.clearSearchHighlights();
    }
  }

  function handleSidebarSearch() {
    clearTimeout(searchDebounceTimer);
    const query = sidebarSearchInput ? sidebarSearchInput.value.trim() : '';

    if (!query) {
      clearSearch();
      return;
    }

    if (btnClearSearch) btnClearSearch.style.display = 'block';
    if (sidebarTree) sidebarTree.style.display = 'none';
    if (sidebarSearchResults) sidebarSearchResults.style.display = 'block';

    searchDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        renderSearchResults(data.results || [], query);
      } catch (err) {
        if (sidebarSearchResults) {
          sidebarSearchResults.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:11.5px;">Search error</div>`;
        }
      }
    }, 180);
  }

  function renderSearchResults(results, query) {
    if (!sidebarSearchResults) return;
    if (results.length === 0) {
      sidebarSearchResults.innerHTML = `
        <div style="padding: 20px 12px; text-align: center; color: var(--text-dim); font-size: 11.5px;">
          No matching lectures found for "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
      return;
    }

    sidebarSearchResults.innerHTML = results.map(r => `
      <div class="sidebar-search-result-item" data-course="${escapeHtml(r.course)}" data-lecture="${escapeHtml(r.lecture)}" data-line="${r.lineNumber !== undefined && r.lineNumber !== null ? r.lineNumber : ''}" data-match-idx="${r.matchIdx !== undefined && r.matchIdx !== null ? r.matchIdx : ''}">
        <div class="sidebar-search-result-header">
          <span class="sidebar-search-result-title">${highlightQuery(r.lectureDisplay || r.lecture, query)}</span>
          <span class="sidebar-search-result-course">${escapeHtml(r.courseDisplay || r.course)}</span>
        </div>
        <div class="sidebar-search-result-snippet">${highlightQuery(r.snippet, query)}</div>
      </div>
    `).join('');

    sidebarSearchResults.querySelectorAll('.sidebar-search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        const c = item.dataset.course;
        const l = item.dataset.lecture;
        const lineNum = item.dataset.line !== '' ? parseInt(item.dataset.line, 10) : null;
        const matchIdx = item.dataset.matchIdx !== '' ? parseInt(item.dataset.matchIdx, 10) : null;

        if (c && l) {
          sidebarSearchResults.querySelectorAll('.sidebar-search-result-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');

          const isSameLecture = (currentCourse === c && currentLecture === l);
          if (!isSameLecture) {
            await switchToLecture(c, l, true /* skipRestoreScroll */);
          }
          highlightAndScrollFinding({ query, lineNum, matchIdx });
        }
      });
    });
  }

  function highlightAndScrollFinding({ query, lineNum, matchIdx }) {
    if (window.LectNotePreview && typeof window.LectNotePreview.highlightAndScrollSearch === 'function') {
      window.LectNotePreview.highlightAndScrollSearch({ query, lineNum, matchIdx });
    }
    if (window.LectNoteEditor && typeof window.LectNoteEditor.highlightAndScrollSearch === 'function') {
      window.LectNoteEditor.highlightAndScrollSearch({ query, lineNum, matchIdx });
    }
  }

  function highlightQuery(text, query) {
    if (!text) return '';
    if (!query) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<mark style="background:var(--highlight-color, #fef08a); color:inherit; border-radius:2px; padding:0 2px;">$1</mark>');
  }

  function renderSidebarTree() {
    if (!sidebarTree) return;
    if (!coursesData || coursesData.length === 0) {
      sidebarTree.innerHTML = `
        <div style="padding: 16px 10px; text-align: center; color: var(--text-dim); font-size: 11.5px;">
          No courses found
        </div>
      `;
      return;
    }

    sidebarTree.innerHTML = coursesData.map(course => {
      const isCollapsed = collapsedCourses.has(course.id);
      const lectureCount = (course.lectures || []).length;
      return `
        <div class="sidebar-course-group ${isCollapsed ? 'collapsed' : ''}" data-course-id="${escapeHtml(course.id)}">
          <div class="sidebar-course-header" title="${escapeHtml(course.name || course.id)}">
            <svg class="sidebar-course-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            <svg class="ui-icon" style="width:13px;height:13px;color:var(--text-dim);flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="sidebar-course-name">${escapeHtml(course.name || course.id)}</span>
            <span class="sidebar-course-count">${lectureCount}</span>
          </div>
          <div class="sidebar-lectures-list">
            ${(course.lectures || []).map(lec => {
              const isActive = (course.id === currentCourse && lec.id === currentLecture);
              const photoCount = (lec.photos || []).length;
              return `
                <div class="sidebar-lecture-item ${isActive ? 'active' : ''}" data-course="${escapeHtml(course.id)}" data-lecture="${escapeHtml(lec.id)}" title="${escapeHtml(lec.title || lec.id)}">
                  <svg class="ui-icon" style="width:12px;height:12px;flex-shrink:0;opacity:0.7;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  <span class="sidebar-lecture-title">${escapeHtml(lec.title || lec.id)}</span>
                  ${photoCount > 0 ? `<span class="sidebar-lecture-photos-badge" title="${photoCount} whiteboard photo${photoCount > 1 ? 's' : ''}">${photoCount}📷</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Attach click events for course headers (expand/collapse)
    sidebarTree.querySelectorAll('.sidebar-course-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.sidebar-course-group');
        if (!group) return;
        const courseId = group.dataset.courseId;
        group.classList.toggle('collapsed');
        if (group.classList.contains('collapsed')) {
          collapsedCourses.add(courseId);
        } else {
          collapsedCourses.delete(courseId);
        }
        localStorage.setItem('lectnote_collapsed_courses', JSON.stringify(Array.from(collapsedCourses)));
        if (isElectron && window.lectnoteDesktop?.saveSettings) {
          window.lectnoteDesktop.saveSettings({ collapsedCourses: Array.from(collapsedCourses) }).catch(() => {});
        }
      });
    });

    // Attach click events for lecture items
    sidebarTree.querySelectorAll('.sidebar-lecture-item').forEach(item => {
      item.addEventListener('click', async () => {
        const c = item.dataset.course;
        const l = item.dataset.lecture;
        if (c === currentCourse && l === currentLecture) return;
        await switchToLecture(c, l);
      });
    });
  }

  function updateSidebarActiveItem(courseId, lectureId) {
    if (!sidebarTree) return;
    sidebarTree.querySelectorAll('.sidebar-lecture-item').forEach(item => {
      if (item.dataset.course === courseId && item.dataset.lecture === lectureId) {
        item.classList.add('active');
        const group = item.closest('.sidebar-course-group');
        if (group && group.classList.contains('collapsed')) {
          group.classList.remove('collapsed');
          collapsedCourses.delete(courseId);
          localStorage.setItem('lectnote_collapsed_courses', JSON.stringify(Array.from(collapsedCourses)));
          if (isElectron && window.lectnoteDesktop?.saveSettings) {
            window.lectnoteDesktop.saveSettings({ collapsedCourses: Array.from(collapsedCourses) }).catch(() => {});
          }
        }
      } else {
        item.classList.remove('active');
      }
    });
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
    openSettings: openSettingsModal,
    showToast
  };
})();


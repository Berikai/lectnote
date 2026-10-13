/**
 * LectNote: Whiteboard Photo Drawer & Lightbox Controller
 * Provides high-res photo inspection, zoom/pan, and uploads.
 */

window.LectNotePhotoDrawer = (function() {
  const drawer = document.getElementById('photo-drawer');
  const drawerContent = document.getElementById('photo-drawer-content');
  const countBadge = document.getElementById('photo-count-badge');
  const drawerCount = document.getElementById('drawer-photo-count');
  const fileInput = document.getElementById('drawer-file-input');

  // Lightbox elements
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxViewport = document.getElementById('lightbox-viewport');

  let currentPhotos = [];
  let currentLightboxPhoto = '';
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  function init() {
    // Drawer toggle buttons
    const btnToggle = document.getElementById('btn-toggle-drawer');
    const btnClose = document.getElementById('btn-close-drawer');

    if (btnToggle) {
      btnToggle.addEventListener('click', toggleDrawer);
    }
    if (btnClose) {
      btnClose.addEventListener('click', closeDrawer);
    }

    // Drawer file upload
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          await uploadPhotos(e.target.files);
        }
      });
    }

    // Lightbox controls
    document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-zoom-in').addEventListener('click', () => setZoom(zoomLevel + 0.3));
    document.getElementById('lightbox-zoom-out').addEventListener('click', () => setZoom(Math.max(0.4, zoomLevel - 0.3)));
    document.getElementById('lightbox-zoom-reset').addEventListener('click', () => resetTransform());

    const btnLightboxDelete = document.getElementById('lightbox-delete');
    if (btnLightboxDelete) {
      btnLightboxDelete.addEventListener('click', () => {
        if (currentLightboxPhoto) {
          deletePhoto(currentLightboxPhoto);
        }
      });
    }

    // Lightbox mouse drag pan
    if (lightboxViewport) {
      lightboxViewport.addEventListener('mousedown', (e) => {
        if (e.target === lightboxImg || e.target === lightboxViewport) {
          isDragging = true;
          startX = e.clientX - panX;
          startY = e.clientY - panY;
          lightboxViewport.style.cursor = 'grabbing';
        }
      });

      window.addEventListener('mousemove', (e) => {
        if (isDragging) {
          panX = e.clientX - startX;
          panY = e.clientY - startY;
          applyTransform();
        }
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          if (lightboxViewport) lightboxViewport.style.cursor = 'grab';
        }
      });

      // Wheel zoom
      lightboxViewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        setZoom(Math.max(0.3, Math.min(5, zoomLevel + delta)));
      });
    }

    // ESC closes lightbox and drawer
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (lightboxModal && lightboxModal.classList.contains('active')) {
          closeLightbox();
        } else if (drawer && drawer.classList.contains('open')) {
          closeDrawer();
        }
      }
    });
  }

  function toggleDrawer() {
    if (drawer) drawer.classList.toggle('open');
  }

  function openDrawer() {
    if (drawer) drawer.classList.add('open');
  }

  function closeDrawer() {
    if (drawer) drawer.classList.remove('open');
  }

  function setPhotos(photos, course, lecture) {
    currentPhotos = photos || [];
    const count = currentPhotos.length;
    if (countBadge) countBadge.textContent = count;
    const overflowBadge = document.getElementById('overflow-photo-count-badge');
    if (overflowBadge) overflowBadge.textContent = count;
    if (drawerCount) drawerCount.textContent = count;

    if (!drawerContent) return;

    if (count === 0) {
      drawerContent.innerHTML = `
        <div class="photo-empty-state">
          <svg class="photo-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <p style="font-weight:600;color:var(--text-primary);">No whiteboard photos yet</p>
          <p style="font-size:11.5px;max-width:240px;line-height:1.4;">Click <strong>Upload</strong> above to stage photos for AI transcription and inline notes.</p>
        </div>
      `;
      return;
    }

    const photoBaseUrl = `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/`;

    drawerContent.innerHTML = currentPhotos.map(photo => {
      const url = `${photoBaseUrl}${encodeURIComponent(photo)}`;
      return `
        <div class="photo-card" data-photo="${escapeHtml(photo)}">
          <img src="${url}" alt="${escapeHtml(photo)}" loading="lazy" />
          <div class="photo-card-info">
            <span style="font-family:var(--font-mono);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px;">${escapeHtml(photo)}</span>
            <div style="display:flex;gap:3px;margin-left:auto;">
              <button class="btn btn-ghost btn-icon-only btn-copy-ref" data-photo="${escapeHtml(photo)}" title="Copy board reference tag">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon-only btn-delete-photo" data-photo="${escapeHtml(photo)}" title="Delete photo" style="color:#ef4444;">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind card click to open Lightbox
    drawerContent.querySelectorAll('.photo-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-copy-ref') || e.target.closest('.btn-delete-photo')) return;
        const photo = card.dataset.photo;
        openLightbox(photo);
      });
    });

    // Bind copy reference button
    drawerContent.querySelectorAll('.btn-copy-ref').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const photo = btn.dataset.photo;
        const snippet = `:::board-ref [${photo}] "Whiteboard Reference: ${photo}" :::\n`;
        navigator.clipboard.writeText(snippet);
        if (window.LectNoteApp) {
          window.LectNoteApp.showToast(`Copied reference tag for ${photo}`, 'success');
        }
      });
    });

    // Bind delete photo button
    drawerContent.querySelectorAll('.btn-delete-photo').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const photo = btn.dataset.photo;
        deletePhoto(photo);
      });
    });
  }

  async function deletePhoto(photoName) {
    if (!window.LectNoteApp) return;
    const { course, lecture } = window.LectNoteApp.getCurrentWorkspace();
    if (!course || !lecture || !photoName) return;

    if (!confirm(`Are you sure you want to delete "${photoName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/${encodeURIComponent(photoName)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        window.LectNoteApp.showToast(`Deleted ${photoName}`, 'info');
        if (lightboxModal && lightboxModal.classList.contains('active')) {
          closeLightbox();
        }
        await window.LectNoteApp.reloadCurrentLecture();
      } else {
        throw new Error(data.error || 'Failed to delete photo');
      }
    } catch (err) {
      window.LectNoteApp.showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  async function uploadPhotos(fileList) {
    if (!window.LectNoteApp) return;
    const { course, lecture } = window.LectNoteApp.getCurrentWorkspace();
    if (!course || !lecture) {
      window.LectNoteApp.showToast('Select or create a lecture first', 'error');
      return;
    }

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('photos', fileList[i]);
    }

    try {
      window.LectNoteApp.showToast('Uploading whiteboard photos...', 'info');
      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/upload`, {
        method: 'POST',
        body: formData
      });
      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Upload server error (${res.status}): ${resText.slice(0, 150)}`);
      }
      if (res.ok && data.success) {
        window.LectNoteApp.showToast(`Uploaded ${data.uploaded.length} photo(s)`, 'success');
        await window.LectNoteApp.reloadCurrentLecture();
        openDrawer();
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      window.LectNoteApp.showToast(`Upload failed: ${err.message}`, 'error');
    }
  }

  function openLightbox(photoName) {
    if (!lightboxModal || !window.LectNoteApp) return;
    currentLightboxPhoto = photoName;
    const { course, lecture } = window.LectNoteApp.getCurrentWorkspace();
    const url = `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/${encodeURIComponent(photoName)}`;

    lightboxTitle.textContent = `Whiteboard Ref: ${photoName}`;
    lightboxImg.src = url;
    resetTransform();
    lightboxModal.classList.add('active');
  }

  function closeLightbox() {
    if (lightboxModal) {
      lightboxModal.classList.remove('active');
    }
  }

  function setZoom(newZoom) {
    zoomLevel = newZoom;
    applyTransform();
  }

  function resetTransform() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }

  function applyTransform() {
    if (lightboxImg) {
      lightboxImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  return {
    init,
    toggleDrawer,
    openDrawer,
    closeDrawer,
    setPhotos,
    uploadPhotos,
    openLightbox
  };
})();


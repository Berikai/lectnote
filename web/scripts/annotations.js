/**
 * LectNote: Annotations Engine
 * Handles floating sticky notes and freehand SVG drawing overlays directly on top of notes.
 * Automatically synchronizes with preview zoom, pan, themes, and vector PDF exports.
 */

window.LectNoteAnnotations = (function() {
  let currentCourse = '';
  let currentLecture = '';
  let activeTool = 'select'; // 'select' | 'pen' | 'highlighter' | 'eraser'
  let currentColor = '#e11d48'; // Red default
  let currentPenSize = 2.5;
  let currentHighlighterSize = 18;
  let currentStickyColor = 'yellow'; // 'yellow' | 'blue' | 'green' | 'pink' | 'purple'
  let isVisible = true;
  let autoSaveTimer = null;
  let initialized = false;

  // Stored annotation model
  let annotations = {
    version: 1,
    stickies: [],
    drawings: []
  };

  // Undo / Redo history
  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 40;

  // Drawing state
  let isDrawing = false;
  let currentStroke = null;
  let currentStrokePoints = [];

  // Dragging / Resizing Sticky state
  let activeDragSticky = null;
  let activeResizeSticky = null;

  // DOM Elements
  let annotationsLayer = null;
  let svgCanvas = null;
  let strokesGroup = null;
  let activeStrokePath = null;
  let stickiesContainer = null;
  let toolbarEl = null;

  function init() {
    if (initialized) return;
    initialized = true;

    // Grab or setup DOM elements
    annotationsLayer = document.getElementById('preview-annotations-layer');
    svgCanvas = document.getElementById('drawing-svg-canvas');
    stickiesContainer = document.getElementById('sticky-notes-container');
    toolbarEl = document.getElementById('preview-annotations-toolbar');

    if (svgCanvas) {
      strokesGroup = svgCanvas.querySelector('#drawing-strokes-group');
      if (!strokesGroup) {
        strokesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        strokesGroup.id = 'drawing-strokes-group';
        svgCanvas.appendChild(strokesGroup);
      }

      activeStrokePath = svgCanvas.querySelector('#drawing-active-stroke');
      if (!activeStrokePath) {
        activeStrokePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        activeStrokePath.id = 'drawing-active-stroke';
        activeStrokePath.className.baseVal = 'drawing-active-stroke';
        svgCanvas.appendChild(activeStrokePath);
      }

      setupDrawingEvents();
    }

    setupToolbarEvents();
    setupKeyboardShortcuts();
    updateToolUI();
  }

  function getPaperCoordinates(e) {
    const paper = document.getElementById('preview-paper');
    if (!paper) return { x: 0, y: 0 };
    const rect = paper.getBoundingClientRect();
    const zoom = (window.LectNotePreview && typeof window.LectNotePreview.getZoom === 'function')
      ? window.LectNotePreview.getZoom()
      : (parseFloat(paper.style.zoom) || 1);

    const x = Math.round(((e.clientX - rect.left) / zoom) * 10) / 10;
    const y = Math.round(((e.clientY - rect.top) / zoom) * 10) / 10;
    return { x, y, zoom };
  }

  function pointsToSvgPath(points) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) {
      return `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)} L ${(points[0][0] + 0.4).toFixed(1)} ${(points[0][1] + 0.4).toFixed(1)}`;
    }
    let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const xc = ((points[i][0] + points[i + 1][0]) / 2).toFixed(1);
      const yc = ((points[i][1] + points[i + 1][1]) / 2).toFixed(1);
      d += ` Q ${points[i][0].toFixed(1)} ${points[i][1].toFixed(1)} ${xc} ${yc}`;
    }
    d += ` L ${points[points.length - 1][0].toFixed(1)} ${points[points.length - 1][1].toFixed(1)}`;
    return d;
  }

  function distToSegmentSquared(p, v, w) {
    const l2 = (v[0] - w[0]) ** 2 + (v[1] - w[1]) ** 2;
    if (l2 === 0) return (p[0] - v[0]) ** 2 + (p[1] - v[1]) ** 2;
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return (p[0] - (v[0] + t * (w[0] - v[0]))) ** 2 + (p[1] - (v[1] + t * (w[1] - v[1]))) ** 2;
  }

  function distToSegment(p, v, w) {
    return Math.sqrt(distToSegmentSquared(p, v, w));
  }

  // Check if a point hits any segment of a stroke
  function strokeHitTest(stroke, px, py, threshold) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return false;
    const pts = stroke.points;
    if (pts.length === 1) {
      return Math.hypot(pts[0][0] - px, pts[0][1] - py) <= threshold;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegment([px, py], pts[i], pts[i + 1]) <= threshold) {
        return true;
      }
    }
    return false;
  }

  // ==========================================================================
  // Drawing Engine
  // ==========================================================================
  function setupDrawingEvents() {
    if (!svgCanvas) return;

    svgCanvas.addEventListener('pointerdown', (e) => {
      if (!isVisible) return;
      if (activeTool === 'select') return;
      if (e.button !== 0) return; // Only primary button

      const { x, y } = getPaperCoordinates(e);

      if (activeTool === 'eraser') {
        eraseAt(x, y);
        isDrawing = true;
        try { svgCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      if (activeTool === 'pen' || activeTool === 'highlighter') {
        isDrawing = true;
        try { svgCanvas.setPointerCapture(e.pointerId); } catch (_) {}

        const isHighlighter = activeTool === 'highlighter';
        const strokeSize = isHighlighter ? currentHighlighterSize : currentPenSize;
        const opacity = isHighlighter ? 0.45 : 1.0;

        currentStrokePoints = [[x, y]];
        currentStroke = {
          id: 'stroke_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          tool: activeTool,
          color: currentColor,
          size: strokeSize,
          opacity: opacity,
          points: currentStrokePoints,
          path: `M ${x} ${y}`
        };

        if (activeStrokePath) {
          activeStrokePath.setAttribute('d', currentStroke.path);
          activeStrokePath.setAttribute('stroke', currentStroke.color);
          activeStrokePath.setAttribute('stroke-width', currentStroke.size);
          activeStrokePath.setAttribute('opacity', currentStroke.opacity);
          activeStrokePath.setAttribute('stroke-linecap', 'round');
          activeStrokePath.setAttribute('stroke-linejoin', 'round');
          activeStrokePath.setAttribute('fill', 'none');
          if (isHighlighter) {
            activeStrokePath.style.mixBlendMode = 'multiply';
          } else {
            activeStrokePath.style.mixBlendMode = 'normal';
          }
          activeStrokePath.style.display = 'block';
        }
      }
    });

    svgCanvas.addEventListener('pointermove', (e) => {
      if (!isDrawing) return;

      const { x, y } = getPaperCoordinates(e);

      if (activeTool === 'eraser') {
        eraseAt(x, y);
        return;
      }

      if (currentStroke && currentStrokePoints.length > 0) {
        const last = currentStrokePoints[currentStrokePoints.length - 1];
        if (Math.hypot(x - last[0], y - last[1]) > 2) {
          currentStrokePoints.push([x, y]);
          const d = pointsToSvgPath(currentStrokePoints);
          currentStroke.path = d;
          if (activeStrokePath) {
            activeStrokePath.setAttribute('d', d);
          }
        }
      }
    });

    const finishDrawing = (e) => {
      if (!isDrawing) return;
      isDrawing = false;

      if (activeTool === 'eraser') {
        return;
      }

      if (activeStrokePath) {
        activeStrokePath.style.display = 'none';
        activeStrokePath.setAttribute('d', '');
      }

      if (currentStroke && currentStrokePoints.length > 0) {
        currentStroke.path = pointsToSvgPath(currentStrokePoints);
        annotations.drawings.push(currentStroke);
        pushHistory({
          type: 'add_drawing',
          stroke: currentStroke
        });
        renderDrawings();
        saveAnnotations();
      }

      currentStroke = null;
      currentStrokePoints = [];
    };

    svgCanvas.addEventListener('pointerup', finishDrawing);
    svgCanvas.addEventListener('pointercancel', finishDrawing);
  }

  function eraseAt(x, y) {
    const threshold = 14;
    let hitIndex = -1;

    for (let i = annotations.drawings.length - 1; i >= 0; i--) {
      const stroke = annotations.drawings[i];
      const strokeRadius = (stroke.size || 2.5) / 2;
      if (strokeHitTest(stroke, x, y, threshold + strokeRadius)) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== -1) {
      const removed = annotations.drawings.splice(hitIndex, 1)[0];
      pushHistory({
        type: 'delete_drawing',
        stroke: removed,
        index: hitIndex
      });
      renderDrawings();
      saveAnnotations();
    }
  }

  function renderDrawings() {
    if (!strokesGroup) return;
    strokesGroup.innerHTML = '';

    annotations.drawings.forEach(stroke => {
      if (!stroke.path) return;
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', stroke.path);
      pathEl.setAttribute('stroke', stroke.color || '#e11d48');
      pathEl.setAttribute('stroke-width', stroke.size || 2.5);
      pathEl.setAttribute('opacity', stroke.opacity !== undefined ? stroke.opacity : 1.0);
      pathEl.setAttribute('stroke-linecap', 'round');
      pathEl.setAttribute('stroke-linejoin', 'round');
      pathEl.setAttribute('fill', 'none');
      pathEl.setAttribute('data-stroke-id', stroke.id);

      if (stroke.tool === 'highlighter') {
        pathEl.style.mixBlendMode = 'multiply';
      }

      strokesGroup.appendChild(pathEl);
    });
  }

  // ==========================================================================
  // Sticky Notes Component
  // ==========================================================================
  function createStickyElement(sticky) {
    const el = document.createElement('div');
    el.className = `floating-sticky-note sticky-color-${sticky.color || 'yellow'}`;
    el.setAttribute('data-sticky-id', sticky.id);
    el.style.left = `${sticky.x || 100}px`;
    el.style.top = `${sticky.y || 100}px`;
    el.style.width = `${sticky.width || 210}px`;
    el.style.minHeight = `${sticky.height || 160}px`;
    if (sticky.zIndex) el.style.zIndex = sticky.zIndex;

    if (sticky.collapsed) {
      el.classList.add('is-collapsed');
    }

    // Sticky Note Header
    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'sticky-header-left';

    // Color Swatch Button / Pin
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'sticky-pin-btn';
    pinBtn.title = 'Change color';
    pinBtn.innerHTML = '📌';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('is-collapsed')) {
        toggleStickyCollapse(sticky.id);
        return;
      }
      cycleStickyColor(sticky.id, el);
    });

    const titleSpan = document.createElement('span');
    titleSpan.className = 'sticky-note-title';
    titleSpan.textContent = 'Note';

    headerLeft.appendChild(pinBtn);
    headerLeft.appendChild(titleSpan);

    const headerRight = document.createElement('div');
    headerRight.className = 'sticky-header-right';

    // Minimize / Collapse button (user requested: collapsible into compact pin badge)
    const btnCollapse = document.createElement('button');
    btnCollapse.type = 'button';
    btnCollapse.className = 'sticky-btn-collapse';
    btnCollapse.title = sticky.collapsed ? 'Expand note' : 'Collapse into pin';
    btnCollapse.innerHTML = sticky.collapsed ? '＋' : '—';
    btnCollapse.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStickyCollapse(sticky.id);
    });

    // Delete button
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'sticky-btn-delete';
    btnDelete.title = 'Delete note';
    btnDelete.innerHTML = '&times;';
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStickyNote(sticky.id);
    });

    headerRight.appendChild(btnCollapse);
    headerRight.appendChild(btnDelete);

    header.appendChild(headerLeft);
    header.appendChild(headerRight);

    // Sticky Content (Editable Textarea)
    const body = document.createElement('div');
    body.className = 'sticky-note-body';

    const textarea = document.createElement('textarea');
    textarea.className = 'sticky-note-textarea';
    textarea.placeholder = 'Type a note...';
    textarea.value = sticky.text || '';
    textarea.spellcheck = false;

    textarea.addEventListener('input', () => {
      sticky.text = textarea.value;
      saveAnnotations();
    });

    body.appendChild(textarea);

    // Resize Handle (bottom-right)
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'sticky-resize-handle';
    resizeHandle.title = 'Drag to resize';

    el.appendChild(header);
    el.appendChild(body);
    el.appendChild(resizeHandle);

    // Drag handling via pointer capture on header
    setupStickyDrag(header, el, sticky);

    // Resize handling on handle
    setupStickyResize(resizeHandle, el, sticky);

    // If collapsed, clicking anywhere expands it
    el.addEventListener('click', (e) => {
      if (el.classList.contains('is-collapsed') && !e.target.closest('.sticky-btn-delete')) {
        toggleStickyCollapse(sticky.id);
      }
    });

    return el;
  }

  function setupStickyDrag(handle, el, sticky) {
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let isDragging = false;
    let hasMoved = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      if (e.button !== 0) return;

      const coords = getPaperCoordinates(e);
      startX = coords.x;
      startY = coords.y;
      initialX = sticky.x || 100;
      initialY = sticky.y || 100;
      isDragging = true;
      hasMoved = false;

      // Bring to front
      const maxZ = annotations.stickies.reduce((max, s) => Math.max(max, s.zIndex || 10), 10) + 1;
      sticky.zIndex = maxZ;
      el.style.zIndex = maxZ;

      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const coords = getPaperCoordinates(e);
      const dx = coords.x - startX;
      const dy = coords.y - startY;

      if (!hasMoved) {
        if (Math.hypot(dx, dy) < 4) return;
        hasMoved = true;
      }

      const newX = Math.max(10, Math.round(initialX + dx));
      const newY = Math.max(10, Math.round(initialY + dy));

      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
      sticky.x = newX;
      sticky.y = newY;
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (!hasMoved && el.classList.contains('is-collapsed')) {
        toggleStickyCollapse(sticky.id);
      } else if (hasMoved) {
        saveAnnotations();
      }
    };

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
  }

  function setupStickyResize(handle, el, sticky) {
    let startX = 0;
    let startY = 0;
    let initialW = 0;
    let initialH = 0;
    let isResizing = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const coords = getPaperCoordinates(e);
      startX = coords.x;
      startY = coords.y;
      initialW = el.offsetWidth;
      initialH = el.offsetHeight;
      isResizing = true;

      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      const coords = getPaperCoordinates(e);
      const dw = coords.x - startX;
      const dh = coords.y - startY;

      const newW = Math.max(140, Math.min(650, Math.round(initialW + dw)));
      const newH = Math.max(110, Math.min(650, Math.round(initialH + dh)));

      el.style.width = `${newW}px`;
      el.style.minHeight = `${newH}px`;
      sticky.width = newW;
      sticky.height = newH;
    });

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      saveAnnotations();
    };

    handle.addEventListener('pointerup', stopResize);
    handle.addEventListener('pointercancel', stopResize);
  }

  function cycleStickyColor(stickyId, el) {
    const sticky = annotations.stickies.find(s => s.id === stickyId);
    if (!sticky) return;
    const colors = ['yellow', 'blue', 'green', 'pink', 'purple'];
    const idx = colors.indexOf(sticky.color || 'yellow');
    const nextColor = colors[(idx + 1) % colors.length];

    el.classList.remove(`sticky-color-${sticky.color}`);
    sticky.color = nextColor;
    el.classList.add(`sticky-color-${nextColor}`);
    saveAnnotations();
  }

  function toggleStickyCollapse(stickyId) {
    const sticky = annotations.stickies.find(s => s.id === stickyId);
    if (!sticky || !stickiesContainer) return;

    sticky.collapsed = !sticky.collapsed;
    const el = stickiesContainer.querySelector(`[data-sticky-id="${stickyId}"]`);
    if (el) {
      el.classList.toggle('is-collapsed', sticky.collapsed);
      const btnCollapse = el.querySelector('.sticky-btn-collapse');
      if (btnCollapse) {
        btnCollapse.innerHTML = sticky.collapsed ? '＋' : '—';
        btnCollapse.title = sticky.collapsed ? 'Expand note' : 'Collapse into pin';
      }
    }
    saveAnnotations();
  }

  function addStickyNote(customOptions = {}) {
    const scrollContainer = document.querySelector('.preview-scroll-container');
    const paper = document.getElementById('preview-paper');

    const zoom = (window.LectNotePreview && typeof window.LectNotePreview.getZoom === 'function')
      ? window.LectNotePreview.getZoom()
      : 1;

    // Center in current view
    let defaultX = 220;
    let defaultY = 180;

    if (scrollContainer && paper) {
      const scrollY = scrollContainer.scrollTop / zoom;
      defaultY = Math.max(60, Math.round(scrollY + 120));
      defaultX = Math.max(40, Math.min(500, Math.round((paper.clientWidth - 230) / 2)));
    }

    const newSticky = {
      id: 'sticky_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      x: customOptions.x !== undefined ? customOptions.x : defaultX,
      y: customOptions.y !== undefined ? customOptions.y : defaultY,
      width: customOptions.width || 210,
      height: customOptions.height || 160,
      color: customOptions.color || currentStickyColor,
      text: customOptions.text || '',
      collapsed: false,
      zIndex: (annotations.stickies.length + 10)
    };

    annotations.stickies.push(newSticky);
    pushHistory({
      type: 'add_sticky',
      sticky: newSticky
    });

    renderStickies();
    saveAnnotations();

    // Focus the newly added sticky textarea
    setTimeout(() => {
      if (stickiesContainer) {
        const el = stickiesContainer.querySelector(`[data-sticky-id="${newSticky.id}"] textarea`);
        if (el) el.focus();
      }
    }, 50);

    return newSticky;
  }

  function deleteStickyNote(stickyId) {
    const idx = annotations.stickies.findIndex(s => s.id === stickyId);
    if (idx === -1) return;

    const removed = annotations.stickies.splice(idx, 1)[0];
    pushHistory({
      type: 'delete_sticky',
      sticky: removed,
      index: idx
    });

    renderStickies();
    saveAnnotations();
  }

  function renderStickies() {
    if (!stickiesContainer) return;
    stickiesContainer.innerHTML = '';

    annotations.stickies.forEach(sticky => {
      const el = createStickyElement(sticky);
      stickiesContainer.appendChild(el);
    });
  }

  // ==========================================================================
  // Toolbar & User Interactions
  // ==========================================================================
  function setupToolbarEvents() {
    if (!toolbarEl) return;

    // Tool selection buttons
    toolbarEl.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tool = btn.getAttribute('data-tool');
        setActiveTool(tool);
      });
    });

    // Add sticky note button
    const btnSticky = toolbarEl.querySelector('#btn-tool-sticky');
    if (btnSticky) {
      btnSticky.addEventListener('click', (e) => {
        e.preventDefault();
        addStickyNote();
      });
    }

    // Color Swatches
    toolbarEl.querySelectorAll('.anno-color-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const color = btn.getAttribute('data-color');
        setColor(color);
      });
    });

    // Stroke Size cycle button
    const btnSize = toolbarEl.querySelector('#btn-anno-size');
    if (btnSize) {
      btnSize.addEventListener('click', (e) => {
        e.preventDefault();
        cycleStrokeSize();
      });
    }

    // Undo / Redo
    const btnUndo = toolbarEl.querySelector('#btn-anno-undo');
    const btnRedo = toolbarEl.querySelector('#btn-anno-redo');
    if (btnUndo) btnUndo.addEventListener('click', () => undo());
    if (btnRedo) btnRedo.addEventListener('click', () => redo());

    // Visibility toggle
    const btnVis = toolbarEl.querySelector('#btn-anno-visibility');
    if (btnVis) {
      btnVis.addEventListener('click', () => toggleVisibility());
    }

    // Clear all
    const btnClear = toolbarEl.querySelector('#btn-anno-clear');
    if (btnClear) {
      btnClear.addEventListener('click', () => clearAll());
    }
  }

  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when user is typing in any text box or input
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'textarea' || tag === 'input') return;

      // Undo: Cmd/Ctrl + Z
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl + Shift + Z or Ctrl + Y
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y'))) {
        e.preventDefault();
        redo();
        return;
      }

      // Single-letter tools (only if no modifier key)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setActiveTool('select');
        } else if (e.key === 'p' || e.key === 'P') {
          setActiveTool('pen');
        } else if (e.key === 'h' || e.key === 'H') {
          setActiveTool('highlighter');
        } else if (e.key === 'e' || e.key === 'E') {
          setActiveTool('eraser');
        } else if (e.key === 'n' || e.key === 'N') {
          addStickyNote();
        }
      }
    });
  }

  function setActiveTool(tool) {
    activeTool = tool;
    updateToolUI();
  }

  function updateToolUI() {
    if (!toolbarEl) return;

    toolbarEl.querySelectorAll('[data-tool]').forEach(btn => {
      const isCurrent = btn.getAttribute('data-tool') === activeTool;
      btn.classList.toggle('active', isCurrent);
    });

    if (svgCanvas) {
      if (activeTool === 'select') {
        svgCanvas.style.pointerEvents = 'none';
        svgCanvas.style.cursor = 'default';
      } else if (activeTool === 'pen' || activeTool === 'highlighter') {
        svgCanvas.style.pointerEvents = 'auto';
        svgCanvas.style.cursor = 'crosshair';
      } else if (activeTool === 'eraser') {
        svgCanvas.style.pointerEvents = 'auto';
        svgCanvas.style.cursor = 'cell';
      }
    }

    // Update size indicator
    const sizeIndicator = toolbarEl.querySelector('#anno-size-indicator');
    if (sizeIndicator) {
      const sz = activeTool === 'highlighter' ? 14 : (currentPenSize * 2.2);
      sizeIndicator.style.width = `${Math.max(4, sz)}px`;
      sizeIndicator.style.height = `${Math.max(4, sz)}px`;
      sizeIndicator.style.backgroundColor = currentColor;
    }
  }

  function setColor(colorHex) {
    currentColor = colorHex;
    if (toolbarEl) {
      toolbarEl.querySelectorAll('.anno-color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === colorHex);
      });
    }
    updateToolUI();
  }

  function cycleStrokeSize() {
    if (activeTool === 'highlighter') {
      currentHighlighterSize = currentHighlighterSize === 18 ? 26 : (currentHighlighterSize === 26 ? 12 : 18);
    } else {
      currentPenSize = currentPenSize === 2.5 ? 4.5 : (currentPenSize === 4.5 ? 1.5 : 2.5);
    }
    updateToolUI();
  }

  function toggleVisibility() {
    isVisible = !isVisible;
    if (annotationsLayer) {
      annotationsLayer.classList.toggle('is-hidden', !isVisible);
    }
    if (toolbarEl) {
      const btnVis = toolbarEl.querySelector('#btn-anno-visibility');
      if (btnVis) {
        btnVis.classList.toggle('is-muted', !isVisible);
        const eyeOpen = btnVis.querySelector('.icon-eye-open');
        const eyeClosed = btnVis.querySelector('.icon-eye-closed');
        if (eyeOpen) eyeOpen.style.display = isVisible ? 'block' : 'none';
        if (eyeClosed) eyeClosed.style.display = isVisible ? 'none' : 'block';
      }
    }
  }

  function clearAll() {
    if (annotations.stickies.length === 0 && annotations.drawings.length === 0) return;
    if (!confirm('Are you sure you want to clear all sticky notes and drawings from this lecture?')) return;

    pushHistory({
      type: 'clear_all',
      previousState: {
        stickies: [...annotations.stickies],
        drawings: [...annotations.drawings]
      }
    });

    annotations.stickies = [];
    annotations.drawings = [];
    renderDrawings();
    renderStickies();
    saveAnnotations();
  }

  // ==========================================================================
  // Undo / Redo History
  // ==========================================================================
  function pushHistory(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // Clear redo
  }

  function undo() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();

    if (action.type === 'add_drawing') {
      const idx = annotations.drawings.findIndex(d => d.id === action.stroke.id);
      if (idx !== -1) {
        const removed = annotations.drawings.splice(idx, 1)[0];
        redoStack.push({ type: 'add_drawing', stroke: removed, index: idx });
      }
    } else if (action.type === 'delete_drawing') {
      annotations.drawings.splice(action.index, 0, action.stroke);
      redoStack.push({ type: 'delete_drawing', stroke: action.stroke, index: action.index });
    } else if (action.type === 'add_sticky') {
      const idx = annotations.stickies.findIndex(s => s.id === action.sticky.id);
      if (idx !== -1) {
        const removed = annotations.stickies.splice(idx, 1)[0];
        redoStack.push({ type: 'add_sticky', sticky: removed, index: idx });
      }
    } else if (action.type === 'delete_sticky') {
      annotations.stickies.splice(action.index, 0, action.sticky);
      redoStack.push({ type: 'delete_sticky', sticky: action.sticky, index: action.index });
    } else if (action.type === 'clear_all') {
      redoStack.push({
        type: 'clear_all',
        previousState: {
          stickies: [...annotations.stickies],
          drawings: [...annotations.drawings]
        }
      });
      annotations.stickies = [...action.previousState.stickies];
      annotations.drawings = [...action.previousState.drawings];
    }

    renderDrawings();
    renderStickies();
    saveAnnotations();
  }

  function redo() {
    if (redoStack.length === 0) return;
    const action = redoStack.pop();

    if (action.type === 'add_drawing') {
      annotations.drawings.push(action.stroke);
      undoStack.push({ type: 'add_drawing', stroke: action.stroke });
    } else if (action.type === 'delete_drawing') {
      const idx = annotations.drawings.findIndex(d => d.id === action.stroke.id);
      if (idx !== -1) {
        const removed = annotations.drawings.splice(idx, 1)[0];
        undoStack.push({ type: 'delete_drawing', stroke: removed, index: idx });
      }
    } else if (action.type === 'add_sticky') {
      annotations.stickies.push(action.sticky);
      undoStack.push({ type: 'add_sticky', sticky: action.sticky });
    } else if (action.type === 'delete_sticky') {
      const idx = annotations.stickies.findIndex(s => s.id === action.sticky.id);
      if (idx !== -1) {
        const removed = annotations.stickies.splice(idx, 1)[0];
        undoStack.push({ type: 'delete_sticky', sticky: removed, index: idx });
      }
    } else if (action.type === 'clear_all') {
      undoStack.push({
        type: 'clear_all',
        previousState: {
          stickies: [...annotations.stickies],
          drawings: [...annotations.drawings]
        }
      });
      annotations.stickies = [];
      annotations.drawings = [];
    }

    renderDrawings();
    renderStickies();
    saveAnnotations();
  }

  // ==========================================================================
  // Persistence & Lifecycle
  // ==========================================================================
  async function loadAnnotations(course, lecture, initialData = null) {
    currentCourse = course;
    currentLecture = lecture;
    undoStack.length = 0;
    redoStack.length = 0;

    if (initialData && (initialData.stickies || initialData.drawings)) {
      setAnnotations(initialData);
      return;
    }

    if (!course || !lecture) {
      setAnnotations({ version: 1, stickies: [], drawings: [] });
      return;
    }

    try {
      const res = await fetch(`/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/annotations`);
      if (res.ok) {
        const data = await res.json();
        setAnnotations(data.annotations);
      } else {
        setAnnotations({ version: 1, stickies: [], drawings: [] });
      }
    } catch (err) {
      console.warn('Failed to load annotations:', err);
      setAnnotations({ version: 1, stickies: [], drawings: [] });
    }
  }

  function setAnnotations(data) {
    annotations = {
      version: data?.version || 1,
      stickies: Array.isArray(data?.stickies) ? data.stickies : [],
      drawings: Array.isArray(data?.drawings) ? data.drawings : []
    };
    renderDrawings();
    renderStickies();
  }

  function getAnnotations() {
    return annotations;
  }

  function saveAnnotations(immediate = false) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);

    const executeSave = async () => {
      if (!currentCourse || !currentLecture) return;
      try {
        await fetch(`/api/lectures/${encodeURIComponent(currentCourse)}/${encodeURIComponent(currentLecture)}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations })
        });
      } catch (err) {
        console.warn('Error saving annotations:', err);
      }
    };

    if (immediate) {
      executeSave();
    } else {
      autoSaveTimer = setTimeout(executeSave, 400);
    }
  }

  return {
    init,
    loadAnnotations,
    saveAnnotations,
    setAnnotations,
    getAnnotations,
    setActiveTool,
    getActiveTool: () => activeTool,
    isDrawingActive: () => activeTool !== 'select',
    setColor,
    getColor: () => currentColor,
    addStickyNote,
    deleteStickyNote,
    toggleStickyCollapse,
    undo,
    redo,
    clearAll,
    toggleVisibility,
    isVisible: () => isVisible
  };
})();

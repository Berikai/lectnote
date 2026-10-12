/**
 * LectNote: Client-Side Live Preview Engine
 * Renders KaTeX, RoughNotation, Mermaid, and Board References.
 */

window.LectNotePreview = (function() {
  let debounceTimer = null;
  let activeAnnotations = [];

  // Client-side markdown renderer with same custom rules as server
  function renderMarkdownClient(src, course, lecture) {
    if (!src) return '';
    const photoBaseUrl = course && lecture ? `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/` : '';
    let text = src;

    // 1. Sticky Callouts: > [!note] Title
    text = text.replace(/^>\s*\[!(note|tip|warning|insight|exam)\](?:\s*(.*))?$/gim, (match, type, title) => {
      const typeLabels = {
        note: '★ Professor Note',
        tip: '💡 Midterm Insight',
        warning: '⚠️ Critical Pitfall',
        insight: '🔍 Key Takeaway',
        exam: '📝 Exam Note'
      };
      const label = title ? title.trim() : (typeLabels[type.toLowerCase()] || 'Note');
      return `:::sticky-start [${type.toLowerCase()}] [${label}]:::`;
    });

    const lines = text.split('\n');
    const processedLines = [];
    let inSticky = false;
    let stickyType = 'note';
    let stickyLabel = '';
    let stickyContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startMatch = line.match(/^:::sticky-start \[([^\]]+)\] \[([^\]]+)\]:::$/);
      
      if (startMatch) {
        inSticky = true;
        stickyType = startMatch[1];
        stickyLabel = startMatch[2];
        stickyContent = [];
        continue;
      }

      if (inSticky) {
        if (line.startsWith('>')) {
          stickyContent.push(line.replace(/^>\s?/, ''));
        } else if (line.trim() === '') {
          if (i + 1 < lines.length && lines[i + 1].startsWith('>')) {
            stickyContent.push('');
          } else {
            inSticky = false;
            processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'))}</div></aside>`);
            processedLines.push(line);
          }
        } else {
          inSticky = false;
          processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'))}</div></aside>`);
          processedLines.push(line);
        }
      } else {
        processedLines.push(line);
      }
    }

    if (inSticky) {
      processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'))}</div></aside>`);
    }

    text = processedLines.join('\n');

    // 2. Board References: :::board-ref [photo.jpg] "Caption" :::
    text = text.replace(/:::board-ref\s*\[([^\]]+)\]\s*(?:"([^"]*)")?\s*:::/g, (match, filename, caption) => {
      const cap = caption || `Whiteboard Reference: ${filename}`;
      const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename.trim())}` : filename.trim();
      return `<figure class="board-ref" data-photo="${escapeHtml(filename.trim())}">
        <div class="board-ref-header">
          <span class="board-ref-tag">📷 Whiteboard Ref</span>
          <span class="board-ref-filename">${escapeHtml(filename.trim())}</span>
          <button type="button" class="btn-inspect-board" data-photo="${escapeHtml(filename.trim())}" title="Inspect board photo">🔍 Inspect Board</button>
        </div>
        <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename.trim())}">
          <img src="${photoUrl}" alt="${escapeHtml(cap)}" onerror="this.src='https://placehold.co/600x300/1e293b/94a3b8?text=Photo:+${encodeURIComponent(filename.trim())}'" loading="lazy" />
        </div>
        <figcaption>${escapeHtml(cap)}</figcaption>
      </figure>`;
    });

    // 3. Highlight: ==text== or ==#hex:text==
    text = text.replace(/==(?:#([0-9a-fA-F]{3,6}):)?([^=\n]+)==/g, (match, color, content) => {
      const c = color ? `#${color}` : '#fef08a';
      return `<mark class="rn-elem" data-rn="highlight" data-color="${c}">${content}</mark>`;
    });

    // 4. Bracketed Annotations: [content]{.circle}, [content]{.box}, [content]{.underline}
    text = text.replace(/\[([^\]]+)\]\{\.(circle|box|underline|highlight)(?:\s+(#[0-9a-fA-F]{3,6}))?\}/g, (match, content, type, color) => {
      const defaultColors = {
        circle: '#f87171',
        box: '#60a5fa',
        underline: '#fb923c',
        highlight: '#fef08a'
      };
      const c = color || defaultColors[type] || '#fef08a';
      return `<span class="rn-elem" data-rn="${type}" data-color="${c}">${content}</span>`;
    });

    return parseBasicMarkdown(text);
  }

  function parseBasicMarkdown(src) {
    if (window.markdownit) {
      const md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        breaks: false
      });

      const origFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

      md.renderer.rules.fence = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const info = token.info ? token.info.trim() : '';
        if (info === 'mermaid') {
          return `<div class="mermaid-wrapper"><div class="mermaid">\n${token.content}\n</div></div>`;
        }
        if (info === 'svg') {
          return `<div class="svg-diagram-wrapper">\n${token.content}\n</div>`;
        }
        return origFence(tokens, idx, options, env, self);
      };

      return md.render(src);
    }
    return src;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Main render trigger
   */
  async function updatePreview(markdownText, course, lecture, immediate = false) {
    if (debounceTimer) clearTimeout(debounceTimer);

    const execute = async () => {
      const container = document.getElementById('preview-content');
      if (!container) return;

      // 1. Inject parsed HTML
      const html = renderMarkdownClient(markdownText, course, lecture);
      container.innerHTML = html;

      // 2. Wait for fonts
      try {
        await document.fonts.ready;
      } catch (e) {
        // Fallback
      }

      // 3. Render KaTeX
      if (window.renderMathInElement) {
        try {
          renderMathInElement(container, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false }
            ],
            throwOnError: false
          });
        } catch (e) {
          console.warn('KaTeX render error:', e);
        }
      }

      // 4. Render Mermaid diagrams
      if (window.mermaid) {
        try {
          const currentTheme = document.body.classList.contains('theme-academic') ? 'default' : 'neutral';
          mermaid.initialize({ startOnLoad: false, theme: currentTheme });
          await mermaid.run({ querySelector: '#preview-content .mermaid' });
        } catch (e) {
          console.warn('Mermaid render error:', e);
        }
      }

      // 5. Force DOM reflow
      void container.offsetHeight;

      // 6. Draw Rough Notation Annotations
      if (window.RoughNotation) {
        // Clear previous annotations
        if (activeAnnotations && activeAnnotations.length > 0) {
          activeAnnotations = [];
        }

        const elements = container.querySelectorAll('[data-rn]');
        const group = [];

        elements.forEach(el => {
          const type = el.getAttribute('data-rn');
          const color = el.getAttribute('data-color') || '#fef08a';
          const isBlock = el.tagName === 'DIV' || el.classList.contains('rn-block-box');

          try {
            const annotation = RoughNotation.annotate(el, {
              type: type,
              color: color,
              padding: isBlock ? 8 : 3,
              multiline: type === 'highlight' || type === 'underline',
              iterations: 2
            });
            group.push(annotation);
          } catch (err) {
            console.warn('RoughNotation annotate error on element', el, err);
          }
        });

        if (group.length > 0) {
          const annotationGroup = RoughNotation.annotationGroup(group);
          annotationGroup.show();
          activeAnnotations = group;
        }
      }

      // 7. Bind photo inspection buttons
      container.querySelectorAll('.btn-inspect-board, .board-ref-img-wrapper').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const photo = btn.getAttribute('data-photo');
          if (photo && window.LectNotePhotoDrawer) {
            window.LectNotePhotoDrawer.openLightbox(photo);
          }
        };
      });
    };

    if (immediate) {
      await execute();
    } else {
      debounceTimer = setTimeout(execute, 300);
    }
  }

  return {
    updatePreview
  };
})();


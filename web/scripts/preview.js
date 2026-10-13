/**
 * LectNote: Client-Side Live Preview Engine
 * Renders KaTeX, RoughNotation, Mermaid, and Board References.
 */

window.LectNotePreview = (function() {
  let debounceTimer = null;
  let activeAnnotations = [];
  let refreshTimer = null;
  let resizeObserver = null;

  function refreshAnnotations() {
    if (!activeAnnotations || activeAnnotations.length === 0) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      activeAnnotations.forEach(a => {
        try {
          if (a && typeof a.show === 'function') {
            a.show();
          }
        } catch (err) {}
      });
    }, 40);
  }

  function fitDisplayMath(container) {
    if (!container) return;
    const displays = container.querySelectorAll('.katex-display');
    displays.forEach(disp => {
      disp.style.fontSize = '';
      const katexEl = disp.querySelector('.katex');
      if (!katexEl) return;

      const parent = disp.closest('.rn-block-circle, .rn-block-box, li, blockquote, .content-body') || disp.parentElement;
      const parentWidth = parent ? parent.clientWidth : disp.clientWidth;
      if (parentWidth <= 0) return;

      const naturalWidth = katexEl.scrollWidth;
      const targetWidth = parentWidth - 24;
      if (naturalWidth > targetWidth && targetWidth > 0) {
        const ratio = Math.max(0.70, targetWidth / naturalWidth);
        disp.style.fontSize = (ratio * 100).toFixed(1) + '%';
      }
    });
  }

  function fitTables(container) {
    if (!container) return;
    const wrappers = container.querySelectorAll('.table-wrapper');
    wrappers.forEach(wrapper => {
      const table = wrapper.querySelector('table');
      if (!table) return;
      table.style.fontSize = '';
      const containerWidth = wrapper.clientWidth;
      if (containerWidth <= 0) return;
      const tableWidth = table.scrollWidth;
      if (tableWidth > containerWidth) {
        const ratio = Math.max(0.68, (containerWidth - 4) / tableWidth);
        const baseSize = parseFloat(window.getComputedStyle(table).fontSize) || 15;
        table.style.fontSize = (baseSize * ratio).toFixed(1) + 'px';
        if (table.scrollWidth > containerWidth) {
          const secondRatio = (containerWidth - 2) / table.scrollWidth;
          const curr = parseFloat(window.getComputedStyle(table).fontSize) || (baseSize * ratio);
          table.style.fontSize = Math.max(10, curr * secondRatio).toFixed(1) + 'px';
        }
      }
    });
  }

  function setupResizeObserver() {
    if (!window.ResizeObserver || resizeObserver) return;
    const paper = document.getElementById('preview-paper');
    if (!paper) return;

    resizeObserver = new ResizeObserver(() => {
      const container = document.getElementById('preview-content');
      if (container) {
        fitDisplayMath(container);
        fitTables(container);
      }
      refreshAnnotations();
    });
    resizeObserver.observe(paper);
  }

  // Client-side markdown renderer with same custom rules as server
  function renderMarkdownClient(src, course, lecture) {
    if (!src) return '';
    const photoBaseUrl = course && lecture ? `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/` : '';
    
    // Protect code blocks (```...```) and inline code (`...`) from all preprocessing (highlights, annotations, callouts)
    const codeBlocks = [];
    let text = src.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
      const idx = codeBlocks.length;
      codeBlocks.push(match);
      return `LECTNOTECODEPLACEHOLDER${idx}END`;
    });

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
    let stickyStartLine = 0;
    let stickyType = 'note';
    let stickyLabel = '';
    let stickyContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const startMatch = line.match(/^:::sticky-start \[([^\]]+)\] \[([^\]]+)\]:::$/);
      
      if (startMatch) {
        inSticky = true;
        stickyStartLine = i;
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
            processedLines.push(`<aside class="sticky-note sticky-${stickyType}" data-source-line="${stickyStartLine}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'), codeBlocks)}</div></aside>`);
            while (processedLines.length <= i) {
              processedLines.push('');
            }
          }
        } else {
          inSticky = false;
          processedLines.push(`<aside class="sticky-note sticky-${stickyType}" data-source-line="${stickyStartLine}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'), codeBlocks)}</div></aside>`);
          while (processedLines.length < i) {
            processedLines.push('');
          }
          processedLines.push(line);
        }
      } else {
        processedLines.push(line);
      }
    }

    if (inSticky) {
      processedLines.push(`<aside class="sticky-note sticky-${stickyType}" data-source-line="${stickyStartLine}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${parseBasicMarkdown(stickyContent.join('\n'), codeBlocks)}</div></aside>`);
      while (processedLines.length < lines.length) {
        processedLines.push('');
      }
    }

    text = processedLines.join('\n');

    // 2. Board References: :::board-ref [photo.jpg] [photo2.jpg] "Caption" :::
    text = text.replace(/:::\s*board-ref\s+((?:\[[^\]]+\]\s*)+)(?:"([^"]*)")?\s*:::/gi, (match, rawPhotos, caption, offset) => {
      const lineNum = text.substring(0, offset).split('\n').length - 1;
      const photos = [];
      for (const bm of rawPhotos.matchAll(/\[([^\]]+)\]/g)) {
        photos.push(...bm[1].split(/[,;\s]+/).map(p => p.trim()).filter(Boolean));
      }
      if (photos.length === 0) return '';

      const cap = caption ? caption.trim() : (photos.length > 1 ? `Whiteboard References (${photos.length} photos)` : `Whiteboard Reference: ${photos[0]}`);

      if (photos.length === 1) {
        const filename = photos[0];
        const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename)}` : filename;
        return `<figure class="board-ref" data-source-line="${lineNum}" data-photo="${escapeHtml(filename)}">
          <div class="board-ref-header">
            <span class="board-ref-tag"><svg class="ui-icon" style="width:12px;height:12px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Board Ref</span>
            <span class="board-ref-filename">${escapeHtml(filename)}</span>
            <button type="button" class="btn-inspect-board" data-photo="${escapeHtml(filename)}" title="Inspect board photo"><svg class="ui-icon" style="width:12px;height:12px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>Inspect Board</button>
          </div>
          <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename)}">
            <img src="${photoUrl}" alt="${escapeHtml(cap)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';if(this.src.endsWith('.jpg'))this.src=this.src.replace(/\\.jpg$/,'.png');else if(this.src.endsWith('.png'))this.src=this.src.replace(/\\.png$/,'.jpg');}else{this.src='https://placehold.co/600x300/1e293b/94a3b8?text=Photo:+${encodeURIComponent(filename)}';}" />
          </div>
          <figcaption>${escapeHtml(cap)}</figcaption>
        </figure>`;
      }

      // Multiple photos: render as responsive gallery
      const itemsHtml = photos.map((filename, idx) => {
        const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename)}` : filename;
        return `<div class="board-ref-gallery-item">
          <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename)}" title="Click to inspect: ${escapeHtml(filename)}">
            <img src="${photoUrl}" alt="Board ${idx + 1}: ${escapeHtml(filename)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';if(this.src.endsWith('.jpg'))this.src=this.src.replace(/\\.jpg$/,'.png');else if(this.src.endsWith('.png'))this.src=this.src.replace(/\\.png$/,'.jpg');}else{this.src='https://placehold.co/600x300/1e293b/94a3b8?text=Photo:+${encodeURIComponent(filename)}';}" />
            <div class="board-ref-img-badge">Board ${idx + 1}</div>
          </div>
          <div class="board-ref-item-footer">
            <span class="board-ref-item-name">${escapeHtml(filename)}</span>
            <button type="button" class="btn-inspect-board btn-sm" data-photo="${escapeHtml(filename)}" title="Inspect photo ${idx + 1}">
              <svg class="ui-icon" style="width:11px;height:11px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
          </div>
        </div>`;
      }).join('');

      return `<figure class="board-ref board-ref-multi" data-source-line="${lineNum}">
        <div class="board-ref-header">
          <span class="board-ref-tag"><svg class="ui-icon" style="width:12px;height:12px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Board Ref (${photos.length} photos)</span>
          <span class="board-ref-filename">${escapeHtml(photos.join(', '))}</span>
        </div>
        <div class="board-ref-gallery" style="--gallery-columns: ${Math.min(photos.length, 3)};">
          ${itemsHtml}
        </div>
        <figcaption>${escapeHtml(cap)}</figcaption>
      </figure>`;
    });

    // 3. Highlight: ==text== or ==#hex:text==
    text = text.replace(/==(?:#([0-9a-fA-F]{3,6}):)?([^=\n]+)==/g, (match, color, content) => {
      const c = color ? `#${color}` : '#fef08a';
      return `<span class="rn-wrapper"><mark class="rn-elem" data-rn="highlight" data-color="${c}">${content}</mark></span>`;
    });

    // 4. Auto-wrap standalone LaTeX blocks (\begin{aligned} etc.) if not already inside $$
    text = text.replace(/(^|\n)(\\begin\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|vmatrix|cases|equation\*?)\}[\s\S]*?\\end\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|vmatrix|cases|equation\*?)\})/g, (match, prefix, mathBlock) => {
      return `${prefix}$$\n${mathBlock}\n$$`;
    });

    // 5. Process Display Math containing Bracket Annotations: $$ prefix [content]{.type} suffix $$
    text = text.replace(/\$\$(.*?)(?:\[((?:[^[\]]|\[[^[\]]*\])+)\]\{\.(circle|c|box|b|underline|u|uline|u-line|highlight|hl)(?:\s+(#[0-9a-fA-F]{3,6}))?\})(.*?)\$\$/g, (match, prefix, content, rawType, color, suffix) => {
      const type = normalizeType(rawType);
      const c = color || getDefaultColor(type);

      let cleanPrefix = prefix.replace(/(?:^|[^\\])(?:\\\\)*\\left\s*$/, '').trim();
      let cleanContent = content.trim();
      let cleanSuffix = suffix.replace(/^\s*\\right(?:\s|[^\w\\]|$)/, '').trim();
      if (/(?:^|[^\\])(?:\\\\)*\\right\s*$/.test(cleanContent)) {
        cleanContent = cleanContent.replace(/\\right\s*$/, '').trim();
      }

      if (!cleanPrefix && !cleanSuffix) {
        return transformAnnotation(`$$\n${cleanContent}\n$$`, type, c);
      }

      const prefixMath = cleanPrefix ? `<span class="katex-disp-inline">$$${cleanPrefix}$$</span> ` : '';
      const suffixMath = cleanSuffix ? ` <span class="katex-disp-inline">$$${cleanSuffix}$$</span>` : '';
      const annotated = transformAnnotation(cleanContent, type, c);
      return `<div class="katex-display-row">${prefixMath}${annotated}${suffixMath}</div>`;
    });

    // 6. Bracketed Annotations with nested bracket support & LaTeX auto-detection
    text = replaceBracketAnnotations(text);

    return parseBasicMarkdown(text, codeBlocks);
  }

  function normalizeType(rawType) {
    const t = rawType.toLowerCase();
    if (t === 'u' || t === 'uline' || t === 'u-line' || t === 'underline') return 'underline';
    if (t === 'c' || t === 'circle') return 'circle';
    if (t === 'b' || t === 'box') return 'box';
    if (t === 'hl' || t === 'highlight') return 'highlight';
    return t;
  }

  function getDefaultColor(type) {
    const map = {
      circle: '#f87171',
      box: '#60a5fa',
      underline: '#fb923c',
      highlight: '#fef08a'
    };
    return map[type] || '#fef08a';
  }

  function transformAnnotation(content, type, color) {
    let inner = content.trim();
    const isDisplay = (inner.startsWith('$$') && inner.endsWith('$$')) || (inner.startsWith('\\[') && inner.endsWith('\\]'));
    const isInline = (inner.startsWith('$') && inner.endsWith('$') && !isDisplay) || (inner.startsWith('\\(') && inner.endsWith('\\)'));
    
    // Detect if content contains math delimiters already ($ or \( or \[)
    const hasDelimiters = inner.includes('$') || inner.includes('\\(') || inner.includes('\\[') || inner.includes('\\begin{');

    // Detect if content contains bare LaTeX math commands without delimiters
    const hasLatex = /\\[a-zA-Z]+|[_\^]\{|[+\-=<>]\s*\\/.test(inner);

    // Auto-wrap in $...$ ONLY if no math delimiters exist and it is not regular prose text
    if (!isDisplay && !isInline && !hasDelimiters && hasLatex) {
      const isProse = /[a-zA-Z]{4,}\s+[a-zA-Z]{4,}/.test(inner);
      if (!isProse) {
        inner = `$${inner}$`;
      }
    }

    const isBlock = isDisplay || (inner.startsWith('$$') && inner.endsWith('$$'));
    const elemTag = isBlock ? 'div' : 'span';
    const blockClass = isBlock ? (type === 'box' ? ' rn-block-box' : ' rn-block-circle') : '';
    const wrapperTag = isBlock ? 'div' : 'span';
    const wrapperClass = isBlock ? 'rn-wrapper rn-wrapper-block' : 'rn-wrapper';
    return `<${wrapperTag} class="${wrapperClass}"><${elemTag} class="rn-elem${blockClass}" data-rn="${type}" data-color="${color}">${inner}</${elemTag}></${wrapperTag}>`;
  }

  function replaceBracketAnnotations(text) {
    // Support HTML <u>...</u> as hand-drawn underline
    text = text.replace(/<u>([\s\S]*?)<\/u>/gi, '<span class="rn-wrapper"><span class="rn-elem" data-rn="underline" data-color="#fb923c">$1</span></span>');

    let result = '';
    let i = 0;
    while (i < text.length) {
      if (text[i] === '[' && (i === 0 || text[i - 1] !== '\\')) {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '\\') {
            j += 2;
            continue;
          }
          if (text[j] === '[') depth++;
          else if (text[j] === ']') depth--;
          j++;
        }
        if (depth === 0) {
          const content = text.slice(i + 1, j - 1);
          const remainder = text.slice(j);
          const tagMatch = remainder.match(/^\s*\{\.(circle|c|box|b|underline|u|uline|u-line|highlight|hl)(?:\s+(#[0-9a-fA-F]{3,6}))?\}/i);
          if (tagMatch) {
            const type = normalizeType(tagMatch[1]);
            const color = tagMatch[2] || getDefaultColor(type);

            let cleanContent = content;
            if (/(?:^|[^\\])(?:\\\\)*\\left\s*$/.test(result)) {
              result = result.replace(/\\left\s*$/, '');
              cleanContent = cleanContent.replace(/(?:^|[^\\])(?:\\\\)*\\right\s*$/, '');
            }

            result += transformAnnotation(cleanContent, type, color);
            i = j + tagMatch[0].length;
            continue;
          }
        }
      }
      result += text[i];
      i++;
    }
    return result;
  }

  function parseBasicMarkdown(src, externalCodeBlocks = []) {
    if (window.markdownit) {
      const md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        breaks: false,
        highlight: function (str, lang) {
          if (window.hljs && lang && window.hljs.getLanguage(lang)) {
            try {
              return '<pre class="hljs"><code class="hljs language-' + lang + '">' +
                     window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                     '</code></pre>';
            } catch (__) {}
          }
          return '<pre class="hljs"><code>' + escapeHtml(str) + '</code></pre>';
        }
      });

      // Inject data-source-line onto all block tokens
      md.core.ruler.push('source_line_attrs', function(state) {
        state.tokens.forEach(token => {
          if (token.map) {
            token.attrSet('data-source-line', String(token.map[0]));
          }
        });
      });

      const origFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

      md.renderer.rules.fence = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const lineAttr = token.map ? ` data-source-line="${token.map[0]}"` : '';
        const info = token.info ? token.info.trim() : '';
        if (info === 'mermaid') {
          return `<div class="mermaid-wrapper"${lineAttr}><div class="mermaid">\n${sanitizeMermaid(token.content)}\n</div></div>`;
        }
        if (info === 'svg') {
          return `<div class="svg-diagram-wrapper"${lineAttr}>\n${token.content}\n</div>`;
        }
        const rendered = origFence(tokens, idx, options, env, self);
        if (lineAttr && !rendered.includes('data-source-line')) {
          return rendered.replace(/^<pre\b/, `<pre${lineAttr}`);
        }
        return rendered;
      };

      const defaultTableOpen = md.renderer.rules.table_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };
      const defaultTableClose = md.renderer.rules.table_close || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };

      md.renderer.rules.table_open = function(tokens, idx, options, env, self) {
        const token = tokens[idx];
        const lineAttr = token.map ? ` data-source-line="${token.map[0]}"` : '';
        return `<div class="table-wrapper"${lineAttr}>\n` + defaultTableOpen(tokens, idx, options, env, self);
      };
      md.renderer.rules.table_close = function(tokens, idx, options, env, self) {
        return defaultTableClose(tokens, idx, options, env, self) + '\n</div>';
      };

      return renderWithMath(md, src, externalCodeBlocks);
    }
    return src;
  }

  function sanitizeMermaid(content) {
    if (!content) return '';
    // Auto-quote unquoted square bracket node labels containing &, (, ), :, or comma
    return content.replace(/(\b[A-Za-z0-9_]+)\[([^"\]\r\n]*?[&():,][^"\]\r\n]*?)\]/g, '$1["$2"]');
  }

  function escapeMathHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sanitizeMathInner(mathContent) {
    // Auto-escape % when not preceded by an odd number of backslashes
    return mathContent.replace(/(^|[^\\])(\\\\)*(%)/g, '$1$2\\%');
  }

  function protectMath(text) {
    // Auto-close unclosed display math at EOF if any
    const displayDollarMatches = text.match(/\$\$/g);
    if (displayDollarMatches && displayDollarMatches.length % 2 !== 0) {
      text = text + '\n$$';
    }

    // Protect any local code blocks (```...```) and inline code (`...`) from math processing
    const localCodeBlocks = [];
    let protectedText = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
      const idx = localCodeBlocks.length;
      localCodeBlocks.push(match);
      return `LECTNOTELOCALCODE${idx}END`;
    });

    const mathDisplay = [];
    // Display math $$...$$
    protectedText = protectedText.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner) => {
      const idx = mathDisplay.length;
      const clean = escapeMathHtml('$$' + sanitizeMathInner(inner) + '$$');
      mathDisplay.push(clean);
      return `LECTNOTEMATHDISP${idx}END`;
    });

    // LaTeX display math \[...\]
    protectedText = protectedText.replace(/\\\[([\s\S]*?)\\\]/g, (match, inner) => {
      const idx = mathDisplay.length;
      const clean = escapeMathHtml('\\[' + sanitizeMathInner(inner) + '\\]');
      mathDisplay.push(clean);
      return `LECTNOTEMATHDISP${idx}END`;
    });

    const mathInline = [];
    // Inline math $...$ (not preceded by \)
    protectedText = protectedText.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (match, prefix, inner) => {
      const idx = mathInline.length;
      const clean = escapeMathHtml('$' + sanitizeMathInner(inner) + '$');
      mathInline.push(clean);
      return `${prefix}LECTNOTEMATHINL${idx}END`;
    });

    // LaTeX inline math \(...\)
    protectedText = protectedText.replace(/\\\(([\s\S]*?)\\\)/g, (match, inner) => {
      const idx = mathInline.length;
      const clean = escapeMathHtml('\\(' + sanitizeMathInner(inner) + '\\)');
      mathInline.push(clean);
      return `LECTNOTEMATHINL${idx}END`;
    });

    // Restore local code blocks before md.render
    protectedText = protectedText.replace(/LECTNOTELOCALCODE(\d+)END/g, (_, idx) => localCodeBlocks[parseInt(idx, 10)]);

    return { protectedText, mathDisplay, mathInline };
  }

  function restoreMath(html, mathDisplay, mathInline) {
    let restored = html;
    restored = restored.replace(/LECTNOTEMATHDISP(\d+)END/g, (_, idx) => mathDisplay[parseInt(idx, 10)]);
    restored = restored.replace(/LECTNOTEMATHINL(\d+)END/g, (_, idx) => mathInline[parseInt(idx, 10)]);
    return restored;
  }

  function renderWithMath(md, content, externalCodeBlocks = []) {
    const { protectedText, mathDisplay, mathInline } = protectMath(content);
    let textToRender = protectedText;
    if (externalCodeBlocks && externalCodeBlocks.length > 0) {
      textToRender = textToRender.replace(/LECTNOTECODEPLACEHOLDER(\d+)END/g, (_, idx) => externalCodeBlocks[parseInt(idx, 10)]);
    }
    let html = md.render(textToRender);
    return restoreMath(html, mathDisplay, mathInline);
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

  let lastEditLine = null;
  let searchHighlightTimer = null;

  function scrollToLine(lineIndex, smooth = true) {
    if (typeof lineIndex !== 'number' || lineIndex < 0) return;
    const container = document.getElementById('preview-content');
    const scrollContainer = document.querySelector('.preview-scroll-container');
    if (!container || !scrollContainer) return;

    const elements = Array.from(container.querySelectorAll('[data-source-line]'));
    if (elements.length === 0) return;

    // Handle top
    if (lineIndex === 0) {
      scrollContainer.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }

    let targetEl = null;
    let targetLine = -1;

    for (const el of elements) {
      const l = parseInt(el.getAttribute('data-source-line'), 10);
      if (!isNaN(l)) {
        if (l <= lineIndex && l >= targetLine) {
          targetLine = l;
          targetEl = el;
        }
      }
    }

    // Check if lineIndex is past the end of known elements
    const maxLine = elements.reduce((max, el) => {
      const l = parseInt(el.getAttribute('data-source-line'), 10);
      return isNaN(l) ? max : Math.max(max, l);
    }, 0);

    if (lineIndex > maxLine + 2) {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
      return;
    }

    if (!targetEl && elements.length > 0) {
      targetEl = elements[0];
    }

    if (targetEl) {
      const blockEl = targetEl.closest('h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, .table-wrapper, .mermaid-wrapper, .svg-diagram-wrapper, .sticky-note, .board-ref, pre') || targetEl;

      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = blockEl.getBoundingClientRect();
      const padTop = 60;
      const padBottom = 80;

      const relTop = elRect.top - containerRect.top;
      const relBottom = elRect.bottom - containerRect.top;

      // If already comfortably visible, avoid unnecessary jumping
      if (relTop >= padTop && relBottom <= scrollContainer.clientHeight - padBottom) {
        return;
      }

      const targetScroll = (relTop + scrollContainer.scrollTop) - padTop;
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const clampedScroll = Math.max(0, Math.min(targetScroll, maxScroll));

      scrollContainer.scrollTo({
        top: clampedScroll,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }

  function clearSearchHighlights() {
    clearTimeout(searchHighlightTimer);
    const container = document.getElementById('preview-content');
    if (!container) return;
    container.querySelectorAll('.search-section-highlight').forEach(el => {
      el.classList.remove('search-section-highlight');
    });
    container.querySelectorAll('.search-finding-highlight').forEach(mark => {
      if (mark.parentNode) {
        const textNode = document.createTextNode(mark.textContent);
        const parent = mark.parentNode;
        parent.replaceChild(textNode, mark);
        parent.normalize();
      }
    });
  }

  function highlightAndScrollSearch({ query, lineNum, matchIdx }) {
    const container = document.getElementById('preview-content');
    const scrollContainer = document.querySelector('.preview-scroll-container');
    if (!container || !scrollContainer) return;

    clearSearchHighlights();

    let targetEl = null;
    let createdMark = null;

    if (query && query.trim()) {
      const qClean = query.trim();
      const qLower = qClean.toLowerCase();

      const textNodes = [];
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            if (!node.textContent || !node.textContent.toLowerCase().includes(qLower)) {
              return NodeFilter.FILTER_REJECT;
            }
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || parent.classList.contains('search-finding-highlight')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let n;
      while ((n = walker.nextNode())) {
        textNodes.push(n);
      }

      let bestNode = null;
      if (textNodes.length > 0) {
        if (typeof lineNum === 'number') {
          let bestDist = Infinity;
          for (const node of textNodes) {
            const block = node.parentElement.closest('[data-source-line]');
            if (block) {
              const l = parseInt(block.getAttribute('data-source-line'), 10);
              if (!isNaN(l)) {
                const dist = Math.abs(l - lineNum);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestNode = node;
                }
              }
            }
          }
        }
        if (!bestNode) bestNode = textNodes[0];
      }

      if (bestNode) {
        const text = bestNode.textContent;
        const idx = text.toLowerCase().indexOf(qLower);
        if (idx !== -1) {
          const before = text.substring(0, idx);
          const matchText = text.substring(idx, idx + qClean.length);
          const after = text.substring(idx + qClean.length);

          const mark = document.createElement('mark');
          mark.className = 'search-finding-highlight';
          mark.textContent = matchText;

          const frag = document.createDocumentFragment();
          if (before) frag.appendChild(document.createTextNode(before));
          frag.appendChild(mark);
          if (after) frag.appendChild(document.createTextNode(after));

          const parent = bestNode.parentElement;
          parent.replaceChild(frag, bestNode);

          createdMark = mark;
          targetEl = mark;
        }
      }
    }

    if (!targetEl && typeof lineNum === 'number') {
      const elements = Array.from(container.querySelectorAll('[data-source-line]'));
      let bestDist = Infinity;
      for (const el of elements) {
        const l = parseInt(el.getAttribute('data-source-line'), 10);
        if (!isNaN(l)) {
          const dist = Math.abs(l - lineNum);
          if (dist < bestDist) {
            bestDist = dist;
            targetEl = el;
          }
        }
      }
    }

    if (!targetEl) {
      targetEl = document.getElementById('preview-lecture-tag') || container.firstElementChild;
    }

    if (targetEl) {
      const blockEl = targetEl.closest('h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote, .table-wrapper, .mermaid-wrapper, .svg-diagram-wrapper, .sticky-note, .board-ref, pre') || targetEl;
      blockEl.classList.add('search-section-highlight');

      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = targetEl.getBoundingClientRect();
      const targetScroll = (elRect.top - containerRect.top + scrollContainer.scrollTop) - (scrollContainer.clientHeight / 2 - elRect.height / 2);
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const clampedScroll = Math.max(0, Math.min(targetScroll, maxScroll));

      scrollContainer.scrollTo({
        top: clampedScroll,
        behavior: 'smooth'
      });

      searchHighlightTimer = setTimeout(() => {
        blockEl.classList.remove('search-section-highlight');
        if (createdMark && createdMark.parentNode) {
          const textNode = document.createTextNode(createdMark.textContent);
          const parent = createdMark.parentNode;
          parent.replaceChild(textNode, createdMark);
          parent.normalize();
        }
      }, 2800);
    }
  }

  /**
   * Main render trigger
   */
  async function updatePreview(markdownText, course, lecture, immediate = false, editInfo = null) {
    if (debounceTimer) clearTimeout(debounceTimer);

    if (editInfo && editInfo.isUserEdit && typeof editInfo.lineIndex === 'number') {
      lastEditLine = editInfo.lineIndex;
      // Scroll immediately so preview reacts instantaneously to edit
      scrollToLine(editInfo.lineIndex, true);
    }

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
              { left: '$', right: '$', display: false },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false,
            errorColor: '#cc0000',
            strict: false
          });
          fitDisplayMath(container);
          fitTables(container);
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

      // 5. Clean up previous annotations to avoid duplicate/orphaned SVG elements
      if (activeAnnotations && activeAnnotations.length > 0) {
        activeAnnotations.forEach(a => {
          try { a.remove(); } catch (e) {}
        });
        activeAnnotations = [];
      }
      container.querySelectorAll('svg.rough-annotation').forEach(s => s.remove());

      // 6. Wait for images to load so elements settle into their final geometric positions
      const images = Array.from(container.querySelectorAll('img'));
      if (images.length > 0) {
        await Promise.all(images.map(img => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
          return new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 600); // 600ms safety timeout
          });
        }));
      }

      // Re-align annotations whenever any image completes or errors
      images.forEach(img => {
        img.addEventListener('load', () => refreshAnnotations());
        img.addEventListener('error', () => refreshAnnotations());
      });

      // 7. Force DOM reflow
      void container.offsetHeight;

      // 8. Draw Rough Notation Annotations
      if (window.RoughNotation) {
        const elements = container.querySelectorAll('[data-rn]');
        const group = [];

        elements.forEach(el => {
          const type = el.getAttribute('data-rn');
          const color = el.getAttribute('data-color') || '#fef08a';
          const isBlock = el.tagName === 'DIV' || el.classList.contains('rn-block-box') || el.classList.contains('rn-block-circle');

          try {
            const isUnderline = type === 'underline';
            const annotation = RoughNotation.annotate(el, {
              type: type,
              color: color,
              padding: isBlock ? 8 : (type === 'circle' ? 6 : (isUnderline ? [0, 2, 2, 2] : 3)),
              strokeWidth: isUnderline ? 2.5 : 2,
              multiline: type === 'highlight',
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

        setupResizeObserver();
      }

      // 9. Bind photo inspection buttons
      container.querySelectorAll('.btn-inspect-board, .board-ref-img-wrapper').forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const photo = btn.getAttribute('data-photo');
          if (photo && window.LectNotePhotoDrawer) {
            window.LectNotePhotoDrawer.openLightbox(photo);
          }
        };
      });

      // 10. After complete layout, images, and KaTeX settle, maintain alignment if user made edit
      if (lastEditLine !== null) {
        scrollToLine(lastEditLine, false);
        lastEditLine = null;
      }
    };

    if (immediate) {
      await execute();
    } else {
      debounceTimer = setTimeout(execute, 300);
    }
  }

  return {
    updatePreview,
    scrollToLine,
    highlightAndScrollSearch,
    clearSearchHighlights
  };
})();


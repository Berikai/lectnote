/**
 * Markdown-it Custom Parser for LectNote
 * Handles:
 * - KaTeX math ($...$ and $$...$$)
 * - Rough Notation spans (==highlight==, [text]{.circle}, [text]{.box}, [text]{.underline})
 * - Sticky notes / Callouts (> [!note] or :::sticky)
 * - Whiteboard photo references (:::board-ref [photo.jpg] "Caption" :::)
 * - Mermaid diagrams (```mermaid)
 * - Vector SVG blocks (```svg)
 */

function createMarkdownParser(options = {}) {
  const MarkdownIt = require('markdown-it');
  
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    ...options
  });

  // 1. Math rules ($...$ and $$...$$) - Keep LaTeX delimiters intact for KaTeX auto-render in browser
  // We protect $$...$$ and $...$ from markdown formatting
  const originalFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.fence = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';

    if (info === 'mermaid') {
      return `<div class="mermaid-wrapper"><div class="mermaid">\n${sanitizeMermaid(token.content)}\n</div></div>`;
    }

    if (info === 'svg') {
      return `<div class="svg-diagram-wrapper">\n${token.content}\n</div>`;
    }

    return originalFence(tokens, idx, options, env, self);
  };

  const defaultTableOpen = md.renderer.rules.table_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  const defaultTableClose = md.renderer.rules.table_close || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.table_open = function(tokens, idx, options, env, self) {
    return '<div class="table-wrapper">\n' + defaultTableOpen(tokens, idx, options, env, self);
  };
  md.renderer.rules.table_close = function(tokens, idx, options, env, self) {
    return defaultTableClose(tokens, idx, options, env, self) + '\n</div>';
  };

  // 2. Custom pre/post-processing for syntax extensions
  return {
    render: function(src, context = {}) {
      if (!src) return '';
      const course = context.course || '';
      const lecture = context.lecture || '';
      const photoBaseUrl = context.photoBaseUrl || (course && lecture ? `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/` : '');

      // Protect code blocks (```...```) and inline code (`...`) from all preprocessing (highlights, annotations, callouts)
      const codeBlocks = [];
      let text = src.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
        const idx = codeBlocks.length;
        codeBlocks.push(match);
        return `LECTNOTECODEPLACEHOLDER${idx}END`;
      });

      // A. Process Callouts: > [!note] Title or > [!tip]
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

      // Handle multiline sticky callout blocks
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
            // Check if next line continues blockquote
            if (i + 1 < lines.length && lines[i + 1].startsWith('>')) {
              stickyContent.push('');
            } else {
              inSticky = false;
              processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${renderWithMath(md, stickyContent.join('\n'), codeBlocks).trim()}</div></aside>`);
              processedLines.push(line);
            }
          } else {
            inSticky = false;
            processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${renderWithMath(md, stickyContent.join('\n'), codeBlocks).trim()}</div></aside>`);
            processedLines.push(line);
          }
        } else {
          processedLines.push(line);
        }
      }

      if (inSticky) {
        processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${renderWithMath(md, stickyContent.join('\n'), codeBlocks).trim()}</div></aside>`);
      }

      text = processedLines.join('\n');

      // B. Process Board References: :::board-ref [photo_1.jpg] [photo_2.jpg] "Caption text" :::
      text = text.replace(/:::\s*board-ref\s+((?:\[[^\]]+\]\s*)+)(?:"([^"]*)")?\s*:::/gi, (match, rawPhotos, caption) => {
        const photos = [];
        for (const bm of rawPhotos.matchAll(/\[([^\]]+)\]/g)) {
          photos.push(...bm[1].split(/[,;\s]+/).map(p => p.trim()).filter(Boolean));
        }
        if (photos.length === 0) return '';

        const cap = caption ? caption.trim() : (photos.length > 1 ? `Whiteboard References (${photos.length} photos)` : `Whiteboard Reference: ${photos[0]}`);

        if (photos.length === 1) {
          const filename = photos[0];
          const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename)}` : filename;
          return `<figure class="board-ref" data-photo="${escapeHtml(filename)}">
            <div class="board-ref-header">
              <span class="board-ref-tag"><svg class="ui-icon" style="width:12px;height:12px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Board Ref</span>
              <span class="board-ref-filename">${escapeHtml(filename)}</span>
              <button type="button" class="btn-inspect-board" data-photo="${escapeHtml(filename)}" title="Inspect in photo drawer"><svg class="ui-icon" style="width:12px;height:12px;margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>Inspect Board</button>
            </div>
            <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename)}">
              <img src="${photoUrl}" alt="${escapeHtml(cap)}" />
            </div>
            <figcaption>${escapeHtml(cap)}</figcaption>
          </figure>`;
        }

        // Multiple photos gallery
        const itemsHtml = photos.map((filename, idx) => {
          const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename)}` : filename;
          return `<div class="board-ref-gallery-item">
            <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename)}" title="Inspect: ${escapeHtml(filename)}">
              <img src="${photoUrl}" alt="Board ${idx + 1}: ${escapeHtml(filename)}" />
              <div class="board-ref-img-badge">Board ${idx + 1}</div>
            </div>
            <div class="board-ref-item-footer">
              <span class="board-ref-item-name">${escapeHtml(filename)}</span>
            </div>
          </div>`;
        }).join('');

        return `<figure class="board-ref board-ref-multi">
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

      // C. Process Highlight Syntax: ==text== or ==#hexcolor:text==
      text = text.replace(/==(?:#([0-9a-fA-F]{3,6}):)?([^=\n]+)==/g, (match, color, content) => {
        const c = color ? `#${color}` : '#fef08a';
        return `<span class="rn-wrapper"><mark class="rn-elem" data-rn="highlight" data-color="${c}">${content}</mark></span>`;
      });

      // D. Auto-wrap standalone LaTeX environments (\begin{aligned} etc.) if not already inside $$
      text = text.replace(/(^|\n)(\\begin\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|vmatrix|cases|equation\*?)\}[\s\S]*?\\end\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|vmatrix|cases|equation\*?)\})/g, (match, prefix, mathBlock) => {
        return `${prefix}$$\n${mathBlock}\n$$`;
      });

      // E. Process Display Math containing Bracket Annotations: $$ prefix [content]{.type} suffix $$
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

      // F. Process Bracketed Annotations with nested bracket support & LaTeX auto-delimiters
      text = replaceBracketAnnotations(text);

      // G. Render markdown with LaTeX math protected from CommonMark unescaping & typography transforms
      let html = renderWithMath(md, text, codeBlocks);

      // G. Post-process Display Math with Box annotation wrapper if any
      // e.g., :::box $$...$$ :::
      html = html.replace(/<p>:::box\s*(#[0-9a-fA-F]{3,6})?<\/p>\s*([\s\S]*?)\s*<p>:::<\/p>/g, (match, color, inner) => {
        const c = color || '#60a5fa';
        return `<div class="rn-wrapper rn-wrapper-block"><div class="rn-elem rn-block-box" data-rn="box" data-color="${c}">\n${inner}\n</div></div>`;
      });

      return html;
    }
  };
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
        let content = text.slice(i + 1, j - 1);
        const remainder = text.slice(j);
        const annotationMatch = remainder.match(/^\s*\{\.(circle|c|box|b|underline|u|uline|u-line|highlight|hl)(?:\s+(#[0-9a-fA-F]{3,6}))?\}/i);
        if (annotationMatch) {
          const type = normalizeType(annotationMatch[1]);
          const color = annotationMatch[2] || getDefaultColor(type);

          if (/(?:^|[^\\])(?:\\\\)*\\left\s*$/.test(result)) {
            result = result.replace(/\\left\s*$/, '');
            content = content.replace(/(?:^|[^\\])(?:\\\\)*\\right\s*$/, '');
          }

          result += transformAnnotation(content, type, color);
          i = j + annotationMatch[0].length;
          continue;
        }
      }
    }
    result += text[i];
    i++;
  }
  return result;
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

function sanitizeMermaid(content) {
  if (!content) return '';
  // Auto-quote unquoted square bracket node labels containing &, (, ), :, or comma
  return content.replace(/(\b[A-Za-z0-9_]+)\[([^"\]\r\n]*?[&():,][^"\]\r\n]*?)\]/g, '$1["$2"]');
}

module.exports = { createMarkdownParser, escapeHtml, sanitizeMathInner, sanitizeMermaid };


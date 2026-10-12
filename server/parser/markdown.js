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
      return `<div class="mermaid-wrapper"><div class="mermaid">\n${token.content}\n</div></div>`;
    }

    if (info === 'svg') {
      return `<div class="svg-diagram-wrapper">\n${token.content}\n</div>`;
    }

    return originalFence(tokens, idx, options, env, self);
  };

  // 2. Custom pre/post-processing for syntax extensions
  return {
    render: function(src, context = {}) {
      if (!src) return '';
      const course = context.course || '';
      const lecture = context.lecture || '';
      const photoBaseUrl = context.photoBaseUrl || (course && lecture ? `/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/photos/` : '');

      let text = src;

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
              processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${md.render(stickyContent.join('\n')).trim()}</div></aside>`);
              processedLines.push(line);
            }
          } else {
            inSticky = false;
            processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${md.render(stickyContent.join('\n')).trim()}</div></aside>`);
            processedLines.push(line);
          }
        } else {
          processedLines.push(line);
        }
      }

      if (inSticky) {
        processedLines.push(`<aside class="sticky-note sticky-${stickyType}"><div class="sticky-pin"></div><div class="sticky-title">${escapeHtml(stickyLabel)}</div><div class="sticky-body">${md.render(stickyContent.join('\n')).trim()}</div></aside>`);
      }

      text = processedLines.join('\n');

      // B. Process Board References: :::board-ref [photo_1.jpg] "Caption text" :::
      text = text.replace(/:::board-ref\s*\[([^\]]+)\]\s*(?:"([^"]*)")?\s*:::/g, (match, filename, caption) => {
        const cap = caption || `Whiteboard Reference: ${filename}`;
        const photoUrl = photoBaseUrl ? `${photoBaseUrl}${encodeURIComponent(filename.trim())}` : filename.trim();
        return `<figure class="board-ref" data-photo="${escapeHtml(filename.trim())}">
          <div class="board-ref-header">
            <span class="board-ref-tag">📷 Whiteboard Ref</span>
            <span class="board-ref-filename">${escapeHtml(filename.trim())}</span>
            <button type="button" class="btn-inspect-board" data-photo="${escapeHtml(filename.trim())}" title="Inspect in photo drawer">🔍 Inspect Board</button>
          </div>
          <div class="board-ref-img-wrapper" data-photo="${escapeHtml(filename.trim())}">
            <img src="${photoUrl}" alt="${escapeHtml(cap)}" loading="lazy" />
          </div>
          <figcaption>${escapeHtml(cap)}</figcaption>
        </figure>`;
      });

      // C. Process Highlight Syntax: ==text== or ==#hexcolor:text==
      text = text.replace(/==(?:#([0-9a-fA-F]{3,6}):)?([^=\n]+)==/g, (match, color, content) => {
        const c = color ? `#${color}` : '#fef08a';
        return `<mark class="rn-elem" data-rn="highlight" data-color="${c}">${content}</mark>`;
      });

      // D. Process Bracketed Span Annotations: [content]{.circle}, [content]{.box}, [content]{.underline}, [content]{.highlight}
      // Supports optional color: [content]{.circle #f87171}
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

      // E. Render markdown
      let html = md.render(text);

      // F. Post-process Display Math with Box annotation wrapper if any
      // e.g., :::box $$...$$ :::
      html = html.replace(/<p>:::box\s*(#[0-9a-fA-F]{3,6})?<\/p>\s*([\s\S]*?)\s*<p>:::<\/p>/g, (match, color, inner) => {
        const c = color || '#60a5fa';
        return `<div class="rn-elem rn-block-box" data-rn="box" data-color="${c}">\n${inner}\n</div>`;
      });

      return html;
    }
  };
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

module.exports = { createMarkdownParser, escapeHtml };


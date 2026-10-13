const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createMarkdownParser } = require('../server/parser/markdown');

describe('LectNote Custom Markdown Parser', () => {
  const parser = createMarkdownParser();

  it('renders standard markdown to HTML', () => {
    const md = '# Physics Lecture\n\nThis is a **test** note.';
    const html = parser.render(md);
    assert.match(html, /<h1[^>]*>Physics Lecture<\/h1>/);
    assert.match(html, /<strong>test<\/strong>/);
  });

  it('protects display and inline KaTeX math delimiters', () => {
    const md = 'The equation is $E = mc^2$ and:\n\n$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$';
    const html = parser.render(md);
    assert.match(html, /\$E = mc\^2\$/);
    assert.match(html, /\$\$\\int_0\^\\infty e\^\{-x\^2\} dx = \\frac\{\\sqrt\{\\pi\}\}\{2\}\$\$/);
  });

  it('parses hand-drawn highlight syntax (==text==)', () => {
    const md = 'This is ==critical concept== in materials science.';
    const html = parser.render(md);
    assert.match(html, /data-rn="highlight"/);
    assert.match(html, /critical concept/);
  });

  it('parses bracketed annotations ([formula]{.circle}, {.box}, {.underline})', () => {
    const md = 'Exam equation: [D = D_0 \\exp(-Q/RT)]{.circle} and definition [J = -D dC/dx]{.box}';
    const html = parser.render(md);
    assert.match(html, /data-rn="circle"/);
    assert.match(html, /data-rn="box"/);
  });

  it('parses sticky callout notes (> [!note] Title)', () => {
    const md = '> [!note] Midterm Insight\n> Review Arrhenius temperature dependence.';
    const html = parser.render(md);
    assert.match(html, /<aside class="sticky-note sticky-note">/);
    assert.match(html, /Midterm Insight/);
    assert.match(html, /Arrhenius temperature dependence/);
  });

  it('parses whiteboard reference figures (:::board-ref [photo.jpg] "Caption" :::)', () => {
    const md = ':::board-ref [diffusion_1.jpg] "Whiteboard: Fick\'s Law Derivation" :::';
    const html = parser.render(md, { course: 'MCE306', lecture: 'lecture-01' });
    assert.match(html, /<figure class="board-ref"/);
    assert.match(html, /data-photo="diffusion_1\.jpg"/);
    assert.match(html, /Whiteboard: Fick&#39;s Law Derivation/);
  });

  it('handles code blocks with syntax highlighting', () => {
    const md = '```javascript\nconst x = 42;\nconsole.log(x);\n```';
    const html = parser.render(md);
    assert.match(html, /<pre class="hljs"><code class="hljs language-javascript">/);
    assert.match(html, /hljs-keyword/);
  });

  it('wraps Mermaid diagram fences in mermaid-wrapper', () => {
    const md = '```mermaid\nflowchart TD\n  A --> B\n```';
    const html = parser.render(md);
    assert.match(html, /<div class="mermaid-wrapper"><div class="mermaid">/);
  });
});

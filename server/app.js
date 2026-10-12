/**
 * LectNote Express Server
 * Serves the web studio UI, handles lecture workspaces, photos, AI ingestion, and PDF exports.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createMarkdownParser } = require('./parser/markdown');
const { transcribeLecture } = require('./ai/index');
const { exportLectureToPdf } = require('./pdf/exporter');

const app = express();
const PORT = process.env.PORT || 3000;
const LECTURES_DIR = path.resolve(__dirname, '..', 'lectures');

// Ensure base lectures directory exists
if (!fs.existsSync(LECTURES_DIR)) {
  fs.mkdirSync(LECTURES_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'web')));

// Configure Multer for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const course = req.params.course || 'default';
      const lecture = req.params.lecture || 'default';
      const safeCourse = course.replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeLecture = lecture.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(LECTURES_DIR, safeCourse, safeLecture, 'photos');
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 150
  }
});

/**
 * 1. List all courses and lectures
 */
app.get('/api/lectures', (req, res) => {
  try {
    const courses = [];
    if (!fs.existsSync(LECTURES_DIR)) return res.json({ courses: [] });

    const courseDirs = fs.readdirSync(LECTURES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));

    for (const cDir of courseDirs) {
      const coursePath = path.join(LECTURES_DIR, cDir.name);
      const lectureDirs = fs.readdirSync(coursePath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'));

      const lectures = lectureDirs.map(lDir => {
        const lPath = path.join(coursePath, lDir.name);
        const mdPath = path.join(lPath, 'notes.md');
        const photosPath = path.join(lPath, 'photos');
        const hasNotes = fs.existsSync(mdPath);
        const photos = fs.existsSync(photosPath)
          ? fs.readdirSync(photosPath).filter(f => !f.startsWith('.'))
          : [];

        return {
          id: lDir.name,
          title: lDir.name.replace(/[-_]/g, ' '),
          hasNotes,
          photoCount: photos.length,
          photos
        };
      });

      courses.push({
        id: cDir.name,
        name: cDir.name.replace(/[-_]/g, ' '),
        lectures
      });
    }

    res.json({ courses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function resolveCourseDir(courseInput) {
  if (!courseInput) return '';
  const safeInput = courseInput.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!fs.existsSync(LECTURES_DIR)) return safeInput;

  const existingCourses = fs.readdirSync(LECTURES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

  // 1. Exact match
  if (existingCourses.includes(safeInput)) return safeInput;

  // 2. Case-insensitive exact match
  const lowerInput = safeInput.toLowerCase();
  const ciMatch = existingCourses.find(c => c.toLowerCase() === lowerInput);
  if (ciMatch) return ciMatch;

  // 3. Normalization match: match by stripped alphanumeric tokens (e.g. "MCE 306" matches "MCE_306_Fundamentals_of_Machine_Design")
  const inputAlpha = safeInput.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (inputAlpha.length >= 4) {
    const tokenMatches = existingCourses.filter(c => {
      const cAlpha = c.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return cAlpha.startsWith(inputAlpha) || cAlpha.includes(inputAlpha);
    });
    if (tokenMatches.length === 1) return tokenMatches[0];
  }

  return safeInput;
}

/**
 * 2. Create new course / lecture workspace
 */
app.post('/api/lectures', (req, res) => {
  try {
    const { course, lecture, subject = 'Engineering', title = 'Lecture Notes' } = req.body;
    if (!course || !lecture) {
      return res.status(400).json({ error: 'course and lecture are required' });
    }

    const safeCourse = resolveCourseDir(course);
    const safeLecture = lecture.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(LECTURES_DIR, safeCourse, safeLecture);
    const photosDir = path.join(dir, 'photos');

    fs.mkdirSync(photosDir, { recursive: true });

    const mdPath = path.join(dir, 'notes.md');
    if (!fs.existsSync(mdPath)) {
      const displayCourse = safeCourse.replace(/[-_]/g, ' ');
      const starterMd = `# ${displayCourse}: ${title}\n\n> [!note] Lecture Overview\n> Notes for ${displayCourse} (${subject}).\n\n## 1. Key Principles\nWrite your concepts and derivations here.\n\n[Fundamental Equation]{.box}\n\n$$E = mc^2$$\n`;
      fs.writeFileSync(mdPath, starterMd, 'utf8');
    }

    res.json({ success: true, course: safeCourse, lecture: safeLecture });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. Get lecture details (markdown & photos list)
 */
app.get('/api/lectures/:course/:lecture', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const lectureDir = path.join(LECTURES_DIR, course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');
    const photosDir = path.join(lectureDir, 'photos');

    if (!fs.existsSync(lectureDir)) {
      return res.status(404).json({ error: 'Lecture not found' });
    }

    const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
    const photos = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
      : [];

    res.json({
      course,
      lecture,
      markdown,
      photos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Update lecture markdown
 */
app.put('/api/lectures/:course/:lecture', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { markdown } = req.body;
    const lectureDir = path.join(LECTURES_DIR, course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');

    if (!fs.existsSync(lectureDir)) {
      fs.mkdirSync(lectureDir, { recursive: true });
    }

    fs.writeFileSync(mdPath, markdown || '', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5. Upload photos for a lecture
 */
app.post('/api/lectures/:course/:lecture/upload', (req, res) => {
  upload.array('photos', 150)(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err);
      return res.status(400).json({ success: false, error: err.message || 'Photo upload failed' });
    }
    const uploaded = (req.files || []).map(f => f.filename);
    res.json({ success: true, uploaded });
  });
});

/**
 * 6. Serve a specific photo
 */
app.get('/api/lectures/:course/:lecture/photos/:photo', (req, res) => {
  const { course, lecture, photo } = req.params;
  let filePath = path.join(LECTURES_DIR, course, lecture, 'photos', photo);
  if (!fs.existsSync(filePath)) {
    // Try alternate extensions (.png, .jpg, .jpeg, .webp, .svg)
    const baseName = photo.replace(/\.[^.]+$/, '');
    const altExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
    for (const ext of altExts) {
      const candidate = path.join(LECTURES_DIR, course, lecture, 'photos', baseName + ext);
      if (fs.existsSync(candidate)) {
        filePath = candidate;
        break;
      }
    }
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Photo not found');
  }
  res.sendFile(filePath);
});

/**
 * 7. AI Ingestion Endpoint
 */
app.post('/api/lectures/:course/:lecture/ai-transcribe', async (req, res) => {
  try {
    const { course, lecture } = req.params;
    const {
      provider = 'gemini',
      apiKey,
      baseUrl,
      model,
      subject,
      lectureTitle,
      customInstructions
    } = req.body;

    const targetCourse = req.body.course || course;
    const lectureDir = path.join(LECTURES_DIR, course, lecture);
    const photosDir = path.join(lectureDir, 'photos');
    const photos = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
      : [];

    const generatedMarkdown = await transcribeLecture({
      provider,
      apiKey: apiKey || process.env.GEMINI_API_KEY,
      baseUrl,
      model,
      course: targetCourse,
      subject: subject || 'Engineering',
      lectureTitle: lectureTitle || lecture,
      photos,
      photoDir: photosDir,
      customInstructions
    });

    // Automatically update notes.md
    const mdPath = path.join(lectureDir, 'notes.md');
    fs.writeFileSync(mdPath, generatedMarkdown, 'utf8');

    res.json({ success: true, markdown: generatedMarkdown });
  } catch (err) {
    console.error('AI Transcribe error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 8. Render Standalone / Printable HTML View
 */
app.get('/api/lectures/:course/:lecture/render', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const theme = req.query.theme || 'notebook'; // 'notebook' or 'academic'
    const lectureDir = path.join(LECTURES_DIR, course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');

    if (!fs.existsSync(mdPath)) {
      return res.status(404).send('Notes not found');
    }

    const markdown = fs.readFileSync(mdPath, 'utf8');
    const parser = createMarkdownParser();
    const renderedBody = parser.render(markdown, { course, lecture });

    const html = generateStandaloneHtml({
      title: `${course}: ${lecture.replace(/[-_]/g, ' ')}`,
      renderedBody,
      theme,
      course,
      lecture
    });

    res.send(html);
  } catch (err) {
    res.status(500).send(`Render error: ${err.message}`);
  }
});

/**
 * 9. Export to PDF via Headless Puppeteer
 */
app.post('/api/lectures/:course/:lecture/export-pdf', async (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { theme = 'notebook' } = req.body;

    const renderUrl = `http://localhost:${PORT}/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/render?theme=${theme}`;
    const lectureDir = path.join(LECTURES_DIR, course, lecture);
    const pdfPath = path.join(lectureDir, `${lecture}_notes.pdf`);

    const pdfBuffer = await exportLectureToPdf({
      url: renderUrl,
      outputPath: pdfPath,
      theme
    });

    const finalBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', finalBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(course)}_${encodeURIComponent(lecture)}.pdf"`);
    res.end(finalBuffer);
  } catch (err) {
    console.error('PDF Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Standalone HTML Generator helper
 */
function generateStandaloneHtml({ title, renderedBody, theme, course, lecture }) {
  const isAcademic = theme === 'academic';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Patrick+Hand&family=Fira+Code:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- KaTeX -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>

  <!-- Rough Notation -->
  <script src="/vendor/rough-notation.iife.js"></script>

  <!-- Mermaid -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js"></script>

  <!-- Theme CSS -->
  <link rel="stylesheet" href="/styles/theme-${isAcademic ? 'academic' : 'notebook'}.css">
</head>
<body class="theme-${theme}">
  <main class="page-container ${isAcademic ? 'academic-paper' : 'notebook-paper'}">
    <div class="note-meta-header">
      <span class="note-course-tag">${course}</span>
      <span class="note-title-tag">${lecture.replace(/[-_]/g, ' ')}</span>
    </div>

    <div id="render-content" class="content-body">
      ${renderedBody}
    </div>
  </main>

  <script>
    window.__LECTNOTE_READY__ = false;

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

    async function initRender() {
      try {
        // 1. Wait for scripts & fonts to be ready
        let attempts = 0;
        while ((!window.renderMathInElement || !window.mermaid || !window.RoughNotation) && attempts < 30) {
          await new Promise(r => setTimeout(r, 50));
          attempts++;
        }
        try {
          await document.fonts.ready;
        } catch (e) {}

        const container = document.getElementById('render-content');

        // 2. Render KaTeX Math
        if (window.renderMathInElement && container) {
          try {
            renderMathInElement(container, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\\\[', right: '\\\\]', display: true },
                { left: '\\\\(', right: '\\\\)', display: false }
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

        // 3. Render Mermaid
        if (window.mermaid) {
          try {
            mermaid.initialize({ startOnLoad: false, theme: '${isAcademic ? 'default' : 'neutral'}' });
            await mermaid.run({ querySelector: '.mermaid' });
          } catch (e) {
            console.warn('Mermaid render error:', e);
          }
        }

        // 4. Wait for images to finish loading so layout heights are settled
        const images = Array.from(document.querySelectorAll('img'));
        if (images.length > 0) {
          await Promise.all(images.map(img => {
            if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
            return new Promise(resolve => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 800);
            });
          }));
        }

        // 5. Force browser layout reflow
        void document.body.offsetHeight;

        // 6. Annotate with Rough Notation
        if (window.RoughNotation) {
          try {
            const elements = document.querySelectorAll('[data-rn]');
            const group = [];
            elements.forEach(el => {
              const type = el.getAttribute('data-rn');
              const color = el.getAttribute('data-color') || '#fef08a';
              const isBlock = el.tagName === 'DIV' || el.classList.contains('rn-block-box') || el.classList.contains('rn-block-circle');
              const isUnderline = type === 'underline';
              const annotation = RoughNotation.annotate(el, {
                type: type,
                color: color,
                padding: isBlock ? 8 : (type === 'circle' ? 6 : (isUnderline ? [0, 2, 2, 2] : 3)),
                strokeWidth: isUnderline ? 2.5 : 2,
                multiline: type === 'highlight',
                iterations: 2,
                animate: false
              });
              group.push(annotation);
            });

            if (group.length > 0) {
              const annotationGroup = RoughNotation.annotationGroup(group);
              annotationGroup.show();
              window.__RN_GROUP__ = annotationGroup;
            }
          } catch (e) {
            console.warn('RoughNotation error:', e);
          }
        }

        window.addEventListener('resize', () => {
          fitDisplayMath(container);
          fitTables(container);
          if (window.__RN_GROUP__) {
            window.__RN_GROUP__.show();
          }
        });

        // 7. Bind board photo inspection buttons
        document.querySelectorAll('.btn-inspect-board, .board-ref-img-wrapper').forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            const photo = btn.getAttribute('data-photo');
            if (photo) {
              window.open('/api/lectures/' + encodeURIComponent('${course}') + '/' + encodeURIComponent('${lecture}') + '/photos/' + encodeURIComponent(photo), '_blank');
            }
          };
        });
      } catch (e) {
        console.error('Render error:', e);
      } finally {
        // Signal readiness for Puppeteer PDF generator
        window.__LECTNOTE_READY__ = true;
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      // Small timeout to allow layout settlement
      setTimeout(initRender, 100);
    });
  </script>
</body>
</html>`;
}

// Global error handling middleware - always returns JSON
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`LectNote Studio running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };


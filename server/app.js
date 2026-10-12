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
  destination: (req, cb) => {
    const { course, lecture } = req.params;
    const dest = path.join(LECTURES_DIR, course, lecture, 'photos');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage });

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

/**
 * 2. Create new course / lecture workspace
 */
app.post('/api/lectures', (req, res) => {
  try {
    const { course, lecture, subject = 'Engineering', title = 'Lecture Notes' } = req.body;
    if (!course || !lecture) {
      return res.status(400).json({ error: 'course and lecture are required' });
    }

    const safeCourse = course.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeLecture = lecture.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(LECTURES_DIR, safeCourse, safeLecture);
    const photosDir = path.join(dir, 'photos');

    fs.mkdirSync(photosDir, { recursive: true });

    const mdPath = path.join(dir, 'notes.md');
    if (!fs.existsSync(mdPath)) {
      const starterMd = `# ${safeCourse}: ${title}\n\n> [!note] Lecture Overview\n> Notes for ${safeCourse} (${subject}).\n\n## 1. Key Principles\nWrite your concepts and derivations here.\n\n[Fundamental Equation]{.box}\n\n$$E = mc^2$$\n`;
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
app.post('/api/lectures/:course/:lecture/upload', upload.array('photos', 50), (req, res) => {
  try {
    const uploaded = (req.files || []).map(f => f.filename);
    res.json({ success: true, uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 6. Serve a specific photo
 */
app.get('/api/lectures/:course/:lecture/photos/:photo', (req, res) => {
  const { course, lecture, photo } = req.params;
  const filePath = path.join(LECTURES_DIR, course, lecture, 'photos', photo);
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
      course,
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
    res.status(500).json({ error: err.message });
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${course}_${lecture}.pdf"`);
    res.send(pdfBuffer);
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

    async function initRender() {
      try {
        // 1. Wait for fonts to be ready
        await document.fonts.ready;

        // 2. Render KaTeX Math
        if (window.renderMathInElement) {
          renderMathInElement(document.getElementById('render-content'), {
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
        }

        // 3. Render Mermaid
        if (window.mermaid) {
          mermaid.initialize({ startOnLoad: false, theme: '${isAcademic ? 'default' : 'neutral'}' });
          await mermaid.run({ querySelector: '.mermaid' });
        }

        // 4. Force browser layout reflow
        void document.body.offsetHeight;

        // 5. Annotate with Rough Notation
        if (window.RoughNotation) {
          const elements = document.querySelectorAll('[data-rn]');
          const group = [];
          elements.forEach(el => {
            const type = el.getAttribute('data-rn');
            const color = el.getAttribute('data-color') || '#fef08a';
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
          });

          if (group.length > 0) {
            const annotationGroup = RoughNotation.annotationGroup(group);
            annotationGroup.show();
          }
        }
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

app.listen(PORT, () => {
  console.log(`LectNote Studio running at http://localhost:${PORT}`);
});

module.exports = { app };


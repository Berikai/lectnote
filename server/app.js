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
const { askStudyAssistant } = require('./ai/chat');
const { exportLectureToPdf } = require('./pdf/exporter');

const app = express();
const PORT = process.env.PORT || 3000;
function resolveDefaultLecturesDir() {
  if (process.env.LECTURES_DIR) {
    return path.resolve(process.env.LECTURES_DIR);
  }
  const candidate = path.resolve(__dirname, '..', 'lectures');
  // If running inside a packaged Electron app (.asar), never target inside the read-only archive
  if (candidate.includes('.asar')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      return path.join(home, 'Documents', 'LectNote', 'lectures');
    }
  }
  return candidate;
}

let lecturesDir = resolveDefaultLecturesDir();

function getLecturesDir() {
  return lecturesDir;
}

function ensureLecturesDirExists(dir) {
  if (!dir || dir.includes('.asar')) return;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn(`Unable to create lectures directory at ${dir}:`, err.message);
  }
}

function setLecturesDir(newDir) {
  if (!newDir) return;
  lecturesDir = path.resolve(newDir);
  ensureLecturesDirExists(lecturesDir);
}

// Ensure base lectures directory exists (only if outside .asar archive)
ensureLecturesDirExists(lecturesDir);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'web')));

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  // Strip null bytes and control chars, normalize slashes and backslashes
  const clean = name.replace(/[\0\r\n/\\]/g, '_').trim();
  // Disallow dot-only segments (. or ..)
  if (clean === '.' || clean === '..') return '';
  return clean;
}

function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'photo';
  const clean = filename.replace(/[\0\r\n/\\]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (clean === '.' || clean === '..') return 'photo';
  return clean;
}

function getSafeCoursePath(course) {
  const safeCourse = sanitizeIdentifier(course);
  if (!safeCourse || safeCourse.includes('..')) {
    throw new Error('Invalid course identifier');
  }
  const fullPath = path.resolve(getLecturesDir(), safeCourse);
  const rel = path.relative(getLecturesDir(), fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new Error('Course path traversal detected');
  }
  return { safeCourse, fullPath };
}

function getSafeLecturePath(course, lecture) {
  const { safeCourse, fullPath: coursePath } = getSafeCoursePath(course);
  const safeLecture = sanitizeIdentifier(lecture);
  if (!safeLecture || safeLecture.includes('..')) {
    throw new Error('Invalid lecture identifier');
  }
  const fullPath = path.resolve(coursePath, safeLecture);
  const rel = path.relative(getLecturesDir(), fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Lecture path traversal detected');
  }
  return { safeCourse, safeLecture, fullPath };
}

function getSafePhotoPath(course, lecture, photo) {
  const { safeCourse, safeLecture, fullPath: lecturePath } = getSafeLecturePath(course, lecture);
  const safePhoto = sanitizeFilename(photo);
  if (!safePhoto || safePhoto.includes('..')) {
    throw new Error('Invalid photo identifier');
  }
  const photosDir = path.resolve(lecturePath, 'photos');
  const fullPath = path.resolve(photosDir, safePhoto);
  const rel = path.relative(photosDir, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Photo path traversal detected');
  }
  return { safeCourse, safeLecture, safePhoto, fullPath };
}

// Supported photo extensions and MIME types
const ALLOWED_PHOTO_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp', '.tiff', '.heic'
]);
const ALLOWED_PHOTO_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  'image/bmp', 'image/tiff', 'image/heic'
]);

function photoFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_PHOTO_EXTS.has(ext) || ALLOWED_PHOTO_MIMES.has(mime) || mime.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type "${ext || 'unknown'}". Only whiteboard images (${Array.from(ALLOWED_PHOTO_EXTS).join(', ')}) are supported.`));
  }
}

// Configure Multer for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const course = req.params.course || 'default';
      const lecture = req.params.lecture || 'default';
      const { fullPath } = getSafeLecturePath(course, lecture);
      const dest = path.join(fullPath, 'photos');
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeFilename(file.originalname));
  }
});
const upload = multer({
  storage,
  fileFilter: photoFileFilter,
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
    const currentDir = getLecturesDir();
    if (!fs.existsSync(currentDir)) return res.json({ courses: [] });

    const courseDirs = fs.readdirSync(currentDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));

    for (const cDir of courseDirs) {
      const coursePath = path.join(currentDir, cDir.name);
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
 * 1b. Search across all courses, lectures, and notes
 */
app.get('/api/search', (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) {
      return res.json({ results: [] });
    }

    const currentDir = getLecturesDir();
    if (!fs.existsSync(currentDir)) return res.json({ results: [] });

    const results = [];
    const courseDirs = fs.readdirSync(currentDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));

    for (const cDir of courseDirs) {
      const coursePath = path.join(currentDir, cDir.name);
      const lectureDirs = fs.readdirSync(coursePath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'));

      for (const lDir of lectureDirs) {
        const lPath = path.join(coursePath, lDir.name);
        const mdPath = path.join(lPath, 'notes.md');
        const courseDisplay = cDir.name.replace(/[-_]/g, ' ');
        const lectureDisplay = lDir.name.replace(/[-_]/g, ' ');

        let matched = false;
        let matchCount = 0;

        // Check markdown content
        if (fs.existsSync(mdPath)) {
          const content = fs.readFileSync(mdPath, 'utf8');
          const lowerContent = content.toLowerCase();
          let startIndex = 0;

          while (matchCount < 3) {
            const matchIdx = lowerContent.indexOf(query, startIndex);
            if (matchIdx === -1) break;

            const lineNumber = content.substring(0, matchIdx).split('\n').length - 1;
            const start = Math.max(0, matchIdx - 50);
            const end = Math.min(content.length, matchIdx + query.length + 60);
            const snippet = (start > 0 ? '...' : '') + content.substring(start, end).replace(/\n+/g, ' ').trim() + (end < content.length ? '...' : '');

            results.push({
              course: cDir.name,
              courseDisplay,
              lecture: lDir.name,
              lectureDisplay,
              matchType: 'content',
              matchIdx,
              lineNumber,
              query: (req.query.q || '').trim(),
              snippet
            });

            matched = true;
            matchCount++;
            startIndex = matchIdx + Math.max(1, query.length);
          }
        }

        // Check course or lecture title match if no content matches found
        if (!matched && (cDir.name.toLowerCase().includes(query) || lDir.name.toLowerCase().includes(query))) {
          results.push({
            course: cDir.name,
            courseDisplay,
            lecture: lDir.name,
            lectureDisplay,
            matchType: 'title',
            matchIdx: 0,
            lineNumber: 0,
            query: (req.query.q || '').trim(),
            snippet: `Lecture in ${courseDisplay}`
          });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function resolveCourseDir(courseInput) {
  if (!courseInput) return '';
  const safeInput = courseInput.replace(/[^a-zA-Z0-9_-]/g, '_');
  const currentDir = getLecturesDir();
  if (!fs.existsSync(currentDir)) return safeInput;

  const existingCourses = fs.readdirSync(currentDir, { withFileTypes: true })
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
    const { fullPath: dir, safeLecture } = getSafeLecturePath(safeCourse, lecture);
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
    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');
    const photosDir = path.join(lectureDir, 'photos');
    const annoPath = path.join(lectureDir, 'annotations.json');

    if (!fs.existsSync(lectureDir)) {
      return res.status(404).json({ error: 'Lecture not found' });
    }

    const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
    let annotations = { version: 1, stickies: [], drawings: [] };
    if (fs.existsSync(annoPath)) {
      try {
        annotations = JSON.parse(fs.readFileSync(annoPath, 'utf8'));
      } catch (_) {}
    }
    const photos = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
      : [];

    res.json({
      course: safeCourse,
      lecture: safeLecture,
      markdown,
      annotations,
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
    const { fullPath: lectureDir } = getSafeLecturePath(course, lecture);
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
 * 4d. Get lecture annotations (sticky notes & freehand drawings)
 */
app.get('/api/lectures/:course/:lecture/annotations', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const annoPath = path.join(lectureDir, 'annotations.json');

    if (!fs.existsSync(lectureDir)) {
      return res.status(404).json({ error: 'Lecture not found' });
    }

    let annotations = { version: 1, stickies: [], drawings: [] };
    if (fs.existsSync(annoPath)) {
      try {
        annotations = JSON.parse(fs.readFileSync(annoPath, 'utf8'));
      } catch (_) {}
    }

    res.json({
      course: safeCourse,
      lecture: safeLecture,
      annotations
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4e. Update lecture annotations (sticky notes & freehand drawings)
 */
app.put('/api/lectures/:course/:lecture/annotations', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const annoPath = path.join(lectureDir, 'annotations.json');

    if (!fs.existsSync(lectureDir)) {
      fs.mkdirSync(lectureDir, { recursive: true });
    }

    const { annotations } = req.body;
    const dataToSave = {
      version: 1,
      updatedAt: new Date().toISOString(),
      stickies: Array.isArray(annotations?.stickies) ? annotations.stickies : [],
      drawings: Array.isArray(annotations?.drawings) ? annotations.drawings : []
    };

    fs.writeFileSync(annoPath, JSON.stringify(dataToSave, null, 2), 'utf8');
    res.json({ success: true, course: safeCourse, lecture: safeLecture, annotations: dataToSave });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4b. Delete lecture
 */
app.delete('/api/lectures/:course/:lecture', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { fullPath: lectureDir } = getSafeLecturePath(course, lecture);

    if (!fs.existsSync(lectureDir)) {
      return res.status(404).json({ error: 'Lecture not found' });
    }

    fs.rmSync(lectureDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4c. Rename lecture
 */
app.post('/api/lectures/:course/:lecture/rename', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { newLecture } = req.body;
    if (!newLecture) {
      return res.status(400).json({ error: 'New lecture name is required' });
    }

    const { fullPath: oldPath, safeCourse } = getSafeLecturePath(course, lecture);
    const { fullPath: newPath, safeLecture: nextSafeLecture } = getSafeLecturePath(course, newLecture);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'Lecture not found' });
    }

    const isCaseChangeOnly = oldPath.toLowerCase() === newPath.toLowerCase();

    if (fs.existsSync(newPath) && !isCaseChangeOnly) {
      return res.status(400).json({ error: 'A lecture with this name already exists' });
    }

    if (isCaseChangeOnly && oldPath !== newPath) {
      const tempPath = `${oldPath}__case_tmp_${Date.now()}`;
      fs.renameSync(oldPath, tempPath);
      fs.renameSync(tempPath, newPath);
    } else if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }

    res.json({ success: true, course: safeCourse, lecture: nextSafeLecture });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4d. Delete course
 */
app.delete('/api/courses/:course', (req, res) => {
  try {
    const { course } = req.params;
    const { fullPath: courseDir } = getSafeCoursePath(course);

    if (!fs.existsSync(courseDir)) {
      return res.status(404).json({ error: 'Course not found' });
    }

    fs.rmSync(courseDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4e. Rename course
 */
app.post('/api/courses/:course/rename', (req, res) => {
  try {
    const { course } = req.params;
    const { newCourse } = req.body;
    if (!newCourse) {
      return res.status(400).json({ error: 'New course name is required' });
    }

    const { fullPath: oldPath } = getSafeCoursePath(course);
    const { fullPath: newPath, safeCourse: nextSafeCourse } = getSafeCoursePath(newCourse);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const isCaseChangeOnly = oldPath.toLowerCase() === newPath.toLowerCase();

    if (fs.existsSync(newPath) && !isCaseChangeOnly) {
      return res.status(400).json({ error: 'A course with this name already exists' });
    }

    if (isCaseChangeOnly && oldPath !== newPath) {
      const tempPath = `${oldPath}__case_tmp_${Date.now()}`;
      fs.renameSync(oldPath, tempPath);
      fs.renameSync(tempPath, newPath);
    } else if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }

    res.json({ success: true, course: nextSafeCourse });
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
  try {
    const { course, lecture, photo } = req.params;
    const { fullPath: filePath, safeCourse, safeLecture } = getSafePhotoPath(course, lecture, photo);

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    // Try alternate extensions (.png, .jpg, .jpeg, .webp, .svg)
    const baseName = photo.replace(/\.[^.]+$/, '');
    const altExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
    const photosDir = path.resolve(getLecturesDir(), safeCourse, safeLecture, 'photos');
    for (const ext of altExts) {
      const candidate = path.resolve(photosDir, baseName + ext);
      if (fs.existsSync(candidate) && !path.relative(photosDir, candidate).startsWith('..')) {
        return res.sendFile(candidate);
      }
    }

    return res.status(404).send('Photo not found');
  } catch (err) {
    return res.status(400).send(`Invalid photo request: ${err.message}`);
  }
});

/**
 * 6b. Delete a specific photo
 */
app.delete('/api/lectures/:course/:lecture/photos/:photo', (req, res) => {
  try {
    const { course, lecture, photo } = req.params;
    const { fullPath: filePath } = getSafePhotoPath(course, lecture, photo);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const photosDir = path.join(lectureDir, 'photos');
    const photos = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
      : [];

    const generatedMarkdown = await transcribeLecture({
      provider,
      apiKey: apiKey || process.env.GEMINI_API_KEY,
      baseUrl,
      model,
      course: safeCourse,
      subject: subject || 'Engineering',
      lectureTitle: lectureTitle || safeLecture,
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
 * 7b. Get study assistant chat history for a lecture
 */
app.get('/api/lectures/:course/:lecture/chat', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { fullPath: lectureDir } = getSafeLecturePath(course, lecture);
    const chatPath = path.join(lectureDir, 'chat_history.json');
    if (!fs.existsSync(chatPath)) {
      return res.json({ history: [] });
    }
    const history = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7c. Post message to study assistant
 */
app.post('/api/lectures/:course/:lecture/chat', async (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { message, provider, apiKey, model, baseUrl } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');
    const notesContent = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';

    const photosDir = path.join(lectureDir, 'photos');
    const photos = fs.existsSync(photosDir)
      ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
      : [];

    const chatPath = path.join(lectureDir, 'chat_history.json');
    let history = [];
    if (fs.existsSync(chatPath)) {
      try {
        history = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
      } catch (e) {
        history = [];
      }
    }

    const reply = await askStudyAssistant({
      course: safeCourse,
      lecture: safeLecture,
      message: message.trim(),
      history,
      notesContent,
      photos,
      provider: provider || 'gemini',
      apiKey: apiKey || process.env.GEMINI_API_KEY,
      model,
      baseUrl
    });

    history.push({
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString()
    });
    history.push({
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(chatPath, JSON.stringify(history, null, 2), 'utf8');
    res.json({ success: true, reply, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7d. Clear chat history for a lecture
 */
app.delete('/api/lectures/:course/:lecture/chat', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { fullPath: lectureDir } = getSafeLecturePath(course, lecture);
    const chatPath = path.join(lectureDir, 'chat_history.json');
    if (fs.existsSync(chatPath)) {
      fs.unlinkSync(chatPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7e. Append assistant explanation into lecture notes.md
 */
app.post('/api/lectures/:course/:lecture/chat/append', (req, res) => {
  try {
    const { course, lecture } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const { fullPath: lectureDir } = getSafeLecturePath(course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');
    const existing = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
    const updated = existing.trim() + '\n\n' + content.trim() + '\n';
    fs.writeFileSync(mdPath, updated, 'utf8');
    res.json({ success: true, markdown: updated });
  } catch (err) {
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
    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);
    const mdPath = path.join(lectureDir, 'notes.md');
    const annoPath = path.join(lectureDir, 'annotations.json');

    if (!fs.existsSync(mdPath)) {
      return res.status(404).send('Notes not found');
    }

    const markdown = fs.readFileSync(mdPath, 'utf8');
    let annotations = null;
    if (fs.existsSync(annoPath)) {
      try {
        annotations = JSON.parse(fs.readFileSync(annoPath, 'utf8'));
      } catch (_) {}
    }
    const parser = createMarkdownParser();
    const renderedBody = parser.render(markdown, { course: safeCourse, lecture: safeLecture });

    const cleanCourse = safeCourse.replace(/[-_]/g, ' ');
    const cleanLecture = safeLecture.replace(/[-_]/g, ' ');

    const html = generateStandaloneHtml({
      title: `${cleanCourse}: ${cleanLecture}`,
      renderedBody,
      theme,
      course: safeCourse,
      lecture: safeLecture,
      annotations
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
    const { fullPath: lectureDir, safeCourse, safeLecture } = getSafeLecturePath(course, lecture);

    const actualPort = req.socket.localPort || PORT;
    const renderUrl = `http://localhost:${actualPort}/api/lectures/${encodeURIComponent(safeCourse)}/${encodeURIComponent(safeLecture)}/render?theme=${theme}`;
    const pdfPath = path.join(lectureDir, `${safeLecture}_notes.pdf`);

    const pdfBuffer = await exportLectureToPdf({
      url: renderUrl,
      outputPath: pdfPath,
      theme
    });

    const finalBuffer = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', finalBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeCourse)}_${encodeURIComponent(safeLecture)}.pdf"`);
    res.end(finalBuffer);
  } catch (err) {
    console.error('PDF Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 10. Workspace Settings API & AI Diagnostics
 */
let runtimeSettings = {
  aiProvider: 'gemini',
  aiModel: 'gemini-2.5-flash',
  aiBaseUrl: ''
};

app.get('/api/settings', (req, res) => {
  res.json({
    lecturesDir: getLecturesDir(),
    isElectron: false,
    hasEnvGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    aiProvider: runtimeSettings.aiProvider,
    aiModel: runtimeSettings.aiModel,
    aiBaseUrl: runtimeSettings.aiBaseUrl
  });
});

app.post('/api/settings', (req, res) => {
  try {
    const { lecturesDir: newDir, aiProvider, aiModel, aiBaseUrl } = req.body;
    if (newDir && typeof newDir === 'string') {
      setLecturesDir(newDir);
    }
    if (aiProvider) runtimeSettings.aiProvider = aiProvider;
    if (aiModel) runtimeSettings.aiModel = aiModel;
    if (aiBaseUrl !== undefined) runtimeSettings.aiBaseUrl = aiBaseUrl;

    res.json({
      success: true,
      lecturesDir: getLecturesDir(),
      hasEnvGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      aiProvider: runtimeSettings.aiProvider,
      aiModel: runtimeSettings.aiModel,
      aiBaseUrl: runtimeSettings.aiBaseUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/test-ai', async (req, res) => {
  try {
    const { provider = 'gemini', apiKey, model, baseUrl } = req.body;
    const effectiveKey = apiKey || process.env.GEMINI_API_KEY;

    if (provider === 'offline' || provider === 'manual') {
      return res.json({
        success: true,
        message: 'Offline mode active. No external API key required!'
      });
    }

    if (!effectiveKey) {
      return res.status(400).json({
        error: `API key is required for ${provider === 'gemini' ? 'Google Gemini' : provider}.`
      });
    }

    if (provider === 'gemini') {
      const targetModel = (model || 'gemini-2.5-flash').trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Respond with READY.' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let errMsg = `Gemini API error (${resp.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) errMsg = parsed.error.message;
        } catch (_) {
          errMsg = errText.substring(0, 150);
        }
        return res.status(400).json({ error: errMsg });
      }

      return res.json({
        success: true,
        message: `Connected successfully to Google Gemini (${targetModel})!`
      });
    }

    if (provider === 'deepseek' || provider === 'openai') {
      const targetBase = baseUrl || (provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1');
      const targetModel = model || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o');
      const endpoint = `${targetBase.replace(/\/+$/, '')}/chat/completions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${effectiveKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        let errMsg = `API error (${resp.status})`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) errMsg = parsed.error.message;
        } catch (_) {
          errMsg = errText.substring(0, 150);
        }
        return res.status(400).json({ error: errMsg });
      }

      return res.json({
        success: true,
        message: `Connected successfully to ${provider === 'deepseek' ? 'DeepSeek' : 'OpenAI'} (${targetModel})!`
      });
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Standalone HTML Generator helper
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateStandaloneHtml({ title, renderedBody, theme, course, lecture, annotations }) {
  const isAcademic = theme === 'academic';
  const displayCourse = (course || '').replace(/[-_]/g, ' ');
  const displayLecture = (lecture || '').replace(/[-_]/g, ' ');

  let annotationsHtml = '';
  if (annotations && (
    (Array.isArray(annotations.drawings) && annotations.drawings.length > 0) ||
    (Array.isArray(annotations.stickies) && annotations.stickies.length > 0)
  )) {
    const drawings = Array.isArray(annotations.drawings) ? annotations.drawings : [];
    const stickies = Array.isArray(annotations.stickies) ? annotations.stickies : [];

    const pathElements = drawings.map(d => {
      if (!d.path) return '';
      const strokeColor = escapeHtml(d.color || '#e11d48');
      const strokeWidth = d.size || 2.5;
      const opacity = typeof d.opacity === 'number' ? d.opacity : (d.tool === 'highlighter' ? 0.45 : 1.0);
      const blend = d.tool === 'highlighter' ? 'mix-blend-mode: multiply;' : '';
      return `<path d="${escapeHtml(d.path)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity}" style="${blend}" />`;
    }).join('\n');

    const stickyElements = stickies.map(s => {
      const color = escapeHtml(s.color || 'yellow');
      const x = typeof s.x === 'number' ? s.x : 100;
      const y = typeof s.y === 'number' ? s.y : 100;
      const w = typeof s.width === 'number' ? s.width : 200;
      const h = typeof s.height === 'number' ? s.height : 160;
      const text = escapeHtml(s.text || '');
      return `
        <div class="floating-sticky-note sticky-color-${color}" style="left: ${x}px; top: ${y}px; width: ${w}px; min-height: ${h}px;">
          <div class="sticky-note-header">
            <span class="sticky-pin-icon">📌</span>
            <span class="sticky-note-title">Note</span>
          </div>
          <div class="sticky-note-content">${text}</div>
        </div>`;
    }).join('\n');

    annotationsHtml = `
      <div id="preview-annotations-layer" class="preview-annotations-layer standalone-annotations">
        <svg id="drawing-svg-canvas" class="drawing-svg-canvas" xmlns="http://www.w3.org/2000/svg">
          <g id="drawing-strokes-group">
            ${pathElements}
          </g>
        </svg>
        <div id="sticky-notes-container" class="sticky-notes-container">
          ${stickyElements}
        </div>
      </div>
    `;
  }

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

  <!-- KaTeX (Offline local vendor) -->
  <link rel="stylesheet" href="/vendor/katex/katex.min.css">
  <script defer src="/vendor/katex/katex.min.js"></script>
  <script defer src="/vendor/katex/contrib/auto-render.min.js"></script>

  <!-- Rough Notation -->
  <script src="/vendor/rough-notation.iife.js"></script>

  <!-- Mermaid (Offline local vendor) -->
  <script src="/vendor/mermaid.min.js"></script>

  <!-- Highlight.js Syntax Theme -->
  <link rel="stylesheet" href="/vendor/highlight-github.min.css">

  <!-- Main & Theme CSS -->
  <link rel="stylesheet" href="/styles/main.css">
  <link rel="stylesheet" href="/styles/theme-${isAcademic ? 'academic' : 'notebook'}.css">
</head>
<body class="theme-${theme}">
  <main class="${isAcademic ? 'academic-paper' : 'notebook-paper'}">
    <div class="note-meta-header">
      <div class="meta-tag-pill note-course-tag">${displayCourse}</div>
      <div class="meta-title-text note-title-tag">${displayLecture}</div>
    </div>

    <div id="render-content" class="content-body">
      ${renderedBody}
    </div>

    ${annotationsHtml}
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

function startServer(port = PORT, initialLecturesDir = null, host = process.env.HOST || '127.0.0.1') {
  if (initialLecturesDir) {
    setLecturesDir(initialLecturesDir);
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actualPort = server.address().port;
      console.log(`LectNote Studio running at http://${host}:${actualPort}`);
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  getLecturesDir,
  setLecturesDir,
  sanitizeIdentifier,
  getSafeCoursePath,
  getSafeLecturePath,
  getSafePhotoPath
};



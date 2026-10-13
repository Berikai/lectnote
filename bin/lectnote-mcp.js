#!/usr/bin/env node
/**
 * LectNote: Model Context Protocol (MCP) Server
 * Exposes LectNote courses, lectures, whiteboard photos, notes, and study chat
 * to external AI hosts (Claude Desktop, Cursor, Antigravity, etc.) over stdio JSON-RPC.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getLecturesDir, setLecturesDir, sanitizeIdentifier } = require('../server/app');

function resolveMcpLecturesDir() {
  if (process.env.LECTURES_DIR) {
    return path.resolve(process.env.LECTURES_DIR);
  }

  // Check CLI argument --dir=/path/to/lectures
  const dirArg = process.argv.find(a => a.startsWith('--dir='));
  if (dirArg) {
    return path.resolve(dirArg.split('=')[1]);
  }

  // Check desktop app settings.json in standard OS locations
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidateSettings = [
    path.join(home, 'Library', 'Application Support', 'lectnote', 'settings.json'),
    path.join(home, 'Library', 'Application Support', 'LectNote Studio', 'settings.json'),
    path.join(home, '.config', 'lectnote', 'settings.json'),
    path.join(home, '.config', 'LectNote Studio', 'settings.json'),
    path.join(process.env.APPDATA || '', 'lectnote', 'settings.json'),
    path.join(process.env.APPDATA || '', 'LectNote Studio', 'settings.json')
  ];

  for (const sPath of candidateSettings) {
    if (fs.existsSync(sPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(sPath, 'utf8'));
        if (raw && raw.lecturesDir && fs.existsSync(raw.lecturesDir)) {
          return path.resolve(raw.lecturesDir);
        }
      } catch (e) {}
    }
  }

  // Check default user Documents folder
  if (home) {
    const docsLectures = path.join(home, 'Documents', 'LectNote', 'lectures');
    if (fs.existsSync(docsLectures)) {
      return docsLectures;
    }
  }

  return getLecturesDir();
}

// Auto-bind active directory
const activeDir = resolveMcpLecturesDir();
if (activeDir) {
  setLecturesDir(activeDir);
}

// Supported MCP Tools
const TOOLS = [
  {
    name: 'list_courses',
    description: 'List all academic courses registered in LectNote with lecture counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'list_lectures',
    description: 'List all lectures for a specific course in LectNote, including whiteboard photo counts.',
    inputSchema: {
      type: 'object',
      properties: {
        course: {
          type: 'string',
          description: 'The unique course identifier (e.g. "PHYS101-Mechanics")'
        }
      },
      required: ['course']
    }
  },
  {
    name: 'get_lecture_notes',
    description: 'Retrieve full markdown notes, whiteboard photo references, and study chat history for a specific lecture.',
    inputSchema: {
      type: 'object',
      properties: {
        course: {
          type: 'string',
          description: 'The course identifier'
        },
        lecture: {
          type: 'string',
          description: 'The lecture identifier'
        }
      },
      required: ['course', 'lecture']
    }
  },
  {
    name: 'search_notes',
    description: 'Perform a full-text search across all course notes and lecture titles in LectNote.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search keyword, formula, or concept'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'add_chat_entry',
    description: 'Add an assistant explanation, formula derivation, or Q&A pair into the lecture\'s in-app chat history in LectNote.',
    inputSchema: {
      type: 'object',
      properties: {
        course: { type: 'string', description: 'The course identifier' },
        lecture: { type: 'string', description: 'The lecture identifier' },
        role: { type: 'string', enum: ['user', 'assistant'], description: 'Message sender role' },
        content: { type: 'string', description: 'Markdown content of the explanation or answer' }
      },
      required: ['course', 'lecture', 'role', 'content']
    }
  },
  {
    name: 'append_to_lecture_notes',
    description: 'Append new notes, key takeaways, or exam practice problems directly to the lecture\'s notes.md in LectNote.',
    inputSchema: {
      type: 'object',
      properties: {
        course: { type: 'string', description: 'The course identifier' },
        lecture: { type: 'string', description: 'The lecture identifier' },
        content: { type: 'string', description: 'Markdown text to append to the notes' }
      },
      required: ['course', 'lecture', 'content']
    }
  }
];

function getSafeLectureDirectory(course, lecture) {
  const base = getLecturesDir();
  const c = sanitizeIdentifier(course);
  const l = sanitizeIdentifier(lecture);
  const full = path.join(base, c, l);
  if (!full.startsWith(base)) {
    throw new Error('Access denied: path traversal detected');
  }
  return { dir: full, course: c, lecture: l };
}

function handleToolCall(name, args) {
  const currentDir = getLecturesDir();

  switch (name) {
    case 'list_courses': {
      if (!fs.existsSync(currentDir)) return { courses: [] };
      const courses = fs.readdirSync(currentDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => {
          const cPath = path.join(currentDir, d.name);
          const lectures = fs.readdirSync(cPath, { withFileTypes: true })
            .filter(ld => ld.isDirectory() && !ld.name.startsWith('.'));
          return {
            id: d.name,
            name: d.name.replace(/[-_]/g, ' '),
            lectureCount: lectures.length
          };
        });
      return { courses };
    }

    case 'list_lectures': {
      const { course } = args;
      const c = sanitizeIdentifier(course);
      const cPath = path.join(currentDir, c);
      if (!fs.existsSync(cPath)) throw new Error(`Course not found: ${course}`);

      const lectures = fs.readdirSync(cPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => {
          const lPath = path.join(cPath, d.name);
          const pPath = path.join(lPath, 'photos');
          const photoCount = fs.existsSync(pPath)
            ? fs.readdirSync(pPath).filter(f => !f.startsWith('.')).length
            : 0;
          return {
            id: d.name,
            title: d.name.replace(/[-_]/g, ' '),
            photoCount
          };
        });
      return { course: c, lectures };
    }

    case 'get_lecture_notes': {
      const { course, lecture } = args;
      const { dir, course: c, lecture: l } = getSafeLectureDirectory(course, lecture);
      if (!fs.existsSync(dir)) throw new Error(`Lecture workspace not found: ${c}/${l}`);

      const mdPath = path.join(dir, 'notes.md');
      const markdown = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';

      const photosDir = path.join(dir, 'photos');
      const photos = fs.existsSync(photosDir)
        ? fs.readdirSync(photosDir).filter(f => !f.startsWith('.'))
        : [];

      const chatPath = path.join(dir, 'chat_history.json');
      const chatHistory = fs.existsSync(chatPath)
        ? JSON.parse(fs.readFileSync(chatPath, 'utf8'))
        : [];

      return {
        course: c,
        lecture: l,
        markdown,
        photos,
        chatHistory
      };
    }

    case 'search_notes': {
      const query = (args.query || '').trim().toLowerCase();
      if (!query) return { results: [] };
      if (!fs.existsSync(currentDir)) return { results: [] };

      const results = [];
      const courseDirs = fs.readdirSync(currentDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'));

      for (const cDir of courseDirs) {
        const cPath = path.join(currentDir, cDir.name);
        const lDirs = fs.readdirSync(cPath, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.'));

        for (const lDir of lDirs) {
          const lPath = path.join(cPath, lDir.name);
          const mdPath = path.join(lPath, 'notes.md');
          let matched = false;
          let snippet = '';

          if (cDir.name.toLowerCase().includes(query) || lDir.name.toLowerCase().includes(query)) {
            matched = true;
          }

          if (fs.existsSync(mdPath)) {
            const content = fs.readFileSync(mdPath, 'utf8');
            const idx = content.toLowerCase().indexOf(query);
            if (idx !== -1) {
              matched = true;
              const start = Math.max(0, idx - 40);
              const end = Math.min(content.length, idx + query.length + 50);
              snippet = content.substring(start, end).replace(/\n+/g, ' ').trim();
            }
          }

          if (matched) {
            results.push({
              course: cDir.name,
              lecture: lDir.name,
              snippet: snippet || `Lecture title match in ${cDir.name}`
            });
          }
        }
      }
      return { query, results };
    }

    case 'add_chat_entry': {
      const { course, lecture, role, content } = args;
      const { dir, course: c, lecture: l } = getSafeLectureDirectory(course, lecture);
      if (!fs.existsSync(dir)) throw new Error(`Lecture workspace not found: ${c}/${l}`);

      const chatPath = path.join(dir, 'chat_history.json');
      let history = [];
      if (fs.existsSync(chatPath)) {
        try {
          history = JSON.parse(fs.readFileSync(chatPath, 'utf8'));
        } catch (e) {
          history = [];
        }
      }

      history.push({
        role: role === 'user' ? 'user' : 'assistant',
        content,
        timestamp: new Date().toISOString()
      });

      fs.writeFileSync(chatPath, JSON.stringify(history, null, 2), 'utf8');
      return { success: true, course: c, lecture: l, totalMessages: history.length };
    }

    case 'append_to_lecture_notes': {
      const { course, lecture, content } = args;
      const { dir, course: c, lecture: l } = getSafeLectureDirectory(course, lecture);
      if (!fs.existsSync(dir)) throw new Error(`Lecture workspace not found: ${c}/${l}`);

      const mdPath = path.join(dir, 'notes.md');
      const existing = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
      const updated = existing.trim() + '\n\n' + content.trim() + '\n';
      fs.writeFileSync(mdPath, updated, 'utf8');
      return { success: true, course: c, lecture: l, bytesWritten: Buffer.byteLength(content, 'utf8') };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Stdio JSON-RPC MCP Server Protocol Loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendResponse(id, result, error = null) {
  const res = { jsonrpc: '2.0', id };
  if (error) {
    res.error = { code: error.code || -32603, message: error.message || 'Internal error' };
  } else {
    res.result = result;
  }
  process.stdout.write(JSON.stringify(res) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: 'lectnote-mcp',
          version: '1.0.0'
        }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      // Client handshake complete
      return;
    }

    if (method === 'ping') {
      sendResponse(id, {});
      return;
    }

    if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const out = handleToolCall(toolName, toolArgs);
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(out, null, 2)
            }
          ]
        });
      } catch (err) {
        sendResponse(id, null, { code: -32000, message: err.message });
      }
      return;
    }

    if (id !== undefined) {
      sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
    }
  } catch (err) {
    // Malformed JSON
  }
});


#!/usr/bin/env node

/**
 * LectNote CLI Launcher
 * Usage:
 *   lectnote              -> Starts the local web previewer studio on port 3000
 *   lectnote export <course> <lecture> [--theme=notebook|academic] [--out=output.pdf]
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0] || 'dev';

if (command === 'export') {
  const course = args[1];
  const lecture = args[2];
  if (!course || !lecture) {
    console.error('Usage: lectnote export <course> <lecture> [--theme=notebook|academic] [--out=notes.pdf]');
    process.exit(1);
  }

  let theme = 'notebook';
  let outPath = path.resolve(process.cwd(), `${course}_${lecture}.pdf`);

  for (let i = 3; i < args.length; i++) {
    if (args[i].startsWith('--theme=')) {
      theme = args[i].split('=')[1];
    } else if (args[i].startsWith('--out=')) {
      outPath = path.resolve(process.cwd(), args[i].split('=')[1]);
    }
  }

  console.log(`Exporting ${course}/${lecture} to PDF (${theme} theme)...`);

  const { app } = require('../server/app');
  const PORT = 3001;
  const server = app.listen(PORT, async () => {
    try {
      const { exportLectureToPdf } = require('../server/pdf/exporter');
      const renderUrl = `http://localhost:${PORT}/api/lectures/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}/render?theme=${theme}`;
      await exportLectureToPdf({
        url: renderUrl,
        outputPath: outPath,
        theme
      });
      console.log(`✓ Vector PDF generated successfully at: ${outPath}`);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      server.close();
      process.exit(0);
    }
  });

} else {
  // Start server
  require('../server/app');
}


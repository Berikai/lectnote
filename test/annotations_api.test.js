const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { app, setLecturesDir } = require('../server/app');

describe('LectNote Annotations API (Sticky Notes & Drawings)', () => {
  let server;
  let baseUrl;
  const tempLecturesDir = path.resolve(__dirname, 'temp_test_annotations');

  before(async () => {
    fs.mkdirSync(tempLecturesDir, { recursive: true });
    setLecturesDir(tempLecturesDir);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (fs.existsSync(tempLecturesDir)) {
      fs.rmSync(tempLecturesDir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal attacks on annotations endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/..%2F..%2Fetc/passwd/annotations`);
    assert.strictEqual(res.status >= 400, true);
  });

  it('returns empty default annotations for newly created lecture', async () => {
    // 1. Create a lecture first
    await fetch(`${baseUrl}/api/lectures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: 'ANNO101',
        lecture: 'lecture-01-intro',
        title: 'Annotations Intro'
      })
    });

    const res = await fetch(`${baseUrl}/api/lectures/ANNO101/lecture-01-intro/annotations`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.course, 'ANNO101');
    assert.strictEqual(data.lecture, 'lecture-01-intro');
    assert.deepStrictEqual(data.annotations.stickies, []);
    assert.deepStrictEqual(data.annotations.drawings, []);
  });

  it('saves and updates sticky notes and drawings in annotations.json next to notes.md', async () => {
    const payload = {
      annotations: {
        stickies: [
          {
            id: 'sticky_1',
            x: 250,
            y: 180,
            width: 210,
            height: 150,
            color: 'yellow',
            text: 'Important formula on line 12!',
            collapsed: false
          }
        ],
        drawings: [
          {
            id: 'stroke_1',
            tool: 'pen',
            color: '#e11d48',
            size: 3,
            opacity: 1.0,
            path: 'M 100 200 L 150 250',
            points: [[100, 200], [150, 250]]
          }
        ]
      }
    };

    const putRes = await fetch(`${baseUrl}/api/lectures/ANNO101/lecture-01-intro/annotations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(putRes.status, 200);
    const putData = await putRes.json();
    assert.strictEqual(putData.success, true);
    assert.strictEqual(putData.annotations.stickies.length, 1);
    assert.strictEqual(putData.annotations.drawings.length, 1);

    // Verify written to disk next to notes.md
    const fileOnDisk = path.join(tempLecturesDir, 'ANNO101', 'lecture-01-intro', 'annotations.json');
    assert.strictEqual(fs.existsSync(fileOnDisk), true);
    const diskContent = JSON.parse(fs.readFileSync(fileOnDisk, 'utf8'));
    assert.strictEqual(diskContent.stickies[0].text, 'Important formula on line 12!');
    assert.strictEqual(diskContent.drawings[0].tool, 'pen');

    // Retrieve via GET /annotations
    const getRes = await fetch(`${baseUrl}/api/lectures/ANNO101/lecture-01-intro/annotations`);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.annotations.stickies[0].id, 'sticky_1');
    assert.strictEqual(getData.annotations.drawings[0].id, 'stroke_1');

    // Retrieve via GET /api/lectures/:course/:lecture
    const lectureRes = await fetch(`${baseUrl}/api/lectures/ANNO101/lecture-01-intro`);
    const lectureData = await lectureRes.json();
    assert.strictEqual(lectureData.annotations.stickies.length, 1);
    assert.strictEqual(lectureData.annotations.drawings.length, 1);
  });

  it('renders annotations into standalone HTML and print view', async () => {
    const renderRes = await fetch(`${baseUrl}/api/lectures/ANNO101/lecture-01-intro/render?theme=notebook`);
    assert.strictEqual(renderRes.status, 200);
    const html = await renderRes.text();

    assert.match(html, /preview-annotations-layer/);
    assert.match(html, /drawing-svg-canvas/);
    assert.match(html, /M 100 200 L 150 250/);
    assert.match(html, /sticky-color-yellow/);
    assert.match(html, /Important formula on line 12!/);
  });
});


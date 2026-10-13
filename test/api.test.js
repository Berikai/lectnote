const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { app, setLecturesDir, getLecturesDir } = require('../server/app');

describe('LectNote Backend Server & Security API', () => {
  let server;
  let baseUrl;
  const tempLecturesDir = path.resolve(__dirname, 'temp_test_lectures');

  before(async () => {
    // Create temporary lectures directory
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
    // Clean up temporary lectures directory
    if (fs.existsSync(tempLecturesDir)) {
      fs.rmSync(tempLecturesDir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal attacks on lecture endpoints', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/..%2F..%2Fetc/passwd`);
    assert.strictEqual(res.status >= 400, true);
  });

  it('creates a new course and lecture workspace', async () => {
    const res = await fetch(`${baseUrl}/api/lectures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: 'TEST101-Intro',
        lecture: 'lecture-01-basics',
        title: 'Introduction to Testing'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.course, 'TEST101-Intro');
    assert.strictEqual(data.lecture, 'lecture-01-basics');

    // Verify file created on disk
    const notePath = path.join(tempLecturesDir, 'TEST101-Intro', 'lecture-01-basics', 'notes.md');
    assert.strictEqual(fs.existsSync(notePath), true);
  });

  it('retrieves lecture details and markdown', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/lecture-01-basics`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.course, 'TEST101-Intro');
    assert.strictEqual(data.lecture, 'lecture-01-basics');
    assert.match(data.markdown, /Introduction to Testing/);
  });

  it('updates lecture markdown safely', async () => {
    const updatedContent = '# Updated Title\n\nNew notes here.';
    const res = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/lecture-01-basics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: updatedContent })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const getRes = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/lecture-01-basics`);
    const getData = await getRes.json();
    assert.strictEqual(getData.markdown, updatedContent);
  });

  it('renames a lecture workspace', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/lecture-01-basics/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newLecture: 'lecture-01-renamed' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.lecture, 'lecture-01-renamed');

    const oldPath = path.join(tempLecturesDir, 'TEST101-Intro', 'lecture-01-basics');
    const newPath = path.join(tempLecturesDir, 'TEST101-Intro', 'lecture-01-renamed');
    assert.strictEqual(fs.existsSync(oldPath), false);
    assert.strictEqual(fs.existsSync(newPath), true);
  });

  it('renames a lecture workspace with casing change only', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/lecture-01-renamed/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newLecture: 'Lecture-01-Renamed' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.lecture, 'Lecture-01-Renamed');

    const checkPath = path.join(tempLecturesDir, 'TEST101-Intro', 'Lecture-01-Renamed');
    assert.strictEqual(fs.existsSync(checkPath), true);
  });

  it('deletes a lecture workspace', async () => {
    const res = await fetch(`${baseUrl}/api/lectures/TEST101-Intro/Lecture-01-Renamed`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);

    const checkPath = path.join(tempLecturesDir, 'TEST101-Intro', 'lecture-01-renamed');
    assert.strictEqual(fs.existsSync(checkPath), false);
  });

  it('renames and deletes a course', async () => {
    // Recreate lecture so course has something
    await fetch(`${baseUrl}/api/lectures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: 'TEST202', lecture: 'lecture-01' })
    });

    // Rename course
    const renameRes = await fetch(`${baseUrl}/api/courses/TEST202/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newCourse: 'TEST202-Renamed' })
    });
    assert.strictEqual(renameRes.status, 200);

    // Case-only rename course
    const caseRenameRes = await fetch(`${baseUrl}/api/courses/TEST202-Renamed/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newCourse: 'test202-renamed' })
    });
    assert.strictEqual(caseRenameRes.status, 200);

    // Delete course
    const delRes = await fetch(`${baseUrl}/api/courses/test202-renamed`, {
      method: 'DELETE'
    });
    assert.strictEqual(delRes.status, 200);

    const coursePath = path.join(tempLecturesDir, 'test202-renamed');
    assert.strictEqual(fs.existsSync(coursePath), false);
  });

  it('searches lectures and note content globally', async () => {
    // Create test lecture with unique keyword
    await fetch(`${baseUrl}/api/lectures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course: 'CS450-Distributed-Systems',
        lecture: 'lecture-04-raft-consensus',
        title: 'Raft Consensus Protocol'
      })
    });

    await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: '# Raft Consensus\n\nLeader election and log replication with heartbeats.'
      })
    });

    // Search by title/slug term
    const res1 = await fetch(`${baseUrl}/api/search?q=consensus`);
    const data1 = await res1.json();
    assert.strictEqual(data1.results.length >= 1, true);
    assert.strictEqual(data1.results.some(r => r.lecture === 'lecture-04-raft-consensus'), true);

    // Search by markdown body snippet
    const res2 = await fetch(`${baseUrl}/api/search?q=heartbeats`);
    const data2 = await res2.json();
    assert.strictEqual(data2.results.length >= 1, true);
    const hit = data2.results.find(r => r.lecture === 'lecture-04-raft-consensus');
    assert.ok(hit);
    assert.match(hit.snippet, /heartbeats/i);
    assert.strictEqual(typeof hit.lineNumber, 'number');
    assert.strictEqual(typeof hit.matchIdx, 'number');
    assert.strictEqual(hit.lineNumber, 2);

    // Empty search query
    const resEmpty = await fetch(`${baseUrl}/api/search?q=`);
    const dataEmpty = await resEmpty.json();
    assert.deepStrictEqual(dataEmpty.results, []);
  });

  it('interacts with per-lecture AI study assistant and chat history', async () => {
    // Initially empty chat history
    const getRes1 = await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus/chat`);
    assert.strictEqual(getRes1.status, 200);
    const getData1 = await getRes1.json();
    assert.deepStrictEqual(getData1.history, []);

    // Post a study question
    const postRes = await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Explain how heartbeats prevent split-brain in Raft' })
    });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.success, true);
    assert.strictEqual(postData.history.length, 2);
    assert.strictEqual(postData.history[0].role, 'user');
    assert.strictEqual(postData.history[1].role, 'assistant');

    // Append explanation into notes.md
    const appendRes = await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus/chat/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '### Review Note\n\nHeartbeats reset follower timers.' })
    });
    assert.strictEqual(appendRes.status, 200);
    const appendData = await appendRes.json();
    assert.match(appendData.markdown, /Heartbeats reset follower timers/);

    // Clear chat history
    const delRes = await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus/chat`, {
      method: 'DELETE'
    });
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await fetch(`${baseUrl}/api/lectures/CS450-Distributed-Systems/lecture-04-raft-consensus/chat`);
    const getData2 = await getRes2.json();
    assert.deepStrictEqual(getData2.history, []);
  });

  it('loads and updates workspace settings including runtime AI preferences', async () => {
    const getRes = await fetch(`${baseUrl}/api/settings`);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.lecturesDir);
    assert.strictEqual(getData.isElectron, false);
    assert.strictEqual(typeof getData.hasEnvGeminiKey, 'boolean');

    // Update settings
    const postRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiProvider: 'gemini',
        aiModel: 'gemini-2.5-flash'
      })
    });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.success, true);
    assert.strictEqual(postData.aiProvider, 'gemini');
    assert.strictEqual(postData.aiModel, 'gemini-2.5-flash');
  });

  it('tests AI connection diagnostics endpoint for offline and error cases', async () => {
    // 1. Offline provider should succeed immediately
    const offlineRes = await fetch(`${baseUrl}/api/settings/test-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'offline' })
    });
    assert.strictEqual(offlineRes.status, 200);
    const offlineData = await offlineRes.json();
    assert.strictEqual(offlineData.success, true);
    assert.match(offlineData.message, /Offline mode/);

    // 2. Missing key should return friendly validation error
    const noKeyRes = await fetch(`${baseUrl}/api/settings/test-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', apiKey: '' })
    });
    assert.strictEqual(noKeyRes.status, 400);
    const noKeyData = await noKeyRes.json();
    assert.match(noKeyData.error, /API key is required/);
  });

  it('validates photo upload file types and rejects unauthorized extensions', async () => {
    // Create dedicated lecture for photo testing
    await fetch(`${baseUrl}/api/lectures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course: 'PHOTO101', lecture: 'lecture-01' })
    });

    // 1. Attempt uploading an unauthorized .sh executable
    const formData = new FormData();
    const badBlob = new Blob(['#!/bin/bash\necho hack'], { type: 'application/x-sh' });
    formData.append('photos', badBlob, 'script.sh');

    const badRes = await fetch(`${baseUrl}/api/lectures/PHOTO101/lecture-01/upload`, {
      method: 'POST',
      body: formData
    });
    assert.strictEqual(badRes.status, 400);
    const badData = await badRes.json();
    assert.strictEqual(badData.success, false);
    assert.match(badData.error, /Invalid file type/);

    // 2. Upload valid image
    const validFormData = new FormData();
    const imageBlob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' });
    validFormData.append('photos', imageBlob, 'diagram.svg');

    const validRes = await fetch(`${baseUrl}/api/lectures/PHOTO101/lecture-01/upload`, {
      method: 'POST',
      body: validFormData
    });
    assert.strictEqual(validRes.status, 200);
    const validData = await validRes.json();
    assert.strictEqual(validData.success, true);
    assert.ok(validData.uploaded.includes('diagram.svg'));
  });
});


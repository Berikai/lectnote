const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { setLecturesDir } = require('../server/app');

describe('LectNote Model Context Protocol (MCP) Server', () => {
  const tempLecturesDir = path.resolve(__dirname, 'temp_mcp_lectures');
  let mcpProcess;

  before(() => {
    fs.mkdirSync(tempLecturesDir, { recursive: true });
    setLecturesDir(tempLecturesDir);

    // Create a sample course and lecture
    const sampleDir = path.join(tempLecturesDir, 'MATH301-Linear-Algebra', 'lecture-01-eigenvalues');
    fs.mkdirSync(sampleDir, { recursive: true });
    fs.writeFileSync(path.join(sampleDir, 'notes.md'), '# Eigenvalues and Eigenvectors\n\nCharacteristic polynomial: $\\det(A - \\lambda I) = 0$.', 'utf8');
  });

  after(() => {
    if (mcpProcess) {
      mcpProcess.kill();
    }
    if (fs.existsSync(tempLecturesDir)) {
      fs.rmSync(tempLecturesDir, { recursive: true, force: true });
    }
  });

  function sendMcpRequest(req) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [path.resolve(__dirname, '../bin/lectnote-mcp.js')], {
        env: { ...process.env, LECTURES_DIR: tempLecturesDir }
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
        const lines = output.trim().split('\n');
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === req.id) {
              child.kill();
              resolve(parsed);
              return;
            }
          } catch (e) {
            // Keep reading
          }
        }
      });

      child.stderr.on('data', (err) => {
        // Ignored
      });

      child.on('error', reject);

      child.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  it('responds to MCP initialize handshake', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' }
    });
    assert.strictEqual(res.id, 1);
    assert.strictEqual(res.result.serverInfo.name, 'lectnote-mcp');
    assert.strictEqual(res.result.protocolVersion, '2024-11-05');
  });

  it('lists available MCP study tools', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    });
    assert.strictEqual(res.id, 2);
    const toolNames = res.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('list_courses'));
    assert.ok(toolNames.includes('list_lectures'));
    assert.ok(toolNames.includes('get_lecture_notes'));
    assert.ok(toolNames.includes('search_notes'));
    assert.ok(toolNames.includes('add_chat_entry'));
    assert.ok(toolNames.includes('append_to_lecture_notes'));
  });

  it('calls list_courses tool via MCP', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_courses',
        arguments: {}
      }
    });
    assert.strictEqual(res.id, 3);
    const content = JSON.parse(res.result.content[0].text);
    assert.strictEqual(content.courses.length >= 1, true);
    assert.strictEqual(content.courses[0].id, 'MATH301-Linear-Algebra');
  });

  it('calls get_lecture_notes tool via MCP', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_lecture_notes',
        arguments: {
          course: 'MATH301-Linear-Algebra',
          lecture: 'lecture-01-eigenvalues'
        }
      }
    });
    assert.strictEqual(res.id, 4);
    const content = JSON.parse(res.result.content[0].text);
    assert.strictEqual(content.course, 'MATH301-Linear-Algebra');
    assert.match(content.markdown, /Eigenvalues/);
  });

  it('calls add_chat_entry to inject study assistant Q&A via MCP', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'add_chat_entry',
        arguments: {
          course: 'MATH301-Linear-Algebra',
          lecture: 'lecture-01-eigenvalues',
          role: 'assistant',
          content: 'The eigenvalues satisfy $\\det(A - \\lambda I) = 0$.'
        }
      }
    });
    assert.strictEqual(res.id, 5);
    const content = JSON.parse(res.result.content[0].text);
    assert.strictEqual(content.success, true);
    assert.strictEqual(content.totalMessages, 1);

    // Verify chat_history.json on disk
    const chatFile = path.join(tempLecturesDir, 'MATH301-Linear-Algebra', 'lecture-01-eigenvalues', 'chat_history.json');
    assert.strictEqual(fs.existsSync(chatFile), true);
    const history = JSON.parse(fs.readFileSync(chatFile, 'utf8'));
    assert.strictEqual(history[0].role, 'assistant');
    assert.match(history[0].content, /eigenvalues/);
  });

  it('calls append_to_lecture_notes to update notes.md via MCP', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'append_to_lecture_notes',
        arguments: {
          course: 'MATH301-Linear-Algebra',
          lecture: 'lecture-01-eigenvalues',
          content: '### Geometric Multiplicity\nDimension of the eigenspace.'
        }
      }
    });
    assert.strictEqual(res.id, 6);
    const content = JSON.parse(res.result.content[0].text);
    assert.strictEqual(content.success, true);

    const noteFile = path.join(tempLecturesDir, 'MATH301-Linear-Algebra', 'lecture-01-eigenvalues', 'notes.md');
    const noteText = fs.readFileSync(noteFile, 'utf8');
    assert.match(noteText, /Geometric Multiplicity/);
  });
});


/**
 * LectNote: Interactive Academic AI Study Assistant
 * Provides per-lecture conversational tutoring, formula explanation,
 * quiz generation, and persistent chat history.
 */

const fs = require('fs');
const path = require('path');

async function askStudyAssistant({
  course,
  lecture,
  message,
  history = [],
  notesContent = '',
  photos = [],
  provider = 'gemini',
  apiKey = '',
  model = '',
  baseUrl = ''
}) {
  const effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || '';

  // Construct system prompt with lecture context
  const systemPrompt = `You are LectNote's Academic Study Assistant and STEM Tutor.
You are helping a student study, analyze, and master the material from the following lecture:

COURSE: ${course}
LECTURE: ${lecture}

CURRENT LECTURE NOTES (Markdown):
---
${notesContent ? notesContent.substring(0, 15000) : '(No notes written yet)'}
---

ATTACHED WHITEBOARD PHOTOS:
${photos && photos.length > 0 ? photos.map(p => `- ${p}`).join('\n') : '(No whiteboard photos)'}

TUTOR INSTRUCTIONS:
1. Provide accurate, clear, and pedagogically sound explanations.
2. For mathematical expressions and formulas, always use standard LaTeX delimiters: inline with single dollar signs ($x$), and display blocks with double dollar signs ($$\\sigma = \\frac{F}{A}$$).
3. If the user asks for practice questions, provide interactive flashcard-style problems with hints.
4. If referring to whiteboard photos, mention them clearly.
5. Format your answers in clean, readable Markdown with headings, bullet points, and code blocks where helpful.`;

  // If no API key is provided and provider requires it, provide informative study guidance
  if (!effectiveApiKey && provider !== 'local') {
    return generateOfflineTutorReply(message, course, lecture, notesContent);
  }

  // Gemini Provider
  if (provider === 'gemini') {
    return await queryGeminiChat({
      apiKey: effectiveApiKey,
      model: model || 'gemini-2.5-flash',
      systemPrompt,
      history,
      message
    });
  }

  // OpenAI / DeepSeek / Custom Provider
  if (provider === 'openai' || provider === 'deepseek') {
    return await queryOpenAIChat({
      apiKey: effectiveApiKey,
      baseUrl: baseUrl || (provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'),
      model: model || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o'),
      systemPrompt,
      history,
      message
    });
  }

  return generateOfflineTutorReply(message, course, lecture, notesContent);
}

async function queryGeminiChat({ apiKey, model, systemPrompt, history, message }) {
  const contents = [];

  // Add system instruction / context in first turn
  contents.push({
    role: 'user',
    parts: [{ text: `${systemPrompt}\n\nLet's begin the study session.` }]
  });
  contents.push({
    role: 'model',
    parts: [{ text: `Understood! I am ready to help you master this lecture on **${model}**. What would you like to explore or clarify?` }]
  });

  // Append history
  for (const h of history.slice(-8)) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    });
  }

  // Append latest question
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const candidateModels = [
    model,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter(Boolean);

  let lastError = null;

  for (const m of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 404 && candidateModels.indexOf(m) < candidateModels.length - 1) {
          continue;
        }
        throw new Error(`Gemini API Error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return reply.trim();
    } catch (err) {
      lastError = err;
      if (candidateModels.indexOf(m) < candidateModels.length - 1) continue;
      throw err;
    }
  }

  throw lastError || new Error('Failed to query Gemini API');
}

async function queryOpenAIChat({ apiKey, baseUrl, model, systemPrompt, history, message }) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function generateOfflineTutorReply(question, course, lecture, notes) {
  const lowerQ = question.toLowerCase();

  // Search if question terms match lecture notes
  const lines = notes.split('\n');
  const matchedLines = lines.filter(l => l.trim().length > 10 && lowerQ.split(' ').some(w => w.length > 3 && l.toLowerCase().includes(w))).slice(0, 5);

  let reply = `### 📚 Study Assistant Insights\n\n`;
  reply += `You're reviewing **${lecture.replace(/[-_]/g, ' ')}** in *${course.replace(/[-_]/g, ' ')}*.\n\n`;

  if (matchedLines.length > 0) {
    reply += `Here are relevant sections extracted directly from your current lecture notes:\n\n`;
    matchedLines.forEach(l => {
      reply += `> ${l.trim()}\n`;
    });
    reply += `\n`;
  }

  reply += `> [!tip] Direct AI Tutoring Setup\n`;
  reply += `> To enable real-time interactive AI responses with KaTeX derivations, configure your **Gemini API Key** in Workspace Settings (⌘,) or use LectNote's built-in **MCP Server** (\`node bin/lectnote-mcp.js\`) with Claude Desktop, Cursor, or Antigravity without incurring extra costs!`;

  return reply;
}

module.exports = {
  askStudyAssistant
};


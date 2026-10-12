/**
 * Multi-Provider AI Ingestion Handler for LectNote
 * Supports:
 * - Gemini 3.8 Flash / Gemini 2.5 Flash
 * - DeepSeek v4.1 Flash
 * - Custom OpenAI-Compatible Endpoints (vLLM, Ollama, OpenRouter, LM Studio)
 * - Manual Mode
 */

const fs = require('fs');
const path = require('path');
const { buildSystemPrompt } = require('./prompt');

/**
 * Transcribe lecture whiteboard photos using the selected AI provider
 */
async function transcribeLecture(params) {
  const {
    provider = 'gemini',
    apiKey,
    baseUrl,
    model,
    course = 'Engineering Course',
    subject = 'STEM',
    lectureTitle = 'Lecture Notes',
    photos = [], // Array of absolute file paths or filenames
    photoDir = '',
    customInstructions = ''
  } = params;

  if (provider === 'manual') {
    return generateManualTemplate({ course, subject, lectureTitle, photos });
  }

  const systemPrompt = buildSystemPrompt({ course, subject });
  const userPromptText = `Course: ${course}
Subject / Discipline: ${subject}
Lecture Topic: ${lectureTitle}
${customInstructions ? `Additional User Instructions: ${customInstructions}` : ''}

Attached are ${photos.length} whiteboard photo(s) from this lecture:
${photos.map((p, idx) => `Photo ${idx + 1}: ${path.basename(p)}`).join('\n')}

Please transcribe and synthesize these whiteboard photos into exhaustive, structured Markdown following all formatting and annotation rules.`;

  // Read images as base64
  const imagePayloads = [];
  for (const photo of photos) {
    const fullPath = path.isAbsolute(photo) ? photo : path.join(photoDir, photo);
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const base64Data = fs.readFileSync(fullPath).toString('base64');
      imagePayloads.push({
        filename: path.basename(fullPath),
        mimeType,
        base64Data
      });
    }
  }

  switch (provider) {
    case 'gemini':
      return await callGemini({ apiKey, model: model || 'gemini-3.8-flash', systemPrompt, userPromptText, images: imagePayloads });

    case 'deepseek':
      return await callDeepSeek({ apiKey, model: model || 'deepseek-v4.1-flash', baseUrl: baseUrl || 'https://api.deepseek.com', systemPrompt, userPromptText, images: imagePayloads });

    case 'openai':
      return await callOpenAICompatible({ apiKey, model: model || 'gpt-4o', baseUrl: baseUrl || 'https://api.openai.com/v1', systemPrompt, userPromptText, images: imagePayloads });

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Google Gemini API Client
 */
async function callGemini({ apiKey, model, systemPrompt, userPromptText, images }) {
  if (!apiKey) {
    throw new Error('Gemini API key is required. Please provide it in settings or set GEMINI_API_KEY environment variable.');
  }

  // Construct Gemini generateContent request with official inlineData payload
  const contents = [
    {
      role: 'user',
      parts: [
        { text: `${systemPrompt}\n\n---\n${userPromptText}` },
        ...images.map(img => ({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64Data
          }
        }))
      ]
    }
  ];

  // Candidates list to gracefully handle requested model or futuristic aliases
  const requestedModel = (model || 'gemini-2.5-flash').trim();
  const candidateModels = [
    requestedModel,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ].filter((v, i, a) => a.indexOf(v) === i);

  let lastError = null;

  for (let i = 0; i < candidateModels.length; i++) {
    const currentModel = candidateModels[i];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        // If model not found (404), try next available candidate
        if (response.status === 404 && i < candidateModels.length - 1) {
          console.warn(`Gemini model "${currentModel}" not found (404). Retrying with "${candidateModels[i + 1]}"...`);
          lastError = new Error(`Gemini API Error (${response.status}): ${errorText}`);
          continue;
        }
        throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        console.warn('Gemini transcription output reached MAX_TOKENS limit.');
      }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return cleanMarkdownOutput(text);
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes('404') && i < candidateModels.length - 1) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Failed to generate lecture notes from Gemini API');
}

/**
 * DeepSeek Vision Client
 */
async function callDeepSeek({ apiKey, model, baseUrl, systemPrompt, userPromptText, images }) {
  if (!apiKey) {
    throw new Error('DeepSeek API key is required. Please provide it in settings.');
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPromptText },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` }
        }))
      ]
    }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 16384
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return cleanMarkdownOutput(text);
}

/**
 * Custom OpenAI-Compatible Client (vLLM, Ollama, OpenRouter, LM Studio, etc.)
 */
async function callOpenAICompatible({ apiKey, model, baseUrl, systemPrompt, userPromptText, images }) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const userContent = [{ type: 'text', text: userPromptText }];
  for (const img of images) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` }
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 16384
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI-Compatible API Error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return cleanMarkdownOutput(text);
}

/**
 * Generate starter markdown template for manual / skip-AI mode
 */
function generateManualTemplate({ course, subject, lectureTitle, photos }) {
  const photoRefs = photos.length > 0
    ? photos.map((p, i) => `:::board-ref [${path.basename(p)}] "Whiteboard Reference Photo #${i + 1}" :::\n`).join('\n')
    : `:::board-ref [board_1.jpg] "Whiteboard Reference Diagram" :::\n`;

  return `# ${course}: ${lectureTitle}

> [!note] Overview
> Notes transcribed for **${course}** (${subject}). Use the editor on the left to write your formulas, callouts, and diagrams.

## 1. Core Principles & Mechanisms
In this lecture, we introduce the governing behavior of ==fundamental concept==.

[Key Governing Law]{.box} states that the interaction rate is directly proportional to the applied gradient:

$$J = -D \\frac{dC}{dx}$$

Where:
- $J$: Flux density ($\\text{mol} \\cdot \\text{m}^{-2} \\cdot \\text{s}^{-1}$)
- $D$: Diffusion coefficient ($\\text{m}^2 \\cdot \\text{s}^{-1}$)
- $\\frac{dC}{dx}$: Concentration gradient

> [!warning] Critical Pitfall
> Notice the negative sign indicates flow down the concentration gradient!

## 2. Whiteboard Reference & Visual Diagrams
${photoRefs}

\`\`\`mermaid
flowchart LR
    A[Initial State] -->|Driving Force| B[Transition State]
    B -->|Relaxation| C[Final Equilibrium]
\`\`\`

## 3. Key Takeaway & Exam Formula
The characteristic relationship follows an Arrhenius dependency:

[D = D_0 \\exp\\left(-\\frac{Q}{RT}\\right)]{.circle}
`;
}

function cleanMarkdownOutput(rawText) {
  if (!rawText) return '';
  // Strip outer markdown code fences if the model wrapped the whole response in ```markdown ... ```
  let text = rawText.trim();
  if (text.startsWith('```markdown') && text.endsWith('```')) {
    text = text.slice(11, -3).trim();
  } else if (text.startsWith('```') && text.endsWith('```')) {
    text = text.slice(3, -3).trim();
  }

  // Gracefully resolve unclosed delimiters if response was truncated at token limit
  const displayDollarCount = (text.match(/\$\$/g) || []).length;
  if (displayDollarCount % 2 !== 0) {
    text = text + '\n$$';
  }

  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    text = text + '\n```';
  }

  return text;
}

module.exports = { transcribeLecture, generateManualTemplate };


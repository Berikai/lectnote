# 🖋️ LectNote

> Transform whiteboard photos and lecture drafts into publication-grade, interactive study notes and vector PDFs.

`LectNote` is a local Node.js studio built for engineering and STEM lectures. It pairs **KaTeX** math, **Rough Notation** hand-drawn annotations, **AI-reconstructed code diagrams** (Mermaid & SVG), and an **interactive whiteboard reference inspector**, with a seamless toggle between **Ruled Notebook** and **Academic View**.

---

## ✨ Features

- **📓 Ruled Notebook Theme (Default):** Warm paper texture, red margin line, handwritten fonts (`Caveat`, `Patrick Hand`), tilted sticky notes with push-pins, and organic sketches.
- **🎓 Academic View Theme:** Formal IEEE / Springer publication aesthetic, high-contrast serif/sans-serif typography (`Newsreader`, `Inter`), and structured theorem callout boxes.
- **📐 AI-Reconstructed Code Diagrams:**
  - **Mermaid:** Workflows, phase transitions, and state algorithms.
  - **Direct SVG:** Clean 2D phase diagrams, coordinate axes, and physical models.
- **📷 Whiteboard Photo Drawer & Lightbox:**
  - Slide-out drawer displaying all original lecture photos for the current topic.
  - Deep zoom and pan lightbox to verify formulas, indices, and handwritten curves against the professor's board.
- **🤖 Selectable Multimodal AI Ingestion:**
  - **Google Gemini 3.8 Flash:** Native high-resolution batch photo processing.
  - **DeepSeek v4.1 Flash:** High-speed visual reasoning.
  - **Custom OpenAI-Compatible:** Connect to local vLLM, Ollama, LM Studio, or OpenRouter.
  - **Manual Mode:** Skip AI; write or paste Markdown directly while linking board photos.
- **🖨️ Vector PDF Export & Print:**
  - Print-optimized CSS (`@media print`) preventing page breaks across equations and sticky notes.
  - Instant **Print View** (browser native print sheet with 1-click Save as PDF).
  - Automated headless PDF generation via Puppeteer.

---

## 🚀 Quick Start

### 1. Install & Launch
```bash
# Clone and enter directory
cd /Users/berikai/Repositories/lectnote

# Install dependencies
npm install

# Start local studio
npm start
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

### 2. CLI Usage
```bash
# Launch previewer studio
./bin/lectnote.js

# Export a lecture directly from terminal
./bin/lectnote.js export MCE306-MaterialsScience lecture-03-diffusion-fick --theme=notebook --out=notes.pdf
```

---

## 📝 Markdown Syntax Cheat Sheet

| Syntax | Description | Example |
| :--- | :--- | :--- |
| `==text==` | Hand-drawn highlighter | `==Arrhenius relationship==` |
| `[formula]{.circle}` | Red hand-drawn circle | `[\sigma_f = \sqrt{2E\gamma/\pi a}]{.circle}` |
| `[definition]{.box}` | Blue hand-drawn box | `[J = -D \frac{dC}{dx}]{.box}` |
| `[warning]{.underline}` | Orange hand-drawn underline | `[valid for isotropic diffusion]{.underline}` |
| `> [!note] Title` | Pinned Professor Sticky Note | `> [!note] Exam Insight`<br>`> Interstitial activation energy is lower.` |
| `> [!warning] Title` | Warning / Pitfall Callout | `> [!warning] Units`<br>`> Always convert Celsius to Kelvin.` |
| `:::board-ref [photo.svg] "Caption" :::` | Interactive Whiteboard Reference | Links to photo drawer & lightbox |
| ```` ```mermaid ```` | Vector Flowchart / Sequence | State transitions, mechanisms |
| ```` ```svg ```` | Vector Diagram | Physical curves, coordinate models |

---

## 📂 Workspace Structure

Notes are stored as standard Git/Obsidian-compatible directories:

```
lectures/
├── MCE306-MaterialsScience/
│   └── lecture-03-diffusion-fick/
│       ├── notes.md                 # Raw Markdown source
│       ├── photos/                  # Original whiteboard photos
│       │   └── diffusion_membrane.svg
│       └── lecture-03_notes.pdf     # Exported vector PDF
└── CS301-Algorithms/
    └── lecture-04-graph-traversal/
        ├── notes.md
        └── photos/
```


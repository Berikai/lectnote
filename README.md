# LectNote

A local note-taking app designed for STEM lectures. Keep whiteboard photos side-by-side with your notes, write with KaTeX math and hand-drawn annotations, and export clean vector PDFs.

![App Preview](image.png)

## Features

- **Whiteboard Drawer & Lightbox**: Keep original board photos alongside your notes so you can zoom in and double-check formulas, diagrams, and handwriting.
- **KaTeX & Annotations**: Full LaTeX math support plus hand-drawn highlights, circles, boxes, and sticky notes powered by Rough Notation.
- **Two Themes**: Switch between a ruled notebook style and a clean academic paper layout.
- **AI Transcription & Diagrams**: Turn whiteboard photos into structured Markdown and Mermaid/SVG diagrams using Gemini, DeepSeek, or any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio).
- **In-App Study Assistant**: Ask questions about your notes, generate practice problems, and append derivations directly into your Markdown.
- **MCP Server**: Connect Claude Desktop or Cursor directly to your notes via the built-in Model Context Protocol server.
- **Vector PDF Export**: Export print-ready PDFs without breaking equations or callouts across pages.
- **Plain Files**: Everything is stored as standard Markdown and image files in a folder tree—no proprietary database or vendor lock-in.

## Getting Started

### Web App

```bash
git clone https://github.com/Berikai/lectnote.git
cd lectnote
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Desktop App (Electron)

```bash
npm run electron
```

Open settings (`⌘,` / `Ctrl+,`) to choose any folder on your machine as your notes workspace.

> **macOS Note**: If Gatekeeper blocks the unnotarized app on first run, either right-click the app in Finder and choose **Open**, or run:
> ```bash
> xattr -cr "/Applications/LectNote Studio.app"
> ```

### Claude Desktop / Cursor (MCP)

LectNote includes an MCP server so external AI tools can search your notes, read lectures, and append study takeaways.

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lectnote": {
      "command": "node",
      "args": ["<PATH_TO_LECTNOTE>/bin/lectnote-mcp.js"]
    }
  }
}
```

The MCP server automatically detects your active workspace directory (or pass `--dir=/path/to/lectures`).

### Building Installers

```bash
npm run electron:build        # Build for current OS
npm run electron:build:mac    # macOS .dmg & .zip
npm run electron:build:win    # Windows .exe
npm run electron:build:linux  # Linux AppImage & .deb
```

## Markdown Syntax

In addition to standard Markdown, LectNote supports hand-drawn annotations, sticky notes, and whiteboard references:

| Syntax | Description | Example |
| :--- | :--- | :--- |
| `==text==` | Highlighter | `==Arrhenius relationship==` |
| `[formula]{.circle}` | Hand-drawn circle | `[\sigma_f = \sqrt{2E\gamma/\pi a}]{.circle}` |
| `[definition]{.box}` | Hand-drawn box | `[J = -D \frac{dC}{dx}]{.box}` |
| `[note]{.underline}` | Underline | `[isotropic diffusion]{.underline}` |
| `> [!note] Title` | Pinned sticky note | `> [!note] Exam Tip`<br>`> Interstitial activation energy is lower.` |
| `> [!warning] Title` | Warning callout | `> [!warning] Units`<br>`> Always convert Celsius to Kelvin.` |
| `:::board-ref [photo.svg] "Caption" :::` | Whiteboard reference | Links directly to photo in drawer & lightbox |
| ```` ```mermaid ```` | Mermaid diagram | Flowcharts, state machines |
| ```` ```svg ```` | Raw SVG | Coordinate axes, custom curves |

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘S` / `Ctrl+S` | Save notes |
| `⌘B` / `Ctrl+B` | Toggle sidebar explorer |
| `⌘K` / `Ctrl+K` | Quick search |
| `⌘J` / `Ctrl+J` | Toggle AI study assistant |
| `⌘,` / `Ctrl+,` | Workspace settings |
| `Tab` / `Shift+Tab` | Indent / outdent lines |
| `Esc` | Close drawers, modals, or lightbox |

## File Structure

Lectures are stored as plain directories compatible with Git and Obsidian:

```
lectures/
├── MCE306-MaterialsScience/
│   └── lecture-03-diffusion-fick/
│       ├── notes.md                 # Note source
│       ├── chat_history.json        # Study tutor history
│       ├── photos/                  # Whiteboard photos
│       │   └── diffusion_membrane.svg
│       └── lecture-03_notes.pdf     # Exported PDF
└── CS301-Algorithms/
    └── lecture-04-graph-traversal/
        ├── notes.md
        ├── chat_history.json
        └── photos/
```

## License

[MIT](LICENSE)

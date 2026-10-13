# 🗺️ LectNote Roadmap

## ✅ Completed (v1.0.0 Release)
- [x] **Desktop Studio App (Electron)**: Native cross-platform desktop client with custom workspace directory selection, window state persistence, and native menus.
- [x] **In-App AI Study Assistant**: Interactive per-lecture tutoring panel with KaTeX math rendering, prompt chips (Takeaways, Formulas, Quiz), and 1-click note injection.
- [x] **Model Context Protocol (MCP) Server**: Stdio MCP server (`bin/lectnote-mcp.js`) enabling external AI hosts (Claude Desktop, Cursor, Antigravity) to query courses, inspect notes, and inject tutoring Q&A.
- [x] **Dual Aesthetics**: Seamless toggle between *Ruled Notebook* (warm paper, sticky notes, hand-drawn annotations) and *Academic View* (IEEE / Springer serif typography).
- [x] **Whiteboard Reference Lightbox**: Deep-zoom inspector linking blackboard photos directly to inline figure captions (`:::board-ref`).
- [x] **Offline Vendor Bundling**: Fully offline KaTeX, Mermaid, Rough Notation, and Highlight.js assets.
- [x] **Vector PDF Exporter**: Chromium print engine with `@media print` layout safeguards against equation page-splits.

## 🚀 Upcoming & Future Exploration
- [ ] **Flashcards & Spaced Repetition**: Auto-generate Anki-compatible flashcards from lecture sticky notes and formulas.
- [ ] **Audio Lecture Sync**: Synchronized audio recording timestamps matched to note sections and whiteboard photos.
- [ ] **Canvas / Freeform Mode**: Infinite whiteboard canvas mode for spatial mind-mapping alongside linear Markdown.
- [ ] **Mobile Companion Viewer**: Lightweight read-only web/PWA interface for reviewing notes on tablets and phones.

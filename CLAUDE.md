# CLAUDE.md — iterate-editor

## Commands

```bash
npm run dev    # Launch Electron app with HMR (open devtools auto-detach)
npm run build  # Compile all three vite bundles (main, preload, renderer)
```

## What This Is

Standalone video editor — **no CapCut dependency**. Own JSON project format. Full WYSIWYG: canvas preview matches FFmpeg export exactly.

**Stack:** electron-vite + React 18 + TypeScript, plain CSS dark theme, no UI library.
**Location:** `/Users/danieldsouza/Documents/2025/Projects/iterate-editor/`

---

## Architecture

```
src/
  main/index.ts          — Electron main process + all IPC handlers
  preload/index.ts       — contextBridge → window.api
  renderer/
    index.html
    src/
      main.tsx           — ReactDOM root + window-level drag-drop handler
      types.ts           — All data types
      App.tsx            — useReducer state, videoRef, play/seek logic
      App.css            — Dark theme + all component styles
      components/
        Toolbar.tsx       — Top bar: New/Open/Save, +Video/+Text, play controls, zoom, Export
        Canvas.tsx        — <video> + draggable/scalable text overlays with handles
        Timeline.tsx      — Ruler, track rows, segment blocks, playhead, drag-resize
        PropertiesPanel.tsx — Edit selected segment (text props, video info)
```

---

## Data Types (`types.ts`)

```ts
VideoSegment { id, type:'video', src, name, startUs, durationUs, sourceStartUs, sourceDurationUs }
TextSegment  { id, type:'text', text, startUs, durationUs,
               x, y,           // canvas coords -1 to 1
               fontSize, color, bold, italic,
               strokeWidth, strokeColor,  // outline (paint-order: stroke fill, width doubled in CSS)
               textAlign: 'left'|'center'|'right' }
Track        { id, type:'video'|'text', label, segments }
Project      { name, canvas:{width,height}, tracks }
AppState     { project, currentTimeSec, selectedId, zoom, isPlaying }
```

Default canvas: `1080 × 1920` (9:16).

---

## Key Implementation Notes

### Drag & Drop (CRITICAL — Electron 32+ breaking change)
`File.path` was **removed in Electron 32**. Use `webUtils.getPathForFile(file)` instead:
- Exposed in `preload/index.ts` as `window.api.getPathForFile(file: File): string`
- Called **synchronously** on raw `File` objects from `e.dataTransfer.files` inside the drop handler
- Called in `main.tsx` window-level `drop` listener → dispatches `CustomEvent('video-file-dropped', { detail: filePath })`
- `App.tsx` listens for `video-file-dropped` via `useEffect` → calls `handleDropVideo`
- Timeline's `onDrop` only clears the highlight; actual path extraction is at window level

### Coordinate Mapping (canvas ↔ screen)
- `screenLeft% = (x + 1) / 2 * 100`
- `screenTop%  = (1 - y) / 2 * 100`
- Drag reverse: `x = origX + dx/width*2`, `y = origY - dy/height*2`

### Text Outline
- CSS `paint-order: stroke fill` makes stroke render behind fill (only outer half visible)
- Apply `-webkit-text-stroke: ${strokeWidth * 2}px color` to compensate (double = visible outside equals stored value)
- `strokeWidth` stored as float; only `Math.round` for display in PropertiesPanel
- Scaling handle drag scales `strokeWidth` proportionally with `fontSize` (no rounding during drag)

### Text Handles (Canvas)
- 8 handles (nw/n/ne/e/se/s/sw/w) shown when text selected
- Corner/edge drag → scales `fontSize` + `strokeWidth` proportionally
- Snap guides: red lines appear when `|x| < 0.04` or `|y| < 0.04` (snaps to center)

### Timeline
- Constants: `LABEL_W=88`, `TRACK_H=44`, `RULER_H=28`
- Zoom: px/second, default 100, range 20–500
- Drag system: single `dragRef` tracks `seek | move | resize-left | resize-right`
- Native `addEventListener` for mouse events (not React synthetic)
- `drop-active` class adds blue inset shadow when file dragged over

### Video Playback
- `videoRef` lives in App, passed to Canvas
- Seek: sets `video.src` + `video.currentTime` based on active VideoSegment
- Play: RAF loop syncs `currentTimeSec` to wall clock; re-syncs video if >0.2s drift
- Text visibility: shown when `currentTimeSec` in `[startUs/1e6, (startUs+durationUs)/1e6)`

### IPC Surface (`main/index.ts`)
| Channel | Direction | What |
|---------|-----------|------|
| `open-video` | invoke | File dialog → ffprobe → `{path, name, durationSec}` |
| `get-video-info` | invoke | ffprobe on given path (for drag-drop) → same shape |
| `save-project` | invoke | Save dialog → write JSON |
| `load-project` | invoke | Open dialog → read JSON |
| `export-video` | invoke | FFmpeg spawn multi-clip concat + drawtext |
| `export-progress` | push | FFmpeg stderr lines |

### FFmpeg Export
- Each VideoSegment → `-ss sourceStart -t sourceDur -i path`
- Scale each → `concat` → `[vcat]`
- `drawtext` for each TextSegment with `x=(w/2)-(text_w/2)`, `borderw` for outline
- Font: `/Users/danieldsouza/Downloads/tiktok-text-display-cufonfonts/TikTokTextMedium.otf`

### Known Gotchas
- preload builds as `index.mjs` — `main/index.ts` references `../preload/index.mjs`
- `webSecurity: false` in webPreferences (allows `file://` video src)
- `sandbox: false` required for preload to use `require('electron')` / `webUtils`
- `will-navigate` prevention added (belt-and-suspenders, but not strictly needed since `navigateOnDragDrop` defaults to false)
- Font `@font-face` uses `file://` URL — build warns "didn't resolve at build time" but resolves fine at runtime in Electron

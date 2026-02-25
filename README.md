# Statonic Editor

A desktop video editor built with Electron, React, and TypeScript. Designed for 9:16 short-form content with a WYSIWYG canvas that matches FFmpeg output exactly.

## How it works

The export pipeline constructs a multi-stage FFmpeg filtergraph at runtime. A black lavfi canvas is used as the base, video segments are individually cropped, scaled, and PTS-shifted before being chained through an overlay graph. Text overlays are rendered to PNGs by the browser's Canvas API and fed into FFmpeg as time-gated looped image inputs — this is what keeps the preview and the export pixel-accurate. Audio tracks are delayed and mixed with adelay and amix.

The timeline supports animated zoom via interpolated scale keyframes, which get compiled into per-frame overlay expressions using FFmpeg's eval=frame mode.

## AI integration

Editor state is exposed to Claude via a companion Model Context Protocol server. This enables:

- Reference video analysis — the editor samples frames at 0.5s intervals, Claude analyses them with vision and returns a structured slot breakdown (hook, techniques, CTA). The user maps their own clips to the detected structure.
- Variation generation — Claude reads the current project and clip library, then writes new project JSON files directly to a watched folder. Each file triggers a live update in the variations panel.

File watching uses Node's `fs.watch` with a full folder rescan on every event to work around macOS FSEvents batching.

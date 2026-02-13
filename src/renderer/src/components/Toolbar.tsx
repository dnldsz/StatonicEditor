import React from 'react'

interface ToolbarProps {
  projectName: string
  onRenameProject: (name: string) => void
  onNew: () => void
  onOpen: () => void
  onSave: () => void
  onAddVideo: () => void
  onAddText: () => void
  isPlaying: boolean
  onTogglePlay: () => void
  onStepBack: () => void
  onStepForward: () => void
  zoom: number
  onZoomChange: (zoom: number) => void
  onExport: () => void
}

const ZOOM_STEPS = [20, 30, 50, 75, 100, 150, 200, 300, 500]

export default function Toolbar({
  projectName, onRenameProject,
  onNew, onOpen, onSave,
  onAddVideo, onAddText,
  isPlaying, onTogglePlay, onStepBack, onStepForward,
  zoom, onZoomChange,
  onExport
}: ToolbarProps): JSX.Element {
  const zoomIn = () => {
    const next = ZOOM_STEPS.find((z) => z > zoom)
    if (next) onZoomChange(next)
  }
  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom)
    if (prev) onZoomChange(prev)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <button className="btn" onClick={onNew} title="New project">New</button>
        <button className="btn" onClick={onOpen} title="Open project">Open</button>
        <button className="btn" onClick={onSave} title="Save project">Save</button>
      </div>

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button className="btn" onClick={onAddVideo} title="Add video clip">+ Video</button>
        <button className="btn" onClick={onAddText} title="Add text overlay">+ Text</button>
      </div>

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button className="btn btn-icon" onClick={onStepBack} title="Step back (1 frame)">◀◀</button>
        <button className="btn btn-play" onClick={onTogglePlay} title="Play/Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="btn btn-icon" onClick={onStepForward} title="Step forward (1 frame)">▶▶</button>
      </div>

      <div className="toolbar-sep" />

      <input
        className="project-name-input"
        value={projectName}
        onChange={(e) => onRenameProject(e.target.value)}
        onFocus={(e) => e.target.select()}
      />

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button className="btn btn-icon" onClick={zoomOut} title="Zoom out timeline">−</button>
        <span className="zoom-display">{zoom}px/s</span>
        <button className="btn btn-icon" onClick={zoomIn} title="Zoom in timeline">+</button>
      </div>

      <div className="toolbar-sep" />

      <button className="btn btn-primary" onClick={onExport} title="Export video with FFmpeg">
        Export
      </button>
    </div>
  )
}

import React from 'react'
import { Account } from '../types'
import AccountDropdown from './AccountDropdown'

interface ToolbarProps {
  projectName: string
  onRenameProject: (name: string) => void
  onNew: () => void
  onOpen: () => void
  onOpenFolder: () => void
  onSave: () => void
  onAddVideo: () => void
  onAddText: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  zoom: number
  onZoomChange: (zoom: number) => void
  onExport: () => void
  mode: 'single' | 'batch'
  onExitBatch: () => void
  accounts: Account[]
  currentAccountId: string | null
  onSelectAccount: (accountId: string) => void
}

const ZOOM_STEPS = [20, 30, 50, 75, 100, 150, 200, 300, 500]

export default function Toolbar({
  projectName, onRenameProject,
  onNew, onOpen, onOpenFolder, onSave,
  onAddVideo, onAddText,
  canUndo, canRedo, onUndo, onRedo,
  zoom, onZoomChange,
  onExport,
  mode, onExitBatch,
  accounts, currentAccountId, onSelectAccount
}: ToolbarProps): JSX.Element {
  const zoomIn  = () => { const next = ZOOM_STEPS.find((z) => z > zoom); if (next) onZoomChange(next) }
  const zoomOut = () => { const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom); if (prev) onZoomChange(prev) }

  return (
    <div className="toolbar">
      <div className="toolbar-spacer" />

      <AccountDropdown
        accounts={accounts}
        currentAccountId={currentAccountId}
        onSelectAccount={onSelectAccount}
      />

      <div className="toolbar-sep" />

      {mode === 'batch' ? (
        <div className="toolbar-group">
          <button className="btn" onClick={onExitBatch} title="Exit batch mode">← Exit Batch</button>
        </div>
      ) : (
        <div className="toolbar-group">
          <button className="btn" onClick={onNew}  title="New project">New</button>
          <button className="btn" onClick={onOpen} title="Open project">Open</button>
          <button className="btn" onClick={onOpenFolder} title="Open batch folder">Open Folder</button>
          <button className="btn" onClick={onSave} title="Save project (⌘S)">Save</button>
        </div>
      )}

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button
          className="btn btn-icon"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >↩</button>
        <button
          className="btn btn-icon"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
        >↪</button>
      </div>

      <div className="toolbar-sep" />

      <div className="toolbar-group">
        <button className="btn" onClick={onAddVideo} title="Add video clip">+ Video</button>
        <button className="btn" onClick={onAddText}  title="Add text overlay">+ Text</button>
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
        <button className="btn btn-icon" onClick={zoomIn}  title="Zoom in timeline">+</button>
      </div>

      <div className="toolbar-sep" />

      <button className="btn btn-primary" onClick={onExport} title="Export video">
        Export
      </button>
    </div>
  )
}

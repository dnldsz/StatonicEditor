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
  onVariations: () => void
  mode: 'single' | 'batch'
  onExitBatch: () => void
  accounts: Account[]
  currentAccountId: string | null
  onSelectAccount: (accountId: string) => void
  lastSavedTime: Date | null
}

const ZOOM_STEPS = [20, 30, 50, 75, 100, 150, 200, 300, 500]

export default function Toolbar({
  projectName, onRenameProject,
  onNew, onOpen, onOpenFolder, onSave,
  onAddVideo, onAddText,
  canUndo, canRedo, onUndo, onRedo,
  zoom, onZoomChange,
  onExport, onVariations,
  mode, onExitBatch,
  accounts, currentAccountId, onSelectAccount,
  lastSavedTime
}: ToolbarProps): JSX.Element {
  const zoomIn  = () => { const next = ZOOM_STEPS.find((z) => z > zoom); if (next) onZoomChange(next) }
  const zoomOut = () => { const prev = [...ZOOM_STEPS].reverse().find((z) => z < zoom); if (prev) onZoomChange(prev) }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-spacer" />
        <AccountDropdown
          accounts={accounts}
          currentAccountId={currentAccountId}
          onSelectAccount={onSelectAccount}
        />
      </div>

      <div className="toolbar-middle">
        {mode === 'batch' ? (
          <button className="btn" onClick={onExitBatch} title="Exit batch mode">← Exit Batch</button>
        ) : (
          <>
            <button className="btn" onClick={onNew}  title="New project">New</button>
            <button className="btn" onClick={onOpen} title="Open project">Open</button>
            <button className="btn" onClick={onOpenFolder} title="Open batch folder">Batch Edit</button>
            <button className="btn" onClick={onSave} title="Save project (⌘S)">Save</button>
            <button className="btn" onClick={onVariations} title="Create variations of this project">Variations</button>
          </>
        )}
      </div>

      <div className="toolbar-right">
        <div className="project-name-container">
          <input
            className="project-name-input"
            value={projectName}
            onChange={(e) => onRenameProject(e.target.value)}
            onFocus={(e) => e.target.select()}
            size={Math.max(10, projectName.length)}
            style={{ width: `${Math.max(80, projectName.length * 7.2 + 5)}px` }}
          />
          {lastSavedTime && (
            <span className="last-saved-time">
              {' '}last saved {formatTime(lastSavedTime)}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button className="btn btn-primary" onClick={onExport} title="Export video">
          Export
        </button>
      </div>
    </div>
  )
}

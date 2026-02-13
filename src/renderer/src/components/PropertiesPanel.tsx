import React from 'react'
import { Segment, TextSegment, VideoSegment } from '../types'

interface PropertiesPanelProps {
  segment: Segment | null
  onUpdate: (id: string, patch: Partial<TextSegment>) => void
  onDelete: (id: string) => void
}

function VideoProps({ seg, onDelete }: { seg: VideoSegment; onDelete: (id: string) => void }) {
  return (
    <div className="properties-panel">
      <h3>Video Clip</h3>

      <div className="prop-group">
        <span className="prop-label">Name</span>
        <div className="prop-input" style={{ color: '#888', fontSize: 12 }}>{seg.name}</div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Duration</span>
        <div className="prop-input" style={{ color: '#888', fontSize: 12 }}>
          {(seg.durationUs / 1e6).toFixed(2)}s
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Source start</span>
        <div className="prop-input" style={{ color: '#888', fontSize: 12 }}>
          {(seg.sourceStartUs / 1e6).toFixed(3)}s
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">File path</span>
        <div
          className="prop-input"
          style={{ color: '#666', fontSize: 10, wordBreak: 'break-all', lineHeight: 1.4 }}
        >
          {seg.src}
        </div>
      </div>

      <div className="prop-group">
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={() => onDelete(seg.id)}
        >
          Delete Clip
        </button>
      </div>
    </div>
  )
}

function TextProps({
  seg, onUpdate, onDelete
}: {
  seg: TextSegment
  onUpdate: (id: string, patch: Partial<TextSegment>) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="properties-panel">
      <h3>Text Overlay</h3>

      <div className="prop-group">
        <span className="prop-label">Text</span>
        <textarea
          className="prop-input"
          value={seg.text}
          onChange={(e) => onUpdate(seg.id, { text: e.target.value })}
        />
      </div>

      <div className="prop-group">
        <span className="prop-label">Font size</span>
        <input
          type="number"
          className="prop-number"
          value={seg.fontSize}
          min={8}
          max={300}
          onChange={(e) => onUpdate(seg.id, { fontSize: Number(e.target.value) })}
        />
      </div>

      <div className="prop-group">
        <span className="prop-label">Color</span>
        <div className="prop-row">
          <input
            type="color"
            className="color-swatch"
            value={seg.color}
            onChange={(e) => onUpdate(seg.id, { color: e.target.value })}
          />
          <input
            className="prop-input"
            value={seg.color}
            onChange={(e) => onUpdate(seg.id, { color: e.target.value })}
          />
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Style</span>
        <div className="prop-row">
          <label className="prop-checkbox">
            <input
              type="checkbox"
              checked={seg.bold}
              onChange={(e) => onUpdate(seg.id, { bold: e.target.checked })}
            />
            Bold
          </label>
          <label className="prop-checkbox">
            <input
              type="checkbox"
              checked={seg.italic}
              onChange={(e) => onUpdate(seg.id, { italic: e.target.checked })}
            />
            Italic
          </label>
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Alignment</span>
        <div className="prop-row">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              className={`btn btn-icon${(seg.textAlign ?? 'center') === align ? ' btn-active' : ''}`}
              style={{ flex: 1, fontSize: 16 }}
              onClick={() => onUpdate(seg.id, { textAlign: align })}
              title={align}
            >
              {align === 'left' ? 'L' : align === 'center' ? 'C' : 'R'}
            </button>
          ))}
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Position (X, Y)</span>
        <div className="prop-row">
          <input
            type="number"
            className="prop-number"
            value={seg.x.toFixed(3)}
            step={0.01}
            min={-1}
            max={1}
            onChange={(e) => onUpdate(seg.id, { x: Number(e.target.value) })}
          />
          <input
            type="number"
            className="prop-number"
            value={seg.y.toFixed(3)}
            step={0.01}
            min={-1}
            max={1}
            onChange={(e) => onUpdate(seg.id, { y: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Start time (s)</span>
        <input
          type="number"
          className="prop-number"
          value={(seg.startUs / 1e6).toFixed(3)}
          step={0.1}
          min={0}
          onChange={(e) => onUpdate(seg.id, { startUs: Math.round(Number(e.target.value) * 1e6) })}
        />
      </div>

      <div className="prop-group">
        <span className="prop-label">Outline width (px)</span>
        <div className="prop-row">
          <input
            type="number"
            className="prop-number"
            value={Math.round(seg.strokeWidth ?? 0)}
            min={0}
            max={20}
            step={1}
            onChange={(e) => onUpdate(seg.id, { strokeWidth: Number(e.target.value) })}
          />
          <input
            type="color"
            className="color-swatch"
            value={seg.strokeColor ?? '#000000'}
            onChange={(e) => onUpdate(seg.id, { strokeColor: e.target.value })}
          />
          <input
            className="prop-input"
            value={seg.strokeColor ?? '#000000'}
            onChange={(e) => onUpdate(seg.id, { strokeColor: e.target.value })}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Duration (s)</span>
        <input
          type="number"
          className="prop-number"
          value={(seg.durationUs / 1e6).toFixed(3)}
          step={0.1}
          min={0.1}
          onChange={(e) => onUpdate(seg.id, { durationUs: Math.round(Number(e.target.value) * 1e6) })}
        />
      </div>

      <div className="prop-group">
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={() => onDelete(seg.id)}
        >
          Delete Text
        </button>
      </div>
    </div>
  )
}

export default function PropertiesPanel({ segment, onUpdate, onDelete }: PropertiesPanelProps) {
  if (!segment) {
    return (
      <div className="properties-panel">
        <div className="empty-panel">
          Select a segment on the timeline to edit its properties
        </div>
      </div>
    )
  }

  if (segment.type === 'video') {
    return <VideoProps seg={segment as VideoSegment} onDelete={onDelete} />
  }

  return <TextProps seg={segment as TextSegment} onUpdate={onUpdate} onDelete={onDelete} />
}

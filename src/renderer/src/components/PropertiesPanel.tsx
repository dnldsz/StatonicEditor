import React, { useEffect, useState } from 'react'
import { Segment, TextSegment, VideoSegment } from '../types'

const STRIP_H = 68
const STRIP_COUNT = 8

function ClipFilmstrip({ seg }: { seg: VideoSegment }): JSX.Element {
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setFrames([])

    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.src = `file://${seg.src}`;

    (async () => {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) { resolve(); return }
        video.addEventListener('loadedmetadata', () => resolve(), { once: true })
        video.load()
      })
      if (cancelled) return

      const dur = video.duration
      const canvas = document.createElement('canvas')
      const aspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9
      canvas.height = STRIP_H
      canvas.width = Math.round(STRIP_H * aspect)
      const ctx = canvas.getContext('2d')!

      for (let i = 0; i < STRIP_COUNT; i++) {
        if (cancelled) break
        const t = seg.sourceStartUs / 1e6 + (i + 0.5) / STRIP_COUNT * (seg.sourceDurationUs / 1e6)
        video.currentTime = Math.max(0, Math.min(t, dur - 0.05))
        await new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true })
          video.addEventListener('error', () => resolve(), { once: true })
        })
        if (cancelled) break
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const url = canvas.toDataURL('image/jpeg', 0.8)
        setFrames((prev) => [...prev, url])
      }
    })().catch(() => {})

    return () => { cancelled = true }
  }, [seg.src, seg.sourceStartUs, seg.sourceDurationUs])

  return (
    <div style={{
      display: 'flex', height: STRIP_H, borderRadius: 4, overflow: 'hidden',
      background: '#111', marginBottom: 12, gap: 1
    }}>
      {frames.length === 0
        ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 11 }}>Loading frames…</div>
        : frames.map((url, i) => (
          <img key={i} src={url} style={{ flex: 1, height: STRIP_H, objectFit: 'cover', minWidth: 0 }} draggable={false} />
        ))
      }
    </div>
  )
}

interface PropertiesPanelProps {
  segment: Segment | null
  onUpdate: (id: string, patch: Partial<Segment>) => void
  onDelete: (id: string) => void
}

function VideoProps({
  seg, onUpdate, onDelete
}: {
  seg: VideoSegment
  onUpdate: (id: string, patch: Partial<VideoSegment>) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="properties-panel">
      <h3>Clip Preview</h3>
      <ClipFilmstrip seg={seg} />

      <div className="prop-group">
        <span className="prop-label">Scale</span>
        <input
          type="number"
          className="prop-number"
          value={(seg.clipScale ?? 1).toFixed(2)}
          step={0.05}
          min={0.05}
          max={5}
          onChange={(e) => onUpdate(seg.id, { clipScale: Number(e.target.value) })}
        />
      </div>

      <div className="prop-group">
        <span className="prop-label">Position (X, Y)</span>
        <div className="prop-row">
          <input
            type="number"
            className="prop-number"
            value={(seg.clipX ?? 0).toFixed(3)}
            step={0.01}
            onChange={(e) => onUpdate(seg.id, { clipX: Number(e.target.value) })}
          />
          <input
            type="number"
            className="prop-number"
            value={(seg.clipY ?? 0).toFixed(3)}
            step={0.01}
            onChange={(e) => onUpdate(seg.id, { clipY: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">Duration</span>
        <div className="prop-input" style={{ color: '#888', fontSize: 12 }}>
          {(seg.durationUs / 1e6).toFixed(2)}s
        </div>
      </div>

      <div className="prop-group">
        <span className="prop-label">File</span>
        <div className="prop-input" style={{ color: '#666', fontSize: 10, wordBreak: 'break-all', lineHeight: 1.4 }}>
          {seg.name}
        </div>
      </div>

      <div className="prop-group">
        <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => onDelete(seg.id)}>
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
          value={seg.fontSize.toFixed(1)}
          min={8}
          max={300}
          step={0.1}
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
        <span className="prop-label">Outline</span>
        <div className="prop-row">
          <label className="prop-checkbox">
            <input
              type="checkbox"
              checked={seg.strokeEnabled ?? false}
              onChange={(e) => onUpdate(seg.id, { strokeEnabled: e.target.checked })}
            />
            Enabled
          </label>
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
    return <VideoProps seg={segment as VideoSegment} onUpdate={onUpdate as any} onDelete={onDelete} />
  }

  return <TextProps seg={segment as TextSegment} onUpdate={onUpdate} onDelete={onDelete} />
}

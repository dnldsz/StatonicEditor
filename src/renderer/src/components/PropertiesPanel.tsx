import React, { useEffect, useState } from 'react'
import { Segment, TextSegment, VideoSegment, ScaleKeyframe } from '../types'

function getInterpolatedScale(seg: VideoSegment, timeWithinSegMs: number): number {
  if (!seg.scaleKeyframes || seg.scaleKeyframes.length === 0) return seg.clipScale
  const kfs = [...seg.scaleKeyframes].sort((a, b) => a.timeMs - b.timeMs)
  if (timeWithinSegMs <= kfs[0].timeMs) return kfs[0].scale
  if (timeWithinSegMs >= kfs[kfs.length - 1].timeMs) return kfs[kfs.length - 1].scale
  for (let i = 0; i < kfs.length - 1; i++) {
    const k1 = kfs[i], k2 = kfs[i + 1]
    if (timeWithinSegMs >= k1.timeMs && timeWithinSegMs <= k2.timeMs) {
      const t = (timeWithinSegMs - k1.timeMs) / (k2.timeMs - k1.timeMs)
      return k1.scale + (k2.scale - k1.scale) * t
    }
  }
  return seg.clipScale
}

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

// ── Alignment icons ───────────────────────────────────────────────────────────

function AlignLeftIcon() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
      <rect x="0" y="0" width="15" height="2" rx="1"/>
      <rect x="0" y="4.5" width="9" height="2" rx="1"/>
      <rect x="0" y="9" width="15" height="2" rx="1"/>
    </svg>
  )
}

function AlignCenterIcon() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
      <rect x="0" y="0" width="15" height="2" rx="1"/>
      <rect x="3" y="4.5" width="9" height="2" rx="1"/>
      <rect x="0" y="9" width="15" height="2" rx="1"/>
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
      <rect x="0" y="0" width="15" height="2" rx="1"/>
      <rect x="6" y="4.5" width="9" height="2" rx="1"/>
      <rect x="0" y="9" width="15" height="2" rx="1"/>
    </svg>
  )
}

// ── Panel components ──────────────────────────────────────────────────────────

interface PropertiesPanelProps {
  segment: Segment | null
  currentTimeSec: number
  onUpdate: (id: string, patch: Partial<Segment>) => void
  onDelete: (id: string) => void
}

function VideoProps({
  seg, currentTimeSec, onUpdate, onDelete
}: {
  seg: VideoSegment
  currentTimeSec: number
  onUpdate: (id: string, patch: Partial<VideoSegment>) => void
  onDelete: (id: string) => void
}) {
  const segStartSec = seg.startUs / 1e6
  const timeWithinSegMs = (currentTimeSec - segStartSec) * 1000
  const currentScale = getInterpolatedScale(seg, timeWithinSegMs)
  return (
    <div className="properties-panel">
      <h3>Clip Preview</h3>
      <ClipFilmstrip seg={seg} />

      <div className="prop-group">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="prop-label" style={{ marginBottom: 0 }}>Scale</span>
          <button
            style={{
              background: 'transparent',
              border: 'none',
              color: seg.scaleKeyframes?.some(kf => Math.abs(kf.timeMs - timeWithinSegMs) < 100) ? '#0a7ef0' : '#666',
              cursor: 'pointer',
              padding: '2px 4px',
              fontSize: 16,
              lineHeight: 1,
              fontWeight: 'bold'
            }}
            title={seg.scaleKeyframes?.some(kf => Math.abs(kf.timeMs - timeWithinSegMs) < 100)
              ? "Remove keyframe at current time"
              : "Add keyframe at current time"}
            onClick={() => {
              const kfs = seg.scaleKeyframes || []
              const existingIdx = kfs.findIndex(kf => Math.abs(kf.timeMs - timeWithinSegMs) < 100)

              if (existingIdx >= 0) {
                // Remove keyframe at current time
                const updated = kfs.filter((_, i) => i !== existingIdx)
                onUpdate(seg.id, { scaleKeyframes: updated.length > 0 ? updated : undefined })
              } else {
                // Add keyframe at current time
                const newKf: ScaleKeyframe = { timeMs: Math.max(0, timeWithinSegMs), scale: currentScale }
                const updated = [...kfs, newKf].sort((a, b) => a.timeMs - b.timeMs)
                onUpdate(seg.id, { scaleKeyframes: updated })
              }
            }}
          >
            ◆
          </button>
          <input
            type="number"
            className="prop-number"
            style={{ flex: 1 }}
            value={currentScale.toFixed(2)}
            step={0.05}
            min={0.05}
            max={5}
            onChange={(e) => {
              const newScale = Number(e.target.value)
              const kfs = seg.scaleKeyframes || []
              const existingIdx = kfs.findIndex(kf => Math.abs(kf.timeMs - timeWithinSegMs) < 100)

              if (existingIdx >= 0) {
                // Update existing keyframe
                const updated = kfs.map((k, i) => i === existingIdx ? { ...k, scale: newScale } : k)
                onUpdate(seg.id, { scaleKeyframes: updated })
              } else if (kfs.length > 0) {
                // Add new keyframe with this value
                const newKf: ScaleKeyframe = { timeMs: Math.max(0, timeWithinSegMs), scale: newScale }
                const updated = [...kfs, newKf].sort((a, b) => a.timeMs - b.timeMs)
                onUpdate(seg.id, { scaleKeyframes: updated })
              } else {
                // No keyframes - update base scale
                onUpdate(seg.id, { clipScale: newScale })
              }
            }}
          />
        </div>

        {/* Keyframe timeline */}
        {seg.scaleKeyframes && seg.scaleKeyframes.length > 0 && (
          <div style={{
            position: 'relative',
            height: 24,
            background: '#1a1a1a',
            borderRadius: 3,
            marginTop: 4,
            border: '1px solid #333'
          }}>
            {/* Current time indicator */}
            <div style={{
              position: 'absolute',
              left: `${Math.max(0, Math.min(100, (timeWithinSegMs / (seg.durationUs / 1000)) * 100))}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#fff',
              opacity: 0.5,
              pointerEvents: 'none'
            }} />

            {/* Keyframe diamonds */}
            {seg.scaleKeyframes.map((kf, idx) => {
              const position = (kf.timeMs / (seg.durationUs / 1000)) * 100
              const isAtCurrentTime = Math.abs(kf.timeMs - timeWithinSegMs) < 100

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${position}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    color: isAtCurrentTime ? '#0a7ef0' : '#888',
                    fontWeight: 'bold',
                    textShadow: '0 0 3px #000'
                  }}
                  title={`${(kf.timeMs / 1000).toFixed(2)}s: ${kf.scale.toFixed(2)}`}
                  onClick={() => {
                    // Jump to this keyframe time
                    const targetTimeSec = seg.startUs / 1e6 + kf.timeMs / 1000
                    // We can't directly set time here, but we could emit an event
                    // For now, just select/deselect
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    // Delete keyframe on right-click
                    const updated = seg.scaleKeyframes!.filter((_, i) => i !== idx)
                    onUpdate(seg.id, { scaleKeyframes: updated.length > 0 ? updated : undefined })
                  }}
                >
                  ◆
                </div>
              )
            })}
          </div>
        )}
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
  const align = seg.textAlign ?? 'center'

  return (
    <div className="properties-panel">

      {/* ── Text content ──────────────────────────────────────────────── */}
      <div className="prop-group">
        <textarea
          className="prop-input"
          value={seg.text}
          rows={3}
          onChange={(e) => onUpdate(seg.id, { text: e.target.value })}
        />
      </div>

      {/* ── Typography ────────────────────────────────────────────────── */}
      <div className="prop-group">
        <span className="prop-label">Typography</span>
        <div className="prop-row">
          <input
            type="number"
            className="prop-number"
            style={{ flex: 1 }}
            value={seg.fontSize.toFixed(1)}
            min={8}
            max={300}
            step={1}
            onChange={(e) => onUpdate(seg.id, { fontSize: Number(e.target.value) })}
          />
          <button
            className={`btn btn-icon${seg.bold ? ' btn-active' : ''}`}
            style={{ fontWeight: 700, fontFamily: 'inherit' }}
            onClick={() => onUpdate(seg.id, { bold: !seg.bold })}
            title="Bold"
          >B</button>
          <button
            className={`btn btn-icon${seg.italic ? ' btn-active' : ''}`}
            style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}
            onClick={() => onUpdate(seg.id, { italic: !seg.italic })}
            title="Italic"
          >I</button>
        </div>
      </div>

      {/* ── Alignment ─────────────────────────────────────────────────── */}
      <div className="prop-group">
        <span className="prop-label">Alignment</span>
        <div className="prop-row">
          {([['left', <AlignLeftIcon />], ['center', <AlignCenterIcon />], ['right', <AlignRightIcon />]] as const).map(([a, icon]) => (
            <button
              key={a}
              className={`btn btn-icon${align === a ? ' btn-active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => onUpdate(seg.id, { textAlign: a })}
              title={a}
            >{icon}</button>
          ))}
        </div>
      </div>

      {/* ── Colour ────────────────────────────────────────────────────── */}
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

      {/* ── Outline ───────────────────────────────────────────────────── */}
      <div className="prop-group">
        <div className="prop-row" style={{ marginBottom: seg.strokeEnabled ? 6 : 0 }}>
          <label className="prop-checkbox" style={{ flex: 1 }}>
            <input
              type="checkbox"
              checked={seg.strokeEnabled ?? false}
              onChange={(e) => onUpdate(seg.id, { strokeEnabled: e.target.checked })}
            />
            <span className="prop-label" style={{ margin: 0 }}>Outline</span>
          </label>
        </div>
        {seg.strokeEnabled && (
          <div className="prop-row">
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
            />
          </div>
        )}
      </div>

      <div className="prop-divider" />

      {/* ── Timing ────────────────────────────────────────────────────── */}
      <div className="prop-group">
        <span className="prop-label">Timing</span>
        <div className="prop-row">
          <div style={{ flex: 1 }}>
            <div className="prop-sublabel">Start</div>
            <input
              type="number"
              className="prop-number"
              style={{ width: '100%' }}
              value={(seg.startUs / 1e6).toFixed(2)}
              step={0.1}
              min={0}
              onChange={(e) => onUpdate(seg.id, { startUs: Math.round(Number(e.target.value) * 1e6) })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div className="prop-sublabel">Duration</div>
            <input
              type="number"
              className="prop-number"
              style={{ width: '100%' }}
              value={(seg.durationUs / 1e6).toFixed(2)}
              step={0.1}
              min={0.1}
              onChange={(e) => onUpdate(seg.id, { durationUs: Math.round(Number(e.target.value) * 1e6) })}
            />
          </div>
        </div>
      </div>

      {/* ── Position ──────────────────────────────────────────────────── */}
      <div className="prop-group">
        <span className="prop-label">Position (X, Y)</span>
        <div className="prop-row">
          <input
            type="number"
            className="prop-number"
            style={{ flex: 1 }}
            value={seg.x.toFixed(3)}
            step={0.01}
            min={-1}
            max={1}
            onChange={(e) => onUpdate(seg.id, { x: Number(e.target.value) })}
          />
          <input
            type="number"
            className="prop-number"
            style={{ flex: 1 }}
            value={seg.y.toFixed(3)}
            step={0.01}
            min={-1}
            max={1}
            onChange={(e) => onUpdate(seg.id, { y: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="prop-group" style={{ marginTop: 8 }}>
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

export default function PropertiesPanel({ segment, currentTimeSec, onUpdate, onDelete }: PropertiesPanelProps) {
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
    return <VideoProps seg={segment as VideoSegment} currentTimeSec={currentTimeSec} onUpdate={onUpdate as any} onDelete={onDelete} />
  }

  return <TextProps seg={segment as TextSegment} onUpdate={onUpdate} onDelete={onDelete} />
}

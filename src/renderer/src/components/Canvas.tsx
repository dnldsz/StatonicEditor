import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Project, TextSegment } from '../types'

interface CanvasProps {
  project: Project
  currentTimeSec: number
  selectedId: string | null
  videoRef: RefObject<HTMLVideoElement>
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (id: string, patch: Partial<TextSegment>) => void
}

const SNAP_THRESHOLD = 0.04  // canvas-space units
const HANDLE_SIZE = 10

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const handleStyle = (dir: HandleDir): React.CSSProperties => {
  const h = HANDLE_SIZE
  const half = -h / 2
  const base: React.CSSProperties = {
    position: 'absolute',
    width: h,
    height: h,
    background: '#fff',
    border: '2px solid #0a7ef0',
    borderRadius: 2,
    zIndex: 10,
    boxSizing: 'border-box'
  }
  switch (dir) {
    case 'nw': return { ...base, top: half, left: half, cursor: 'nw-resize' }
    case 'n':  return { ...base, top: half, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' }
    case 'ne': return { ...base, top: half, right: half, cursor: 'ne-resize' }
    case 'e':  return { ...base, top: '50%', right: half, transform: 'translateY(-50%)', cursor: 'e-resize' }
    case 'se': return { ...base, bottom: half, right: half, cursor: 'se-resize' }
    case 's':  return { ...base, bottom: half, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' }
    case 'sw': return { ...base, bottom: half, left: half, cursor: 'sw-resize' }
    case 'w':  return { ...base, top: '50%', left: half, transform: 'translateY(-50%)', cursor: 'w-resize' }
  }
}

// Scale delta sign by direction: positive = grow
function scaleSign(dir: HandleDir): number {
  if (dir === 'se' || dir === 'e' || dir === 's') return 1
  if (dir === 'nw' || dir === 'w' || dir === 'n') return -1
  if (dir === 'ne') return 1
  if (dir === 'sw') return -1
  return 1
}

export default function Canvas({
  project, currentTimeSec, selectedId, videoRef,
  onSelectSegment, onUpdateSegment
}: CanvasProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const moveDragRef = useRef<{
    id: string; startX: number; startY: number; origX: number; origY: number
  } | null>(null)
  const scaleDragRef = useRef<{
    id: string; dir: HandleDir; startX: number; startY: number
    origFontSize: number; origStrokeWidth: number
    previewScale: number
  } | null>(null)
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })
  const [previewWidth, setPreviewWidth] = useState(0)

  const { canvas } = project
  const aspect = canvas.width / canvas.height

  // Track the rendered width of the canvas wrapper so text can scale with it
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setPreviewWidth(w)
    })
    observer.observe(el)
    const w = el.getBoundingClientRect().width
    if (w > 0) setPreviewWidth(w)
    return () => observer.disconnect()
  }, [])

  // fontSize and strokeWidth are stored in canonical export pixels (1080-wide space).
  // Scale them down to the current preview size for CSS rendering.
  const previewScale = previewWidth > 0 ? previewWidth / canvas.width : 1

  // Visible text overlays at currentTimeSec
  const visibleTexts: TextSegment[] = []
  for (const track of project.tracks) {
    if (track.type !== 'text') continue
    for (const seg of track.segments) {
      if (seg.type !== 'text') continue
      const start = seg.startUs / 1e6
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (currentTimeSec >= start && currentTimeSec < end) {
        visibleTexts.push(seg)
      }
    }
  }

  const getRect = useCallback(() => wrapperRef.current?.getBoundingClientRect() ?? null, [])

  // ── Move drag ───────────────────────────────────────────────────────────────
  const startMoveDrag = useCallback((e: React.MouseEvent, seg: TextSegment) => {
    e.stopPropagation()
    onSelectSegment(seg.id)
    moveDragRef.current = { id: seg.id, startX: e.clientX, startY: e.clientY, origX: seg.x, origY: seg.y }

    const onMove = (me: MouseEvent) => {
      const drag = moveDragRef.current
      if (!drag) return
      const rect = getRect()
      if (!rect) return
      const dx = (me.clientX - drag.startX) / rect.width * 2
      const dy = (me.clientY - drag.startY) / rect.height * 2
      let newX = Math.max(-1, Math.min(1, drag.origX + dx))
      let newY = Math.max(-1, Math.min(1, drag.origY - dy))

      const snapX = Math.abs(newX) < SNAP_THRESHOLD
      const snapY = Math.abs(newY) < SNAP_THRESHOLD
      if (snapX) newX = 0
      if (snapY) newY = 0
      setSnapGuide({ x: snapX, y: snapY })

      onUpdateSegment(drag.id, { x: newX, y: newY })
    }

    const onUp = () => {
      moveDragRef.current = null
      setSnapGuide({ x: false, y: false })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [getRect, onSelectSegment, onUpdateSegment])

  // ── Scale drag ──────────────────────────────────────────────────────────────
  const startScaleDrag = useCallback((e: React.MouseEvent, seg: TextSegment, dir: HandleDir) => {
    e.stopPropagation()
    e.preventDefault()
    scaleDragRef.current = {
      id: seg.id, dir, startX: e.clientX, startY: e.clientY,
      origFontSize: seg.fontSize, origStrokeWidth: seg.strokeWidth,
      previewScale: wrapperRef.current!.getBoundingClientRect().width / canvas.width
    }

    const onMove = (me: MouseEvent) => {
      const drag = scaleDragRef.current
      if (!drag) return
      const dx = me.clientX - drag.startX
      const dy = me.clientY - drag.startY
      // Convert screen-pixel delta to canonical space before applying
      const diag = ((Math.abs(dx) > Math.abs(dy) ? dx : -dy) * scaleSign(drag.dir)) / drag.previewScale
      const newSize = Math.max(8, Math.round(drag.origFontSize + diag * 0.5))
      const ratio = newSize / drag.origFontSize
      const newStroke = drag.origStrokeWidth * ratio  // keep as float for smooth scaling
      onUpdateSegment(drag.id, { fontSize: newSize, strokeWidth: newStroke })
    }

    const onUp = () => {
      scaleDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onUpdateSegment])

  return (
    <div
      className="canvas-wrapper"
      ref={wrapperRef}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        maxHeight: '100%',
        maxWidth: `calc(100% * ${aspect})`,
        width: 'auto',
        height: '100%',
        position: 'relative'
      }}
      onClick={(e) => { if (e.target === wrapperRef.current) onSelectSegment(null) }}
    >
      <video
        ref={videoRef}
        className="canvas-video"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        playsInline
        preload="auto"
      />

      {/* Snap guides */}
      {snapGuide.x && (
        <div style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0,
          width: 1, background: '#ff3b30', opacity: 0.8,
          transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 30
        }} />
      )}
      {snapGuide.y && (
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          height: 1, background: '#ff3b30', opacity: 0.8,
          transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 30
        }} />
      )}

      {visibleTexts.length === 0 && !videoRef.current?.src && (
        <div className="canvas-overlay-placeholder">
          Add a video clip to get started
        </div>
      )}

      {visibleTexts.map((seg) => {
        const leftPct = ((seg.x + 1) / 2) * 100
        const topPct = ((1 - seg.y) / 2) * 100
        const isSelected = selectedId === seg.id

        // Anchor transform depends on textAlign
        const alignTransform =
          seg.textAlign === 'left' ? 'translate(0, -50%)' :
          seg.textAlign === 'right' ? 'translate(-100%, -50%)' :
          'translate(-50%, -50%)'

        return (
          <div
            key={seg.id}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${topPct}%`,
              transform: alignTransform,
              zIndex: isSelected ? 20 : 10
            }}
          >
            {/* Text itself */}
            <div
              className={`text-overlay${isSelected ? ' selected' : ''}`}
              style={{
                position: 'relative',
                display: 'inline-block',
                fontSize: seg.fontSize * previewScale,
                color: seg.color,
                fontWeight: seg.bold ? 700 : 400,
                fontStyle: seg.italic ? 'italic' : 'normal',
                fontFamily: "'TikTokText', -apple-system, sans-serif",
                // fontSize/strokeWidth are in canonical export pixels; scale to preview.
                // Double the stroke: paint-order:stroke fill hides the inner half.
                WebkitTextStroke: seg.strokeWidth > 0 ? `${seg.strokeWidth * 2 * previewScale}px ${seg.strokeColor}` : undefined,
                cursor: 'move',
                userSelect: 'none',
                whiteSpace: 'pre',
                textAlign: seg.textAlign ?? 'center',
                lineHeight: 1.2,
                padding: '2px 4px'
              }}
              onMouseDown={(e) => startMoveDrag(e, seg)}
              onClick={(e) => { e.stopPropagation(); onSelectSegment(seg.id) }}
            >
              {seg.text}

              {/* Resize handles (only when selected) */}
              {isSelected && HANDLES.map((dir) => (
                <div
                  key={dir}
                  style={handleStyle(dir)}
                  onMouseDown={(e) => startScaleDrag(e, seg, dir)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

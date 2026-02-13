import React, { RefObject, useCallback, useRef } from 'react'
import { Project, TextSegment } from '../types'

interface CanvasProps {
  project: Project
  currentTimeSec: number
  selectedId: string | null
  videoRef: RefObject<HTMLVideoElement>
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (id: string, patch: Partial<TextSegment>) => void
}

export default function Canvas({
  project, currentTimeSec, selectedId, videoRef,
  onSelectSegment, onUpdateSegment
}: CanvasProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

  const { canvas } = project
  const aspect = canvas.width / canvas.height // e.g. 9/16

  // Collect visible text overlays
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

  const getCanvasRect = useCallback(() => {
    const el = wrapperRef.current
    if (!el) return null
    return el.getBoundingClientRect()
  }, [])

  const startDrag = useCallback((e: React.MouseEvent, seg: TextSegment) => {
    e.stopPropagation()
    onSelectSegment(seg.id)
    dragRef.current = {
      id: seg.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: seg.x,
      origY: seg.y
    }

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const rect = getCanvasRect()
      if (!rect) return
      const dx = (me.clientX - dragRef.current.startX) / rect.width * 2
      const dy = (me.clientY - dragRef.current.startY) / rect.height * 2
      const newX = Math.max(-1, Math.min(1, dragRef.current.origX + dx))
      const newY = Math.max(-1, Math.min(1, dragRef.current.origY - dy))
      onUpdateSegment(dragRef.current.id, { x: newX, y: newY })
    }

    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [getCanvasRect, onSelectSegment, onUpdateSegment])

  return (
    <div
      className="canvas-wrapper"
      ref={wrapperRef}
      style={{
        // Constrain by available space while keeping 9:16 aspect ratio
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        maxHeight: '100%',
        maxWidth: `calc(100% * ${aspect})`,
        width: 'auto',
        height: '100%'
      }}
      onClick={(e) => {
        if (e.target === wrapperRef.current) onSelectSegment(null)
      }}
    >
      <video
        ref={videoRef}
        className="canvas-video"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        playsInline
        preload="auto"
      />

      {visibleTexts.length === 0 && !videoRef.current?.src && (
        <div className="canvas-overlay-placeholder">
          Add a video clip to get started
        </div>
      )}

      {visibleTexts.map((seg) => {
        const leftPct = ((seg.x + 1) / 2) * 100
        const topPct = ((1 - seg.y) / 2) * 100
        return (
          <div
            key={seg.id}
            className={`text-overlay${selectedId === seg.id ? ' selected' : ''}`}
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              fontSize: `${seg.fontSize}px`,
              color: seg.color,
              fontWeight: seg.bold ? 700 : 400,
              fontStyle: seg.italic ? 'italic' : 'normal'
            }}
            onMouseDown={(e) => startDrag(e, seg)}
            onClick={(e) => { e.stopPropagation(); onSelectSegment(seg.id) }}
          >
            {seg.text}
          </div>
        )
      })}
    </div>
  )
}

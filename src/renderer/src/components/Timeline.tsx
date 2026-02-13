import React, { useEffect, useRef } from 'react'
import { Project, Segment } from '../types'

const LABEL_W = 88
const TRACK_H = 44
const RULER_H = 28

interface DragState {
  kind: 'seek' | 'move' | 'resize-left' | 'resize-right'
  segId?: string
  startX: number
  startUs?: number      // segment.startUs at drag start
  durationUs?: number   // segment.durationUs at drag start
}

interface TimelineProps {
  project: Project
  currentTimeSec: number
  selectedId: string | null
  zoom: number
  onSeek: (t: number) => void
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (id: string, patch: Partial<Segment>) => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return m > 0 ? `${m}:${s}` : `${s}s`
}

function getRulerInterval(zoom: number): { major: number; minor: number } {
  if (zoom >= 200) return { major: 0.5, minor: 0.1 }
  if (zoom >= 100) return { major: 1, minor: 0.25 }
  if (zoom >= 50) return { major: 2, minor: 0.5 }
  return { major: 5, minor: 1 }
}

export default function Timeline({
  project, currentTimeSec, selectedId, zoom,
  onSeek, onSelectSegment, onUpdateSegment
}: TimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  // Total duration in seconds
  let totalSec = 10
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (end > totalSec) totalSec = end
    }
  }
  totalSec += 5 // padding

  const innerWidth = LABEL_W + totalSec * zoom

  // Ruler ticks
  const { major, minor } = getRulerInterval(zoom)
  const ticks: Array<{ t: number; isMajor: boolean }> = []
  for (let t = 0; t <= totalSec + minor; t = parseFloat((t + minor).toFixed(6))) {
    ticks.push({ t, isMajor: Math.abs(t % major) < 0.001 || Math.abs(t % major - major) < 0.001 })
  }

  // Mouse event handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag || !containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const scrollLeft = containerRef.current.scrollLeft
      const dx = e.clientX - drag.startX
      const dt = dx / zoom // seconds

      if (drag.kind === 'seek') {
        const rawX = e.clientX - rect.left + scrollLeft - LABEL_W
        const t = Math.max(0, rawX / zoom)
        onSeek(t)
        return
      }

      if (!drag.segId) return
      const dtUs = Math.round(dt * 1e6)

      if (drag.kind === 'move') {
        const newStart = Math.max(0, drag.startUs! + dtUs)
        onUpdateSegment(drag.segId, { startUs: newStart })
      } else if (drag.kind === 'resize-left') {
        const newStart = Math.max(0, drag.startUs! + dtUs)
        const delta = newStart - drag.startUs!
        const newDur = Math.max(100_000, drag.durationUs! - delta)
        const adjustedStart = drag.startUs! + (drag.durationUs! - newDur)
        onUpdateSegment(drag.segId, { startUs: adjustedStart, durationUs: newDur })
      } else if (drag.kind === 'resize-right') {
        const newDur = Math.max(100_000, drag.durationUs! + dtUs)
        onUpdateSegment(drag.segId, { durationUs: newDur })
      }
    }

    const onUp = () => {
      dragRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [zoom, onSeek, onUpdateSegment])

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const scrollLeft = containerRef.current.scrollLeft
    const rawX = e.clientX - rect.left + scrollLeft - LABEL_W
    const t = Math.max(0, rawX / zoom)
    onSeek(t)
    dragRef.current = { kind: 'seek', startX: e.clientX }
    e.preventDefault()
  }

  const handleSegmentMouseDown = (
    e: React.MouseEvent,
    seg: Segment,
    kind: 'move' | 'resize-left' | 'resize-right'
  ) => {
    e.stopPropagation()
    onSelectSegment(seg.id)
    dragRef.current = {
      kind,
      segId: seg.id,
      startX: e.clientX,
      startUs: seg.startUs,
      durationUs: seg.durationUs
    }
    e.preventDefault()
  }

  const playheadLeft = LABEL_W + currentTimeSec * zoom

  return (
    <div className="timeline-root" ref={containerRef}>
      <div className="timeline-inner" style={{ width: innerWidth, minHeight: '100%' }}>

        {/* Ruler */}
        <div className="ruler" style={{ width: innerWidth }}>
          <div className="ruler-corner" style={{ width: LABEL_W, height: RULER_H }} />
          <div
            className="ruler-ticks"
            style={{ height: RULER_H, position: 'relative' }}
            onMouseDown={handleRulerMouseDown}
          >
            {ticks.map(({ t, isMajor }) => {
              const left = t * zoom
              return (
                <React.Fragment key={t}>
                  <div
                    className={`ruler-tick ${isMajor ? 'major' : 'minor'}`}
                    style={{ left }}
                  />
                  {isMajor && (
                    <span className="ruler-tick-label" style={{ left }}>
                      {formatTime(t)}
                    </span>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {/* Track rows */}
        {project.tracks.map((track) => (
          <div key={track.id} className="track-row" style={{ height: TRACK_H }}>
            <div className="track-label" style={{ width: LABEL_W, height: TRACK_H }}>
              {track.label}
            </div>
            <div className="track-segments" style={{ position: 'relative', height: TRACK_H }}>
              {track.segments.map((seg) => {
                const left = seg.startUs / 1e6 * zoom
                const width = Math.max(8, seg.durationUs / 1e6 * zoom)
                const isSelected = seg.id === selectedId
                const label = seg.type === 'video' ? (seg as any).name : (seg as any).text
                return (
                  <div
                    key={seg.id}
                    className={`segment type-${seg.type}${isSelected ? ' selected' : ''}`}
                    style={{ left, width }}
                    onClick={(e) => { e.stopPropagation(); onSelectSegment(seg.id) }}
                    onMouseDown={(e) => handleSegmentMouseDown(e, seg, 'move')}
                  >
                    {/* Left resize handle */}
                    <div
                      className="resize-handle resize-handle-left"
                      onMouseDown={(e) => handleSegmentMouseDown(e, seg, 'resize-left')}
                    />
                    <span className="segment-label">{label}</span>
                    {/* Right resize handle */}
                    <div
                      className="resize-handle resize-handle-right"
                      onMouseDown={(e) => handleSegmentMouseDown(e, seg, 'resize-right')}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Playhead (spans full height) */}
        <div
          className="playhead"
          style={{
            left: playheadLeft,
            top: 0,
            height: `${RULER_H + project.tracks.length * TRACK_H}px`
          }}
        />
      </div>
    </div>
  )
}

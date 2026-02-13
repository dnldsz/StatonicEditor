import React, { useEffect, useRef, useState } from 'react'
import { Project, Segment } from '../types'

const LABEL_W = 88
const TRACK_H = 44
const RULER_H = 28
const SNAP_PX = 8               // snap within 8 screen pixels

// ── Snap utilities ─────────────────────────────────────────────────────────
function collectSnapPoints(project: Project, excludeId?: string): number[] {
  const pts: number[] = [0]
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      if (seg.id === excludeId) continue
      pts.push(seg.startUs)
      pts.push(seg.startUs + seg.durationUs)
    }
  }
  return pts
}

function applySnap(
  valueUs: number,
  snapPts: number[],
  zoom: number
): { value: number; snapAt: number | null } {
  const thresholdUs = (SNAP_PX / zoom) * 1e6
  let best: number | null = null
  let bestDelta = thresholdUs
  for (const sp of snapPts) {
    const d = Math.abs(valueUs - sp)
    if (d < bestDelta) { bestDelta = d; best = sp }
  }
  return best !== null ? { value: best, snapAt: best } : { value: valueUs, snapAt: null }
}

// ── DragState ──────────────────────────────────────────────────────────────
interface DragState {
  kind: 'seek' | 'move' | 'resize-left' | 'resize-right'
  segId?: string
  startX: number
  startUs?: number
  durationUs?: number
}

// ── Props ──────────────────────────────────────────────────────────────────
interface TimelineProps {
  project: Project
  currentTimeSec: number
  selectedId: string | null
  zoom: number
  onSeek: (t: number) => void
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (id: string, patch: Partial<Segment>) => void
  onDropVideo: (filePath: string) => void
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

// ── Timeline ───────────────────────────────────────────────────────────────
export default function Timeline({
  project, currentTimeSec, selectedId, zoom,
  onSeek, onSelectSegment, onUpdateSegment, onDropVideo
}: TimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const snapLineRef = useRef<HTMLDivElement>(null)
  const [dropActive, setDropActive] = useState(false)

  // Stable refs so the mouse event effect doesn't need to re-register on every change
  const zoomRef = useRef(zoom)
  const onSeekRef = useRef(onSeek)
  const onUpdateSegmentRef = useRef(onUpdateSegment)
  const projectRef = useRef(project)
  zoomRef.current = zoom
  onSeekRef.current = onSeek
  onUpdateSegmentRef.current = onUpdateSegment
  projectRef.current = project

  const updateSnapLine = (snapAtUs: number | null) => {
    const el = snapLineRef.current
    if (!el) return
    if (snapAtUs === null) { el.style.display = 'none'; return }
    el.style.left = `${LABEL_W + snapAtUs / 1e6 * zoomRef.current}px`
    el.style.display = 'block'
  }

  // ── Global mouse event handlers (stable, registered once) ─────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag || !containerRef.current) return

      const zoom = zoomRef.current
      const rect = containerRef.current.getBoundingClientRect()
      const scrollLeft = containerRef.current.scrollLeft
      const dx = e.clientX - drag.startX

      if (drag.kind === 'seek') {
        const rawX = e.clientX - rect.left + scrollLeft - LABEL_W
        const rawUs = Math.max(0, rawX / zoom) * 1e6
        const snapPts = collectSnapPoints(projectRef.current)
        const { value, snapAt } = applySnap(rawUs, snapPts, zoom)
        onSeekRef.current(value / 1e6)
        updateSnapLine(snapAt)
        return
      }

      if (!drag.segId) return
      const dtUs = Math.round(dx / zoom * 1e6)
      const snapPts = collectSnapPoints(projectRef.current, drag.segId)

      if (drag.kind === 'move') {
        const naturalUs = Math.max(0, drag.startUs! + dtUs)
        const naturalEndUs = naturalUs + drag.durationUs!
        // Try snapping both leading and trailing edges
        const { value: snappedStart, snapAt: snapA } = applySnap(naturalUs, snapPts, zoom)
        const { value: snappedEnd, snapAt: snapB } = applySnap(naturalEndUs, snapPts, zoom)
        let finalStart: number, snapAt: number | null
        if (snapA !== null && (snapB === null || Math.abs(snappedStart - naturalUs) <= Math.abs(snappedEnd - naturalEndUs))) {
          finalStart = snappedStart; snapAt = snapA
        } else if (snapB !== null) {
          finalStart = snappedEnd - drag.durationUs!; snapAt = snapB
        } else {
          finalStart = naturalUs; snapAt = null
        }
        onUpdateSegmentRef.current(drag.segId, { startUs: Math.max(0, finalStart) })
        updateSnapLine(snapAt)

      } else if (drag.kind === 'resize-left') {
        const naturalUs = Math.max(0, drag.startUs! + dtUs)
        const { value: snapped, snapAt } = applySnap(naturalUs, snapPts, zoom)
        const delta = snapped - drag.startUs!
        const newDur = Math.max(100_000, drag.durationUs! - delta)
        const adjStart = drag.startUs! + (drag.durationUs! - newDur)
        onUpdateSegmentRef.current(drag.segId, { startUs: adjStart, durationUs: newDur })
        updateSnapLine(snapAt)

      } else if (drag.kind === 'resize-right') {
        const naturalEndUs = drag.startUs! + drag.durationUs! + dtUs
        const { value: snapped, snapAt } = applySnap(naturalEndUs, snapPts, zoom)
        const newDur = Math.max(100_000, snapped - drag.startUs!)
        onUpdateSegmentRef.current(drag.segId, { durationUs: newDur })
        updateSnapLine(snapAt)
      }
    }

    const onUp = () => {
      dragRef.current = null
      updateSnapLine(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])  // stable — refs keep values current

  // ── File drag & drop ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onDragOver = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setDropActive(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDropActive(false)
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [])

  // ── Ruler mousedown (seek) ────────────────────────────────────────────────
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

  const handleSegmentMouseDown = (e: React.MouseEvent, seg: Segment, kind: 'move' | 'resize-left' | 'resize-right') => {
    e.stopPropagation()
    onSelectSegment(seg.id)
    dragRef.current = { kind, segId: seg.id, startX: e.clientX, startUs: seg.startUs, durationUs: seg.durationUs }
    e.preventDefault()
  }

  // ── Computed values ────────────────────────────────────────────────────────
  let totalSec = 10
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (end > totalSec) totalSec = end
    }
  }
  totalSec += 5

  const innerWidth = LABEL_W + totalSec * zoom
  const playheadLeft = LABEL_W + currentTimeSec * zoom
  const { major, minor } = getRulerInterval(zoom)
  const ticks: Array<{ t: number; isMajor: boolean }> = []
  for (let t = 0; t <= totalSec + minor; t = parseFloat((t + minor).toFixed(6))) {
    ticks.push({ t, isMajor: Math.abs(t % major) < 0.001 || Math.abs(t % major - major) < 0.001 })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`timeline-root${dropActive ? ' drop-active' : ''}`} ref={containerRef}>
      <div className="timeline-inner" style={{ width: innerWidth, minHeight: '100%' }}>

        {/* Ruler */}
        <div className="ruler" style={{ width: innerWidth }}>
          <div className="ruler-corner" style={{ width: LABEL_W, height: RULER_H }} />
          <div className="ruler-ticks" style={{ height: RULER_H, position: 'relative' }} onMouseDown={handleRulerMouseDown}>
            {ticks.map(({ t, isMajor }) => {
              const left = t * zoom
              return (
                <React.Fragment key={t}>
                  <div className={`ruler-tick ${isMajor ? 'major' : 'minor'}`} style={{ left }} />
                  {isMajor && <span className="ruler-tick-label" style={{ left }}>{formatTime(t)}</span>}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {/* Track rows */}
        {project.tracks.map((track) => (
          <div key={track.id} className="track-row" style={{ height: TRACK_H }}>
            <div className="track-label" style={{ width: LABEL_W, height: TRACK_H }}>{track.label}</div>
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
                    <div className="resize-handle resize-handle-left" onMouseDown={(e) => handleSegmentMouseDown(e, seg, 'resize-left')} />
                    <span className="segment-label">{label}</span>
                    <div className="resize-handle resize-handle-right" onMouseDown={(e) => handleSegmentMouseDown(e, seg, 'resize-right')} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Snap indicator line */}
        <div
          ref={snapLineRef}
          style={{
            position: 'absolute', top: 0,
            height: `${RULER_H + project.tracks.length * TRACK_H}px`,
            width: 2, background: '#f5c518',
            display: 'none', pointerEvents: 'none', zIndex: 25,
            boxShadow: '0 0 4px #f5c518'
          }}
        />

        {/* Playhead */}
        <div
          className="playhead"
          style={{ left: playheadLeft, top: 0, height: `${RULER_H + project.tracks.length * TRACK_H}px` }}
        />
      </div>
    </div>
  )
}

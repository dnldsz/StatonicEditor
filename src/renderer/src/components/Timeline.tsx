import React, { useEffect, useRef, useState } from 'react'
import { Project, Segment, VideoSegment } from '../types'

const LABEL_W = 88
const TRACK_H = 44
const RULER_H = 28
const SNAP_PX = 8

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

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

function applySnap(valueUs: number, snapPts: number[], zoom: number): { value: number; snapAt: number | null } {
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
  trackId?: string
  startX: number
  startY?: number       // for drag-up detection
  startUs?: number
  durationUs?: number
  srcStartUs?: number   // sourceStartUs at drag start (for left-resize and clamping)
  fileDurUs?: number    // fileDurationUs (for right-resize clamping)
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
  onDuplicateSegment: (trackId: string, segment: Segment) => void
  onDropVideo: (filePath: string) => void
  onMoveSegmentToNewTrack: (fromTrackId: string, segId: string) => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return m > 0 ? `${m}:${s}` : `${s}s`
}

function getRulerInterval(zoom: number): { major: number; minor: number } {
  if (zoom >= 200) return { major: 0.5, minor: 0.1 }
  if (zoom >= 100) return { major: 1, minor: 0.25 }
  if (zoom >= 50)  return { major: 2, minor: 0.5 }
  return { major: 5, minor: 1 }
}

// ── Timeline ───────────────────────────────────────────────────────────────
export default function Timeline({
  project, currentTimeSec, selectedId, zoom,
  onSeek, onSelectSegment, onUpdateSegment, onDuplicateSegment, onDropVideo,
  onMoveSegmentToNewTrack
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
  const onMoveSegmentToNewTrackRef = useRef(onMoveSegmentToNewTrack)
  zoomRef.current = zoom
  onSeekRef.current = onSeek
  onUpdateSegmentRef.current = onUpdateSegment
  projectRef.current = project
  onMoveSegmentToNewTrackRef.current = onMoveSegmentToNewTrack

  const updateSnapLine = (snapAtUs: number | null) => {
    const el = snapLineRef.current
    if (!el) return
    if (snapAtUs === null) { el.style.display = 'none'; return }
    el.style.left = `${LABEL_W + snapAtUs / 1e6 * zoomRef.current}px`
    el.style.display = 'block'
  }

  // ── Global mouse handlers (stable, registered once) ────────────────────────
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
        const srcStart = drag.srcStartUs ?? 0
        // Can't go earlier than when sourceStartUs would become negative
        const minStart = Math.max(0, drag.startUs! - srcStart)
        // Can't go later than leaving a minimum segment
        const maxStart = drag.startUs! + drag.durationUs! - 100_000
        const { value: snapped, snapAt } = applySnap(naturalUs, snapPts, zoom)
        const clampedNatural = Math.max(minStart, Math.min(maxStart, snapped))
        const newDur = drag.startUs! + drag.durationUs! - clampedNatural
        const newSrcStart = srcStart + (clampedNatural - drag.startUs!)
        const patch: Partial<Segment> = {
          startUs: clampedNatural,
          durationUs: newDur,
          sourceDurationUs: newDur
        }
        if (drag.srcStartUs !== undefined) {
          (patch as Partial<VideoSegment>).sourceStartUs = Math.max(0, newSrcStart)
        }
        onUpdateSegmentRef.current(drag.segId, patch)
        updateSnapLine(snapAt)

      } else if (drag.kind === 'resize-right') {
        const naturalEndUs = drag.startUs! + drag.durationUs! + dtUs
        const { value: snapped, snapAt } = applySnap(naturalEndUs, snapPts, zoom)
        // Clamp: can't extend past source file end
        const maxEndUs = drag.fileDurUs !== undefined
          ? drag.startUs! + (drag.fileDurUs - (drag.srcStartUs ?? 0))
          : Infinity
        const clampedEnd = Math.min(snapped, maxEndUs)
        const newDur = Math.max(100_000, clampedEnd - drag.startUs!)
        onUpdateSegmentRef.current(drag.segId, { durationUs: newDur, sourceDurationUs: newDur })
        updateSnapLine(snapAt)
      }
    }

    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      updateSnapLine(null)
      // Drag-up detection: if cursor moved up > half a track height, move to new overlay track
      if (drag?.kind === 'move' && drag.trackId && drag.segId && drag.startY !== undefined) {
        if (e.clientY - drag.startY < -TRACK_H / 2) {
          onMoveSegmentToNewTrackRef.current(drag.trackId, drag.segId)
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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

  // ── Segment mousedown — move / resize / Option+duplicate ──────────────────
  const handleSegmentMouseDown = (
    e: React.MouseEvent,
    seg: Segment,
    trackId: string,
    kind: 'move' | 'resize-left' | 'resize-right'
  ) => {
    e.stopPropagation()
    e.preventDefault()

    // Option (alt) + move → duplicate first, then drag the copy
    if (kind === 'move' && e.altKey) {
      const newSeg = { ...seg, id: uid() }
      onDuplicateSegment(trackId, newSeg)
      dragRef.current = {
        kind: 'move', segId: newSeg.id, trackId,
        startX: e.clientX, startY: e.clientY,
        startUs: seg.startUs, durationUs: seg.durationUs
      }
      return
    }

    onSelectSegment(seg.id)
    const vSeg = seg.type === 'video' ? (seg as VideoSegment) : null
    dragRef.current = {
      kind, segId: seg.id, trackId,
      startX: e.clientX, startY: e.clientY,
      startUs: seg.startUs, durationUs: seg.durationUs,
      srcStartUs: vSeg?.sourceStartUs,
      fileDurUs: vSeg?.fileDurationUs
    }
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

  // Reverse display: video (base) at bottom, overlays on top
  const displayedTracks = [...project.tracks].reverse()
    .filter((t) => t.type === 'video' || t.segments.length > 0)

  const innerWidth = LABEL_W + totalSec * zoom
  const playheadLeft = LABEL_W + currentTimeSec * zoom
  const { major, minor } = getRulerInterval(zoom)
  const ticks: Array<{ t: number; isMajor: boolean }> = []
  for (let t = 0; t <= totalSec + minor; t = parseFloat((t + minor).toFixed(6))) {
    ticks.push({ t, isMajor: Math.abs(t % major) < 0.001 || Math.abs(t % major - major) < 0.001 })
  }

  const trackAreaH = RULER_H + displayedTracks.length * TRACK_H

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

        {/* Track rows — reversed so video track is at the bottom */}
        {displayedTracks.map((track) => (
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
                    onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'move')}
                  >
                    <div
                      className="resize-handle resize-handle-left"
                      onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'resize-left')}
                    />
                    <span className="segment-label">{label}</span>
                    <div
                      className="resize-handle resize-handle-right"
                      onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'resize-right')}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Snap indicator */}
        <div
          ref={snapLineRef}
          style={{
            position: 'absolute', top: 0,
            height: `${trackAreaH}px`,
            width: 2, background: '#f5c518',
            display: 'none', pointerEvents: 'none', zIndex: 25,
            boxShadow: '0 0 4px #f5c518'
          }}
        />

        {/* Playhead */}
        <div
          className="playhead"
          style={{ left: playheadLeft, top: 0, height: `${trackAreaH}px` }}
        />
      </div>
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'
import { Project, Segment, VideoSegment, LibraryClip, LibraryAudio, Track } from '../types'

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

// ── Non-overlap clamping ───────────────────────────────────────────────────
function clampToTrackGap(
  proposedStart: number,
  durationUs: number,
  segId: string,
  trackId: string,
  project: Project
): number {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track) return Math.max(0, proposedStart)
  const others = track.segments.filter((s) => s.id !== segId)
  if (others.length === 0) return Math.max(0, proposedStart)

  const center = proposedStart + durationUs / 2
  let minStart = 0
  let maxStart = Infinity

  for (const other of others) {
    const otherEnd = other.startUs + other.durationUs
    if (otherEnd <= center) {
      minStart = Math.max(minStart, otherEnd)
    } else if (other.startUs >= center) {
      maxStart = Math.min(maxStart, other.startUs - durationUs)
    }
  }

  return Math.max(0, Math.max(minStart, Math.min(maxStart === Infinity ? proposedStart : maxStart, proposedStart)))
}

// ── DragState ──────────────────────────────────────────────────────────────
interface DragState {
  kind: 'seek' | 'move' | 'resize-left' | 'resize-right'
  segId?: string
  trackId?: string   // original track
  startX: number
  startY?: number
  startUs?: number
  durationUs?: number
  srcStartUs?: number
  fileDurUs?: number
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
  onUpdateTrack: (trackId: string, patch: Partial<Track>) => void
  onDuplicateSegment: (trackId: string, segment: Segment) => void
  onDropVideo: (filePath: string) => void
  onDropLibraryClip: (clip: LibraryClip, timeUs: number) => void
  onDropLibraryAudio: (audio: LibraryAudio, timeUs: number) => void
  onZoomChange: (zoom: number) => void
  onMoveSegmentToNewTrack: (fromTrackId: string, segId: string) => void
  onMoveSegmentBetweenTracks: (fromTrackId: string, segId: string, toTrackId: string) => void
  onPackBaseTrack: () => void
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
  onSeek, onSelectSegment, onUpdateSegment, onUpdateTrack, onDuplicateSegment, onDropVideo, onDropLibraryClip, onDropLibraryAudio,
  onZoomChange, onMoveSegmentToNewTrack, onMoveSegmentBetweenTracks, onPackBaseTrack
}: TimelineProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const snapLineRef = useRef<HTMLDivElement>(null)
  const [dropActive, setDropActive] = useState(false)

  // Live drag-to-track visual: which track the dragged clip appears in right now
  const [dragVisualTrackId, setDragVisualTrackId] = useState<string | null>(null)
  const dragVisualTrackIdRef = useRef<string | null>(null)
  // Whether cursor is above all track rows during move drag (triggers new overlay on mouseup)
  const dragAboveRowsRef = useRef(false)

  // Stable refs so mouse event handlers stay registered once
  const zoomRef = useRef(zoom)
  const onSeekRef = useRef(onSeek)
  const onUpdateSegmentRef = useRef(onUpdateSegment)
  const projectRef = useRef(project)
  const onZoomChangeRef = useRef(onZoomChange)
  const onMoveSegmentToNewTrackRef = useRef(onMoveSegmentToNewTrack)
  const onMoveSegmentBetweenTracksRef = useRef(onMoveSegmentBetweenTracks)
  const onPackBaseTrackRef = useRef(onPackBaseTrack)
  zoomRef.current = zoom
  onSeekRef.current = onSeek
  onUpdateSegmentRef.current = onUpdateSegment
  projectRef.current = project
  onZoomChangeRef.current = onZoomChange
  onMoveSegmentToNewTrackRef.current = onMoveSegmentToNewTrack
  onMoveSegmentBetweenTracksRef.current = onMoveSegmentBetweenTracks
  onPackBaseTrackRef.current = onPackBaseTrack

  const updateSnapLine = (snapAtUs: number | null) => {
    const el = snapLineRef.current
    if (!el) return
    if (snapAtUs === null) { el.style.display = 'none'; return }
    el.style.left = `${LABEL_W + snapAtUs / 1e6 * zoomRef.current}px`
    el.style.display = 'block'
  }

  // ── Helper: compute displayed track order (same as render) ─────────────────
  const getDisplayedTracks = (proj: Project) =>
    [...proj.tracks].reverse().filter((t) => t.type === 'video' || t.segments.length > 0)

  // ── Global mouse handlers ──────────────────────────────────────────────────
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
        // Use liveTrackId as the clamping track (where clip appears visually)
        const clampTrackId = dragVisualTrackIdRef.current ?? drag.trackId!
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
        const clamped = clampToTrackGap(Math.max(0, finalStart), drag.durationUs!, drag.segId, clampTrackId, projectRef.current)
        onUpdateSegmentRef.current(drag.segId, { startUs: clamped })
        updateSnapLine(snapAt)

        // ── Live drag-to-track: update visual track when cursor row changes ──
        const relY = e.clientY - rect.top + containerRef.current.scrollTop
        const rowIndex = Math.floor((relY - RULER_H) / TRACK_H)
        const dispTracks = getDisplayedTracks(projectRef.current)
        dragAboveRowsRef.current = rowIndex < 0

        let newLiveId: string
        if (rowIndex < 0) {
          // Cursor is in the ruler area — show ghost "new overlay" row above everything
          newLiveId = '__new_overlay__'
        } else if (rowIndex < dispTracks.length) {
          newLiveId = dispTracks[rowIndex].id
        } else {
          newLiveId = drag.trackId!  // below all rows
        }

        if (newLiveId !== dragVisualTrackIdRef.current) {
          dragVisualTrackIdRef.current = newLiveId
          setDragVisualTrackId(newLiveId)  // triggers re-render for immediate visual
        }

      } else if (drag.kind === 'resize-left') {
        const naturalUs = Math.max(0, drag.startUs! + dtUs)
        const srcStart = drag.srcStartUs ?? 0
        const minStart = Math.max(0, drag.startUs! - srcStart)
        const maxStart = drag.startUs! + drag.durationUs! - 100_000
        const { value: snapped, snapAt } = applySnap(naturalUs, snapPts, zoom)
        const clampedNatural = Math.max(minStart, Math.min(maxStart, snapped))
        const newDur = drag.startUs! + drag.durationUs! - clampedNatural
        const newSrcStart = srcStart + (clampedNatural - drag.startUs!)
        const patch: Partial<Segment> = { startUs: clampedNatural, durationUs: newDur, sourceDurationUs: newDur }
        if (drag.srcStartUs !== undefined) {
          (patch as Partial<VideoSegment>).sourceStartUs = Math.max(0, newSrcStart)
        }
        onUpdateSegmentRef.current(drag.segId, patch)
        updateSnapLine(snapAt)

      } else if (drag.kind === 'resize-right') {
        const naturalEndUs = drag.startUs! + drag.durationUs! + dtUs
        const { value: snapped, snapAt } = applySnap(naturalEndUs, snapPts, zoom)
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

      if (drag?.kind === 'move' && drag.trackId && drag.segId) {
        const liveId = dragVisualTrackIdRef.current

        if (liveId === '__new_overlay__') {
          // Ghost row above all tracks → create new overlay track
          onMoveSegmentToNewTrackRef.current(drag.trackId, drag.segId)
        } else if (liveId && liveId !== drag.trackId) {
          // Dropped into a different existing track row
          onMoveSegmentBetweenTracksRef.current(drag.trackId, drag.segId, liveId)
        }

        // Pack base track if the drag involved it
        const baseTrackId = projectRef.current.tracks[0]?.id
        if (drag.trackId === baseTrackId || liveId === baseTrackId) {
          onPackBaseTrackRef.current()
        }
      } else if (drag && (drag.kind === 'resize-left' || drag.kind === 'resize-right')) {
        // Pack base track after resize too (closes any gap created by shortening a clip)
        const baseTrackId = projectRef.current.tracks[0]?.id
        if (drag.trackId === baseTrackId) {
          onPackBaseTrackRef.current()
        }
      }

      // Reset live drag visual
      dragVisualTrackIdRef.current = null
      dragAboveRowsRef.current = false
      setDragVisualTrackId(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Pinch-to-zoom (trackpad) ───────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = 1 - e.deltaY * 0.01
      onZoomChangeRef.current(Math.round(Math.max(20, Math.min(500, zoomRef.current * factor))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
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

      const rect = el.getBoundingClientRect()
      const scrollLeft = el.scrollLeft
      const rawX = e.clientX - rect.left + scrollLeft - LABEL_W
      const timeUs = Math.max(0, Math.round((rawX / zoom) * 1e6))

      // Check if it's an audio drop
      const audioId = e.dataTransfer?.getData('audioId')
      const audioPath = e.dataTransfer?.getData('audioPath')
      console.log('[Timeline] Drop - audioId:', audioId, 'audioPath:', audioPath)

      if (audioId && audioPath) {
        console.log('[Timeline] Fetching audio library...')
        // Fetch audio metadata and create segment
        window.api.getAudioLibrary().then((audios) => {
          console.log('[Timeline] Got audio library:', audios.length, 'items')
          const audio = audios.find((a) => a.id === audioId)
          console.log('[Timeline] Found audio:', audio)
          if (audio) {
            console.log('[Timeline] Dropping audio at', timeUs, 'us')
            onDropLibraryAudio(audio, timeUs)
          }
        })
        return
      }

      // Check if it's a library clip
      const clipId = e.dataTransfer?.getData('clipId')
      const clipPath = e.dataTransfer?.getData('clipPath')

      if (clipId && clipPath) {
        // Library clip drop - calculate drop position
        // Fetch clip metadata and create segment
        window.api.getClipLibrary().then((clips) => {
          const clip = clips.find((c) => c.id === clipId)
          if (clip) {
            onDropLibraryClip(clip, timeUs)
          }
        })
      }
    }
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [zoom, onDropLibraryClip, onDropLibraryAudio])

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

  // ── Segment mousedown ──────────────────────────────────────────────────────
  const handleSegmentMouseDown = (
    e: React.MouseEvent,
    seg: Segment,
    trackId: string,
    kind: 'move' | 'resize-left' | 'resize-right'
  ) => {
    e.stopPropagation()
    e.preventDefault()

    if (kind === 'move' && e.altKey) {
      const newSeg = { ...seg, id: uid() }
      onDuplicateSegment(trackId, newSeg)
      dragVisualTrackIdRef.current = trackId
      setDragVisualTrackId(trackId)
      dragRef.current = {
        kind: 'move', segId: newSeg.id, trackId,
        startX: e.clientX, startY: e.clientY,
        startUs: seg.startUs, durationUs: seg.durationUs
      }
      return
    }

    onSelectSegment(seg.id)
    const vSeg = seg.type === 'video' ? (seg as VideoSegment) : null
    // Initialise live track to current track
    dragVisualTrackIdRef.current = trackId
    setDragVisualTrackId(trackId)
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

  const displayedTracks = getDisplayedTracks(project)

  // ── Live drag visual: override which track the dragged clip appears in ──────
  const dragSegId = dragVisualTrackId !== null ? dragRef.current?.segId ?? null : null
  const dragOrigTrackId = dragSegId ? dragRef.current?.trackId ?? null : null

  let displayedTracksForRender = displayedTracks
  if (dragSegId && dragVisualTrackId && dragVisualTrackId !== dragOrigTrackId) {
    const allSegs = project.tracks.flatMap((t) => t.segments)
    const dragSeg = allSegs.find((s) => s.id === dragSegId) ?? null
    if (dragSeg) {
      if (dragVisualTrackId === '__new_overlay__') {
        // Show ghost row at the top (above all existing overlay rows)
        const withoutDrag = displayedTracks
          .map((track) =>
            track.id === dragOrigTrackId
              ? { ...track, segments: track.segments.filter((s) => s.id !== dragSegId) }
              : track
          )
          .filter((t) => t.type === 'video' || t.segments.length > 0)
        displayedTracksForRender = [
          { id: '__new_overlay__', type: 'video' as const, label: 'OVERLAY', segments: [dragSeg] },
          ...withoutDrag
        ]
      } else {
        displayedTracksForRender = displayedTracks.map((track) => {
          if (track.id === dragOrigTrackId) {
            return { ...track, segments: track.segments.filter((s) => s.id !== dragSegId) }
          }
          if (track.id === dragVisualTrackId) {
            return { ...track, segments: [...track.segments, dragSeg] }
          }
          return track
        }).filter((t) => t.type === 'video' || t.segments.length > 0)
      }
    }
  }

  const innerWidth = LABEL_W + totalSec * zoom
  const playheadLeft = LABEL_W + currentTimeSec * zoom
  const { major, minor } = getRulerInterval(zoom)
  const ticks: Array<{ t: number; isMajor: boolean }> = []
  for (let t = 0; t <= totalSec + minor; t = parseFloat((t + minor).toFixed(6))) {
    ticks.push({ t, isMajor: Math.abs(t % major) < 0.001 || Math.abs(t % major - major) < 0.001 })
  }
  const trackAreaH = RULER_H + displayedTracksForRender.length * TRACK_H

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
        {displayedTracksForRender.map((track, rowIdx) => {
          const isBase = track.id === project.tracks[0]?.id
          return (
            <div
              key={track.id}
              className={`track-row${isBase ? ' track-row-base' : ''}${track.muted ? ' track-muted' : ''}`}
              style={{ height: TRACK_H }}
            >
              <div className="track-label" style={{ width: LABEL_W, height: TRACK_H }}>
                <span className="track-label-text">{track.label}</span>
                {(track.type === 'video' || track.type === 'audio') && (
                  <button
                    className="track-mute-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onUpdateTrack(track.id, { muted: !track.muted })
                    }}
                    title={track.muted ? 'Unmute track' : 'Mute track'}
                  >
                    {track.muted ? 'M' : 'M'}
                  </button>
                )}
              </div>
              <div className="track-segments" style={{ position: 'relative', height: TRACK_H }}>
                {track.segments.map((seg) => {
                  const left = seg.startUs / 1e6 * zoom
                  const width = Math.max(8, seg.durationUs / 1e6 * zoom)
                  const isSelected = seg.id === selectedId
                  const label = seg.type === 'video' ? (seg as any).name : seg.type === 'audio' ? (seg as any).name : (seg as any).text
                  // Highlight if this seg is being dragged to this row
                  const isLiveDragged = seg.id === dragSegId && track.id === dragVisualTrackId
                  return (
                    <div
                      key={seg.id}
                      className={`segment type-${seg.type}${isSelected ? ' selected' : ''}${isLiveDragged ? ' dragging' : ''}`}
                      style={{ left, width }}
                      onClick={(e) => { e.stopPropagation(); onSelectSegment(seg.id) }}
                      onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'move')}
                    >
                      <div
                        className="resize-handle resize-handle-left"
                        onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'resize-left')}
                      />
                      <span className="segment-label">{label}</span>
                      {seg.type === 'audio' && (seg as any).dropTimeUs && (
                        <div
                          className="audio-drop-marker"
                          style={{
                            left: `${((((seg as any).dropTimeUs - seg.sourceStartUs) / seg.sourceDurationUs) * 100)}%`
                          }}
                          title="Drop point"
                        />
                      )}
                      <div
                        className="resize-handle resize-handle-right"
                        onMouseDown={(e) => handleSegmentMouseDown(e, seg, track.id, 'resize-right')}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

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

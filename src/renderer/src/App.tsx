import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import { Project, AppState, Action, VideoSegment, TextSegment, Track, Segment } from './types'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import Timeline from './components/Timeline'
import PropertiesPanel from './components/PropertiesPanel'

// ── helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function getActiveVideoSegment(project: Project, timeSec: number): VideoSegment | null {
  for (const track of project.tracks) {
    if (track.type !== 'video') continue
    for (const seg of track.segments) {
      if (seg.type !== 'video') continue
      const start = seg.startUs / 1e6
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (timeSec >= start && timeSec < end) return seg
    }
  }
  return null
}

function totalDuration(project: Project): number {
  let max = 0
  for (const track of project.tracks) {
    for (const seg of track.segments) {
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (end > max) max = end
    }
  }
  return max
}

const defaultProject: Project = {
  name: 'Untitled Project',
  canvas: { width: 1080, height: 1920 },
  tracks: [{ id: uid(), type: 'video', label: 'VIDEO', segments: [] }]
}

const initialState: AppState = {
  project: defaultProject,
  past: [],
  future: [],
  clipboard: null,
  currentTimeSec: 0,
  selectedId: null,
  croppingId: null,
  zoom: 100,
  isPlaying: false
}

// ── packBaseTrack: sort + close gaps in the base track, shift linked overlays ──

function packBaseTrack(project: Project): Project {
  const baseTrack = project.tracks[0]
  if (!baseTrack || baseTrack.type !== 'video' || baseTrack.segments.length === 0) return project

  const sorted = [...baseTrack.segments].sort((a, b) => a.startUs - b.startUs)

  // Compute old→new startUs for each base clip
  const oldStart = new Map<string, number>()
  const newStart = new Map<string, number>()
  let cursor = 0
  for (const seg of sorted) {
    oldStart.set(seg.id, seg.startUs)
    newStart.set(seg.id, cursor)
    cursor += seg.durationUs
  }

  const newBaseSegs = sorted.map((seg) => ({ ...seg, startUs: newStart.get(seg.id)! }))

  // Shift overlay/text segments: find which base clip the segment's center falls within,
  // apply the same delta so overlays follow their linked base clip
  const newTracks = project.tracks.map((t, i) => {
    if (i === 0) return { ...t, segments: newBaseSegs }
    const newSegs = t.segments.map((seg) => {
      const center = seg.startUs + seg.durationUs / 2
      let delta = 0
      for (const bs of sorted) {
        if (center >= bs.startUs && center < bs.startUs + bs.durationUs) {
          delta = newStart.get(bs.id)! - oldStart.get(bs.id)!
          break
        }
      }
      return delta !== 0 ? { ...seg, startUs: Math.max(0, seg.startUs + delta) } : seg
    })
    return { ...t, segments: newSegs }
  })

  return { ...project, tracks: newTracks }
}

// ── inner project reducer (pure, no history) ──────────────────────────────────

function applyProjectAction(project: Project, action: Action): Project {
  switch (action.type) {
    case 'ADD_VIDEO_SEGMENT': {
      const tracks = project.tracks.map((t) =>
        t.type !== 'video' ? t : { ...t, segments: [...t.segments, action.segment] }
      )
      return { ...project, tracks }
    }

    case 'ADD_TEXT_WITH_TRACK': {
      const newTrack = { ...action.track, segments: [action.segment] }
      return { ...project, tracks: [...project.tracks, newTrack] }
    }

    case 'ADD_SEGMENT_TO_TRACK': {
      const tracks = project.tracks.map((t) =>
        t.id !== action.trackId ? t : { ...t, segments: [...t.segments, action.segment] }
      )
      return { ...project, tracks }
    }

    case 'UPDATE_SEGMENT': {
      const tracks = project.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) =>
          s.id === action.id ? ({ ...s, ...action.patch } as Segment) : s
        )
      }))
      return { ...project, tracks }
    }

    case 'DELETE_SEGMENT': {
      const tracks = project.tracks
        .map((t) => ({ ...t, segments: t.segments.filter((s) => s.id !== action.id) }))
        .filter((t, i) => i === 0 || t.segments.length > 0)
      return packBaseTrack({ ...project, tracks })
    }

    case 'MOVE_SEGMENT_TO_TRACK': {
      let movedSeg: Segment | null = null
      const tracks = project.tracks.map((t) => {
        if (t.id !== action.fromTrackId) return t
        const seg = t.segments.find((s) => s.id === action.segId)
        if (seg) movedSeg = seg
        return { ...t, segments: t.segments.filter((s) => s.id !== action.segId) }
      })
      if (!movedSeg) return project
      const seg = movedSeg as Segment
      const textCount = project.tracks.filter((t) => t.type === 'text').length
      const newTrack: Track = {
        id: uid(),
        type: seg.type === 'video' ? 'video' : 'text',
        label: seg.type === 'video' ? 'OVERLAY' : `TEXT ${textCount + 1}`,
        segments: [seg]
      }
      const withNew = [...tracks, newTrack]
      const cleaned = withNew.filter((t, i) => i === 0 || t.segments.length > 0)
      // Pack base track to close any gap left by moving the segment out
      return packBaseTrack({ ...project, tracks: cleaned })
    }

    case 'MOVE_SEGMENT_BETWEEN_TRACKS': {
      let movedSeg: Segment | null = null
      const tracks = project.tracks.map((t) => {
        if (t.id !== action.fromTrackId) return t
        const seg = t.segments.find((s) => s.id === action.segId)
        if (seg) movedSeg = seg
        return { ...t, segments: t.segments.filter((s) => s.id !== action.segId) }
      }).map((t) => {
        if (t.id !== action.toTrackId || !movedSeg) return t
        return { ...t, segments: [...t.segments, movedSeg as Segment] }
      })
      if (!movedSeg) return project
      const cleaned = tracks.filter((t, i) => i === 0 || t.segments.length > 0)
      return { ...project, tracks: cleaned }
    }

    case 'SLICE_AT': {
      const { timeUs } = action
      const tracks = project.tracks.map((track) => {
        const segs: Segment[] = []
        for (const seg of track.segments) {
          if (timeUs <= seg.startUs || timeUs >= seg.startUs + seg.durationUs) {
            segs.push(seg)
            continue
          }
          const firstDur = timeUs - seg.startUs
          const secondDur = seg.durationUs - firstDur
          if (seg.type === 'video') {
            const vs = seg as VideoSegment
            const srcOffset = Math.round((firstDur / vs.durationUs) * vs.sourceDurationUs)
            segs.push(
              { ...vs, durationUs: firstDur, sourceDurationUs: srcOffset },
              {
                ...vs, id: uid(), startUs: timeUs, durationUs: secondDur,
                sourceStartUs: vs.sourceStartUs + srcOffset,
                sourceDurationUs: vs.sourceDurationUs - srcOffset
              }
            )
          } else {
            segs.push(
              { ...seg, durationUs: firstDur },
              { ...seg, id: uid(), startUs: timeUs, durationUs: secondDur }
            )
          }
        }
        return { ...track, segments: segs }
      })
      return { ...project, tracks }
    }

    default:
      return project
  }
}

// ── outer reducer (history + non-project actions) ─────────────────────────────

const UNDOABLE = new Set<Action['type']>([
  'ADD_VIDEO_SEGMENT', 'ADD_TEXT_WITH_TRACK', 'ADD_SEGMENT_TO_TRACK',
  'UPDATE_SEGMENT', 'DELETE_SEGMENT', 'SLICE_AT', 'MOVE_SEGMENT_TO_TRACK',
  'MOVE_SEGMENT_BETWEEN_TRACKS'
])

function reducer(state: AppState, action: Action): AppState {
  // undo / redo
  if (action.type === 'UNDO') {
    if (!state.past.length) return state
    return {
      ...state,
      project: state.past[state.past.length - 1],
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, 100),
      selectedId: null
    }
  }
  if (action.type === 'REDO') {
    if (!state.future.length) return state
    return {
      ...state,
      project: state.future[0],
      past: [...state.past, state.project].slice(-100),
      future: state.future.slice(1),
      selectedId: null
    }
  }

  // project load — clears history
  if (action.type === 'SET_PROJECT') {
    return { ...state, project: action.project, past: [], future: [], currentTimeSec: 0, selectedId: null }
  }

  // pack base track — no history (triggered on drag end)
  if (action.type === 'PACK_BASE_TRACK') {
    return { ...state, project: packBaseTrack(state.project) }
  }

  // drag update — no history
  if (action.type === 'MOVE_SEGMENT') {
    const tracks = state.project.tracks.map((t) => ({
      ...t,
      segments: t.segments.map((s) =>
        s.id === action.id ? ({ ...s, ...action.patch } as Segment) : s
      )
    }))
    return { ...state, project: { ...state.project, tracks } }
  }

  // non-project state
  switch (action.type) {
    case 'SET_TIME':      return { ...state, currentTimeSec: Math.max(0, action.t) }
    case 'SET_PLAYING':   return { ...state, isPlaying: action.playing }
    case 'SET_SELECTED':  return { ...state, selectedId: action.id }
    case 'SET_CROPPING':  return { ...state, croppingId: action.id }
    case 'SET_ZOOM':      return { ...state, zoom: Math.min(500, Math.max(20, action.zoom)) }
    case 'SET_CLIPBOARD': return { ...state, clipboard: action.segment }
  }

  // undoable project mutations
  if (UNDOABLE.has(action.type)) {
    return {
      ...state,
      project: applyProjectAction(state.project, action),
      past: [...state.past.slice(-99), state.project],
      future: []
    }
  }

  return state
}

// ── App ───────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    api: {
      getPathForFile: (file: File) => string
      openVideo: () => Promise<{ path: string; name: string; durationSec: number; width: number; height: number } | null>
      getVideoInfo: (filePath: string) => Promise<{ path: string; name: string; durationSec: number; width: number; height: number }>
      saveProject: (project: Project) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>
      loadProject: () => Promise<Project | { error: string } | null>
      saveTempPng: (dataUrl: string, filename: string) => Promise<string>
      exportVideo: (project: Project, textOverlays: Array<{ path: string; startSec: number; endSec: number }>) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>
      onExportProgress: (cb: (line: string) => void) => () => void
    }
  }
}

async function renderTextToPng(seg: TextSegment, cw: number, ch: number): Promise<string> {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!

  const effectiveSize = seg.fontSize * (seg.textScale ?? 1)
  ctx.font = `${seg.italic ? 'italic ' : ''}${seg.bold ? 'bold ' : ''}${effectiveSize}px 'TikTokText', 'Apple Color Emoji', sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = seg.textAlign ?? 'center'

  const xPx = ((seg.x + 1) / 2) * cw
  const yPx = ((1 - seg.y) / 2) * ch
  const lines = seg.text.split('\n')
  const lineHeight = effectiveSize
  const totalH = lines.length * lineHeight

  if (seg.strokeEnabled) {
    ctx.strokeStyle = seg.strokeColor ?? '#000000'
    ctx.lineWidth = effectiveSize * (6.9 / 97.0) * 2
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      if (!line) return
      ctx.strokeText(line, xPx, yPx - totalH / 2 + lineHeight * (i + 0.5))
    })
  }
  ctx.fillStyle = seg.color
  lines.forEach((line, i) => {
    if (!line) return
    ctx.fillText(line, xPx, yPx - totalH / 2 + lineHeight * (i + 0.5))
  })

  return canvas.toDataURL('image/png')
}

export default function App(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number | null>(null)
  const playStartRef = useRef<{ wallTime: number; timelineSec: number } | null>(null)

  // Stable ref so keyboard handler always reads fresh state without re-registering
  const stateRef = useRef(state)
  stateRef.current = state

  const { project, currentTimeSec, selectedId, croppingId, zoom, isPlaying, past, future } = state

  // ── seek logic ──────────────────────────────────────────────────────────────

  const seekTo = useCallback((t: number) => {
    const clip = getActiveVideoSegment(project, t)
    if (clip && videoRef.current) {
      const videoSrc = `file://${clip.src}`
      if (videoRef.current.src !== videoSrc) videoRef.current.src = videoSrc
      videoRef.current.currentTime = clip.sourceStartUs / 1e6 + (t - clip.startUs / 1e6)
    } else if (videoRef.current) {
      videoRef.current.pause()
    }
    dispatch({ type: 'SET_TIME', t })
  }, [project])

  // ── play/pause ──────────────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [])

  const startRaf = useCallback(() => {
    stopRaf()
    const tick = () => {
      if (!playStartRef.current) return
      const wallElapsed = (performance.now() - playStartRef.current.wallTime) / 1000
      const t = playStartRef.current.timelineSec + wallElapsed
      const dur = totalDuration(project)
      if (dur > 0 && t >= dur) {
        dispatch({ type: 'SET_TIME', t: dur })
        dispatch({ type: 'SET_PLAYING', playing: false })
        videoRef.current?.pause()
        return
      }
      dispatch({ type: 'SET_TIME', t })
      const clip = getActiveVideoSegment(project, t)
      if (clip && videoRef.current) {
        const videoSrc = `file://${clip.src}`
        if (videoRef.current.src !== videoSrc) {
          videoRef.current.src = videoSrc
          videoRef.current.play().catch(() => {})
        } else if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {})
        }
        const expected = clip.sourceStartUs / 1e6 + (t - clip.startUs / 1e6)
        if (Math.abs(videoRef.current.currentTime - expected) > 0.2) {
          videoRef.current.currentTime = expected
        }
      } else if (!clip && videoRef.current && !videoRef.current.paused) {
        // In a gap — silence the video
        videoRef.current.pause()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [project, stopRaf])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopRaf()
      videoRef.current?.pause()
      dispatch({ type: 'SET_PLAYING', playing: false })
    } else {
      playStartRef.current = { wallTime: performance.now(), timelineSec: currentTimeSec }
      const clip = getActiveVideoSegment(project, currentTimeSec)
      if (clip && videoRef.current) {
        const videoSrc = `file://${clip.src}`
        if (videoRef.current.src !== videoSrc) videoRef.current.src = videoSrc
        videoRef.current.currentTime = clip.sourceStartUs / 1e6 + (currentTimeSec - clip.startUs / 1e6)
        videoRef.current.play().catch(() => {})
      }
      dispatch({ type: 'SET_PLAYING', playing: true })
      startRaf()
    }
  }, [isPlaying, currentTimeSec, project, startRaf, stopRaf])

  useEffect(() => () => stopRaf(), [stopRaf])

  // ── keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      const { project, currentTimeSec, selectedId, clipboard } = stateRef.current

      // Escape — exit crop mode
      if (e.key === 'Escape') {
        if (stateRef.current.croppingId) {
          dispatch({ type: 'SET_CROPPING', id: null })
          return
        }
      }

      // Space — play/pause (not in inputs)
      if (e.code === 'Space' && !inInput) {
        e.preventDefault()
        togglePlay()
        return
      }

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault()
        dispatch({ type: 'REDO' })
        return
      }

      if (inInput) return  // below here: no inputs

      // Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) dispatch({ type: 'DELETE_SEGMENT', id: selectedId })
        return
      }

      // Cmd+B — slice at playhead
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        dispatch({ type: 'SLICE_AT', timeUs: Math.round(currentTimeSec * 1e6) })
        return
      }

      // Cmd+C — copy selected
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault()
        if (selectedId) {
          const seg = project.tracks.flatMap((t) => t.segments).find((s) => s.id === selectedId)
          if (seg) dispatch({ type: 'SET_CLIPBOARD', segment: seg })
        }
        return
      }

      // Cmd+V — paste clipboard at playhead
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && clipboard) {
        e.preventDefault()
        const newId = uid()
        const newSeg = { ...clipboard, id: newId, startUs: Math.round(currentTimeSec * 1e6) }
        if (newSeg.type === 'video') {
          dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: newSeg as VideoSegment })
        } else {
          const count = project.tracks.filter((t) => t.type === 'text').length
          const newTrack: Track = { id: uid(), type: 'text', label: `TEXT ${count + 1}`, segments: [] }
          dispatch({ type: 'ADD_TEXT_WITH_TRACK', track: newTrack, segment: newSeg as TextSegment })
        }
        dispatch({ type: 'SET_SELECTED', id: newId })
        return
      }

      // Arrow keys — frame step
      if (e.key === 'ArrowLeft')  { e.preventDefault(); seekTo(Math.max(0, currentTimeSec - 1 / 30)); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(currentTimeSec + 1 / 30); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekTo])  // stable — stateRef keeps values current

  // ── toolbar actions ─────────────────────────────────────────────────────────

  const handleNewProject = useCallback(() => {
    if (!confirm('Start a new project? Unsaved changes will be lost.')) return
    dispatch({ type: 'SET_PROJECT', project: { ...defaultProject, tracks: [{ id: uid(), type: 'video', label: 'VIDEO', segments: [] }] } })
  }, [])

  const handleOpenProject = useCallback(async () => {
    const result = await window.api.loadProject()
    if (!result) return
    if ('error' in result) { alert(`Error: ${result.error}`); return }
    dispatch({ type: 'SET_PROJECT', project: result as Project })
  }, [])

  const handleSaveProject = useCallback(async () => {
    await window.api.saveProject(project)
  }, [project])

  const handleAddVideo = useCallback(async () => {
    const info = await window.api.openVideo()
    if (!info) return
    const durationUs = Math.round(info.durationSec * 1e6)
    let startUs = 0
    for (const track of project.tracks) {
      if (track.type !== 'video') continue
      for (const seg of track.segments) {
        const end = seg.startUs + seg.durationUs
        if (end > startUs) startUs = end
      }
    }
    const seg: VideoSegment = {
      id: uid(), type: 'video', src: info.path, name: info.name,
      startUs, durationUs, sourceStartUs: 0, sourceDurationUs: durationUs,
      fileDurationUs: durationUs,
      sourceWidth: info.width, sourceHeight: info.height,
      clipX: 0, clipY: 0, clipScale: 1,
      cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0
    }
    dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
    dispatch({ type: 'SET_TIME', t: startUs / 1e6 })
    if (videoRef.current) {
      videoRef.current.src = `file://${info.path}`
      videoRef.current.currentTime = 0
    }
  }, [project])

  const handleAddText = useCallback(() => {
    const count = project.tracks.filter((t) => t.type === 'text').length
    const trackId = uid()
    const newTrack: Track = { id: trackId, type: 'text', label: `TEXT ${count + 1}`, segments: [] }
    const seg: TextSegment = {
      id: uid(), type: 'text', text: 'New Text',
      startUs: Math.round(currentTimeSec * 1e6), durationUs: 3_000_000,
      x: 0, y: 0, fontSize: 120, color: '#ffffff',
      bold: false, italic: false,
      strokeEnabled: true, strokeColor: '#000000',
      textAlign: 'center', textScale: 1
    }
    dispatch({ type: 'ADD_TEXT_WITH_TRACK', track: newTrack, segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
  }, [project, currentTimeSec])

  const handleExport = useCallback(async () => {
    let cleanup: (() => void) | null = null
    try {
      const textOverlays: Array<{ path: string; startSec: number; endSec: number }> = []
      for (const track of project.tracks) {
        if (track.type !== 'text') continue
        for (const seg of track.segments) {
          const ts = seg as TextSegment
          const dataUrl = await renderTextToPng(ts, project.canvas.width, project.canvas.height)
          const path = await window.api.saveTempPng(dataUrl, `overlay_${ts.id}.png`)
          textOverlays.push({ path, startSec: ts.startUs / 1e6, endSec: (ts.startUs + ts.durationUs) / 1e6 })
        }
      }
      cleanup = window.api.onExportProgress((line) => { console.log('[ffmpeg]', line) })
      const result = await window.api.exportVideo(project, textOverlays)
      if (result.error) alert(`Export failed: ${result.error}`)
    } catch (err: any) {
      alert(`Export error: ${err?.message ?? String(err)}`)
    } finally {
      cleanup?.()
    }
  }, [project])

  // ── drop video ──────────────────────────────────────────────────────────────

  const handleDropVideo = useCallback(async (filePath: string) => {
    const info = await window.api.getVideoInfo(filePath)
    if (!info) return
    const durationUs = Math.round(info.durationSec * 1e6)
    let startUs = 0
    for (const track of project.tracks) {
      if (track.type !== 'video') continue
      for (const seg of track.segments) {
        const end = seg.startUs + seg.durationUs
        if (end > startUs) startUs = end
      }
    }
    const seg: VideoSegment = {
      id: uid(), type: 'video', src: info.path, name: info.name,
      startUs, durationUs, sourceStartUs: 0, sourceDurationUs: durationUs,
      fileDurationUs: durationUs,
      sourceWidth: info.width, sourceHeight: info.height,
      clipX: 0, clipY: 0, clipScale: 1,
      cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0
    }
    dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
    dispatch({ type: 'SET_TIME', t: startUs / 1e6 })
    if (videoRef.current) {
      videoRef.current.src = `file://${info.path}`
      videoRef.current.currentTime = 0
    }
  }, [project])

  const handleDropVideoRef = useRef(handleDropVideo)
  handleDropVideoRef.current = handleDropVideo
  useEffect(() => {
    const handler = (e: Event) => handleDropVideoRef.current((e as CustomEvent<string>).detail)
    window.addEventListener('video-file-dropped', handler)
    return () => window.removeEventListener('video-file-dropped', handler)
  }, [])

  // ── duplicate segment (from timeline alt+drag) ──────────────────────────────

  const handleDuplicateSegment = useCallback((trackId: string, seg: Segment) => {
    dispatch({ type: 'ADD_SEGMENT_TO_TRACK', trackId, segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
  }, [])

  // ── move segment to new overlay track (from timeline drag-up) ───────────────

  const handleMoveSegmentToNewTrack = useCallback((fromTrackId: string, segId: string) => {
    dispatch({ type: 'MOVE_SEGMENT_TO_TRACK', segId, fromTrackId })
  }, [])

  // ── move segment to existing track (from timeline drag-down/across) ──────────

  const handleMoveSegmentBetweenTracks = useCallback((fromTrackId: string, segId: string, toTrackId: string) => {
    dispatch({ type: 'MOVE_SEGMENT_BETWEEN_TRACKS', segId, fromTrackId, toTrackId })
  }, [])

  // ── pack base track after drag (close gaps, shift linked overlays) ───────────

  const handlePackBaseTrack = useCallback(() => {
    dispatch({ type: 'PACK_BASE_TRACK' })
  }, [])

  // ── selected segment ────────────────────────────────────────────────────────

  const selectedSegment = selectedId
    ? project.tracks.flatMap((t) => t.segments).find((s) => s.id === selectedId) ?? null
    : null

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      <Toolbar
        onNew={handleNewProject}
        onOpen={handleOpenProject}
        onSave={handleSaveProject}
        onAddVideo={handleAddVideo}
        onAddText={handleAddText}
        zoom={zoom}
        onZoomChange={(z) => dispatch({ type: 'SET_ZOOM', zoom: z })}
        onExport={handleExport}
        projectName={project.name}
        onRenameProject={(name) => dispatch({ type: 'SET_PROJECT', project: { ...project, name } })}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={() => dispatch({ type: 'UNDO' })}
        onRedo={() => dispatch({ type: 'REDO' })}
      />

      <div className="app-body">
        <div className="canvas-area">
          <div className="canvas-center">
            <Canvas
              project={project}
              currentTimeSec={currentTimeSec}
              selectedId={selectedId}
              croppingId={croppingId}
              videoRef={videoRef}
              onSelectSegment={(id) => dispatch({ type: 'SET_SELECTED', id })}
              onUpdateSegment={(id, patch) => dispatch({ type: 'MOVE_SEGMENT', id, patch })}
              onSetCropping={(id) => dispatch({ type: 'SET_CROPPING', id })}
            />
          </div>

          {/* Playback controls */}
          <div className="playback-bar">
            <span className="playback-time">{formatTimestamp(currentTimeSec)}</span>
            <div className="toolbar-group">
              <button
                className="btn btn-icon"
                onClick={() => seekTo(Math.max(0, currentTimeSec - 1 / 30))}
                title="Step back (←)"
              >⏮</button>
              <button
                className="btn btn-play"
                onClick={togglePlay}
                title="Play / Pause (Space)"
              >{isPlaying ? '⏸' : '▶'}</button>
              <button
                className="btn btn-icon"
                onClick={() => seekTo(currentTimeSec + 1 / 30)}
                title="Step forward (→)"
              >⏭</button>
            </div>
          </div>
        </div>

        <div className="properties-area">
          <PropertiesPanel
            segment={selectedSegment}
            onUpdate={(id, patch) => dispatch({ type: 'UPDATE_SEGMENT', id, patch })}
            onDelete={(id) => {
              dispatch({ type: 'DELETE_SEGMENT', id })
              dispatch({ type: 'SET_SELECTED', id: null })
            }}
          />
        </div>
      </div>

      <div className="timeline-area">
        <Timeline
          project={project}
          currentTimeSec={currentTimeSec}
          selectedId={selectedId}
          zoom={zoom}
          onSeek={(t) => {
            if (isPlaying) playStartRef.current = { wallTime: performance.now(), timelineSec: t }
            seekTo(t)
          }}
          onSelectSegment={(id) => dispatch({ type: 'SET_SELECTED', id })}
          onUpdateSegment={(id, patch) => dispatch({ type: 'MOVE_SEGMENT', id, patch: patch as any })}
          onDuplicateSegment={handleDuplicateSegment}
          onDropVideo={handleDropVideo}
          onZoomChange={(z) => dispatch({ type: 'SET_ZOOM', zoom: z })}
          onMoveSegmentToNewTrack={handleMoveSegmentToNewTrack}
          onMoveSegmentBetweenTracks={handleMoveSegmentBetweenTracks}
          onPackBaseTrack={handlePackBaseTrack}
        />
      </div>
    </div>
  )
}

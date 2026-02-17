import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Project, AppState, Action, VideoSegment, TextSegment, Track, Segment, BatchProject, LibraryClip, LibraryAudio, Account, ScaleKeyframe } from './types'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import Timeline from './components/Timeline'
import PropertiesPanel from './components/PropertiesPanel'
import ClipLibrary from './components/ClipLibrary'
import { AudioLibrary } from './components/AudioLibrary'
import { ProjectPicker } from './components/ProjectPicker'
import { ReferenceVideoModal } from './components/ReferenceVideoModal'

// ── helpers ───────────────────────────────────────────────────────────────────

function getInterpolatedScale(seg: VideoSegment, timeWithinSegMs: number): number {
  // If no keyframes or empty array, use static clipScale
  if (!seg.scaleKeyframes || seg.scaleKeyframes.length === 0) {
    return seg.clipScale
  }

  // Sort keyframes by time
  const kfs = [...seg.scaleKeyframes].sort((a, b) => a.timeMs - b.timeMs)

  // Before first keyframe
  if (timeWithinSegMs <= kfs[0].timeMs) {
    return kfs[0].scale
  }

  // After last keyframe
  if (timeWithinSegMs >= kfs[kfs.length - 1].timeMs) {
    return kfs[kfs.length - 1].scale
  }

  // Find surrounding keyframes and interpolate
  for (let i = 0; i < kfs.length - 1; i++) {
    const k1 = kfs[i]
    const k2 = kfs[i + 1]
    if (timeWithinSegMs >= k1.timeMs && timeWithinSegMs <= k2.timeMs) {
      const t = (timeWithinSegMs - k1.timeMs) / (k2.timeMs - k1.timeMs)
      return k1.scale + (k2.scale - k1.scale) * t
    }
  }

  return seg.clipScale
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function pathToFileUrl(path: string): string {
  // URL-encode each path segment to match browser normalization
  const parts = path.split('/')
  const encoded = parts.map(part => encodeURIComponent(part)).join('/')
  return `file://${encoded}`
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
  tracks: [{ id: uid(), type: 'video', label: 'VIDEO', segments: [], muted: true }]
}

const initialState: AppState = {
  mode: 'single',
  project: defaultProject,
  currentFilePath: null,
  batchFolder: null,
  batchProjects: [],
  batchSelectedIdx: 0,
  past: [],
  future: [],
  clipboard: null,
  currentTimeSec: 0,
  selectedId: null,
  croppingId: null,
  zoom: 100,
  isPlaying: false,
  currentAccountId: null,
  accounts: []
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

    case 'ADD_AUDIO_SEGMENT': {
      const audioTrack = project.tracks.find((t) => t.type === 'audio')
      if (audioTrack) {
        // Add to existing audio track
        const tracks = project.tracks.map((t) =>
          t.type !== 'audio' ? t : { ...t, segments: [...t.segments, action.segment] }
        )
        return { ...project, tracks }
      } else {
        // Create new audio track at the bottom (insert at beginning so it renders below)
        const newTrack: Track = { id: uid(), type: 'audio', label: 'AUDIO', segments: [action.segment] }
        return { ...project, tracks: [newTrack, ...project.tracks] }
      }
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

    case 'UPDATE_TRACK': {
      const tracks = project.tracks.map((t) =>
        t.id === action.id ? { ...t, ...action.patch } : t
      )
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
  'ADD_VIDEO_SEGMENT', 'ADD_AUDIO_SEGMENT', 'ADD_TEXT_WITH_TRACK', 'ADD_SEGMENT_TO_TRACK',
  'UPDATE_SEGMENT', 'UPDATE_TRACK', 'DELETE_SEGMENT', 'SLICE_AT', 'MOVE_SEGMENT_TO_TRACK',
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

  // set file path
  if (action.type === 'SET_FILE_PATH') {
    return { ...state, currentFilePath: action.path }
  }

  // batch mode
  if (action.type === 'SET_BATCH') {
    const firstProject = action.projects[0]?.project ?? defaultProject
    return {
      ...state,
      mode: 'batch',
      batchFolder: action.folderPath,
      batchProjects: action.projects,
      batchSelectedIdx: 0,
      project: firstProject,
      past: [],
      future: [],
      currentTimeSec: 0,
      selectedId: null
    }
  }

  if (action.type === 'SELECT_BATCH_PROJECT') {
    const selected = state.batchProjects[action.idx]
    if (!selected) return state
    return {
      ...state,
      batchSelectedIdx: action.idx,
      project: selected.project,
      past: [],
      future: [],
      currentTimeSec: 0,
      selectedId: null
    }
  }

  if (action.type === 'UPDATE_BATCH_THUMBNAIL') {
    const projects = state.batchProjects.map((p) =>
      p.name === action.filename.replace('.json', '') ? { ...p, thumbnail: action.thumbnail } : p
    )
    return { ...state, batchProjects: projects }
  }

  if (action.type === 'UPDATE_BATCH_PROJECT') {
    const filename = action.filename.replace('.json', '')
    const projects = state.batchProjects.map((p) =>
      p.name === filename ? { ...p, project: action.project } : p
    )
    const selected = state.batchProjects[state.batchSelectedIdx]
    const updatedProject = selected && selected.name === filename ? action.project : state.project
    return { ...state, batchProjects: projects, project: updatedProject }
  }

  if (action.type === 'EXIT_BATCH') {
    return {
      ...state,
      mode: 'single',
      batchFolder: null,
      batchProjects: [],
      batchSelectedIdx: 0
    }
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
    case 'SET_CURRENT_ACCOUNTS':  return { ...state, accounts: action.accounts }
    case 'SET_CURRENT_ACCOUNT': return { ...state, currentAccountId: action.accountId }
    case 'ADD_ACCOUNT':   return { ...state, accounts: [...state.accounts, action.account], currentAccountId: action.account.id }
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
      saveProject: (project: Project) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string; filePath?: string }>
      loadProject: () => Promise<Project | { error: string } | null>
      openFolder: () => Promise<{ folderPath: string; projects: Array<{ name: string; path: string; project: Project }> } | null>
      renderThumbnail: (projectPath: string, timeSec?: number) => Promise<string | null>
      saveTempPng: (dataUrl: string, filename: string) => Promise<string>
      exportVideo: (project: Project, textOverlays: Array<{ path: string; startSec: number; endSec: number }>) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>
      onExportProgress: (cb: (line: string) => void) => () => void
      onProjectFileChanged: (cb: (project: Project) => void) => () => void
      onBatchFileChanged: (cb: (data: { filename: string; project: Project }) => void) => () => void
      importClip: (sourcePath: string) => Promise<{ ok?: boolean; clip?: LibraryClip; error?: string }>
      getClipLibrary: () => Promise<LibraryClip[]>
      deleteClipFromLibrary: (clipId: string) => Promise<{ ok?: boolean; error?: string }>
      updateClipMetadata: (clipId: string, updates: Partial<LibraryClip>) => Promise<{ ok?: boolean; clip?: LibraryClip; error?: string }>
      selectAudioFile: () => Promise<{ ok?: boolean; audio?: LibraryAudio; error?: string } | null>
      importAudio: (sourcePath: string, isVideo: boolean) => Promise<{ ok?: boolean; audio?: LibraryAudio; error?: string }>
      getAudioLibrary: () => Promise<LibraryAudio[]>
      updateAudioMetadata: (audioId: string, updates: Partial<LibraryAudio>) => Promise<{ ok?: boolean; audio?: LibraryAudio; error?: string }>
      deleteAudioFromLibrary: (audioId: string) => Promise<{ ok?: boolean; error?: string }>
      extractReferenceFrames: (videoPath: string) => Promise<{ ok: boolean; frameCount: number; totalDuration: number }>
      onReferenceResultReady: (cb: (result: any) => void) => () => void
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
  ctx.font = `${seg.italic ? 'italic ' : ''}${seg.bold ? 'bold ' : ''}${effectiveSize}px 'TikTok Sans', 'Apple Color Emoji', sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = seg.textAlign ?? 'center'

  const xPx = ((seg.x + 1) / 2) * cw
  const yPx = ((1 - seg.y) / 2) * ch
  const lines = seg.text.split('\n')
  const lineHeight = effectiveSize
  const totalH = lines.length * lineHeight

  if (seg.strokeEnabled) {
    ctx.strokeStyle = seg.strokeColor ?? '#000000'
    ctx.lineWidth = effectiveSize * (6.9 / 97.0) * 2.3
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
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number | null>(null)
  const playStartRef = useRef<{ wallTime: number; timelineSec: number } | null>(null)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Stable ref so keyboard handler always reads fresh state without re-registering
  const stateRef = useRef(state)
  stateRef.current = state

  const { project, currentFilePath, currentTimeSec, selectedId, croppingId, zoom, isPlaying, past, future, accounts, currentAccountId } = state

  // ── seek logic ──────────────────────────────────────────────────────────────

  const seekTo = useCallback((t: number) => {
    dispatch({ type: 'SET_TIME', t })
    // Video sync happens in useEffect
  }, [])

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
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [project, stopRaf])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopRaf()
      dispatch({ type: 'SET_PLAYING', playing: false })
    } else {
      playStartRef.current = { wallTime: performance.now(), timelineSec: currentTimeSec }
      dispatch({ type: 'SET_PLAYING', playing: true })
      startRaf()
    }
  }, [isPlaying, currentTimeSec, startRaf, stopRaf])

  useEffect(() => () => stopRaf(), [stopRaf])

  // ── Sync base video (same approach as Canvas.tsx for overlays) ─────────────

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const clip = getActiveVideoSegment(project, currentTimeSec)
    if (!clip) {
      if (!video.paused) video.pause()
      return
    }

    const videoSrc = pathToFileUrl(clip.src)
    const targetTime = clip.sourceStartUs / 1e6 + (currentTimeSec - clip.startUs / 1e6)

    // Source changed - load new video
    if (video.src !== videoSrc) {
      video.src = videoSrc
      video.currentTime = targetTime
      if (isPlaying) video.play().catch(() => {})
      return
    }

    // Source same - sync playback state and time
    if (isPlaying) {
      if (video.paused) {
        video.currentTime = targetTime
        video.play().catch(() => {})
      } else if (Math.abs(video.currentTime - targetTime) > 0.3) {
        video.currentTime = targetTime
      }
    } else {
      if (!video.paused) video.pause()
      video.currentTime = targetTime
    }
  })

  // ── Hard-coded accounts ──────────────────────────────────────────────────

  useEffect(() => {
    const hardCodedAccounts: Account[] = [
      { id: 'daniel', name: 'Daniel', created: new Date().toISOString() },
      { id: 'stacy', name: 'Stacy', created: new Date().toISOString() }
    ]
    dispatch({ type: 'SET_CURRENT_ACCOUNTS', accounts: hardCodedAccounts })
    dispatch({ type: 'SET_CURRENT_ACCOUNT', accountId: 'daniel' })
  }, [])


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

      // Arrow keys — frame step (or batch navigation in batch mode)
      const { mode, batchProjects, batchSelectedIdx } = stateRef.current
      if (mode === 'batch' && batchProjects.length > 0) {
        if (e.key === 'ArrowLeft' && batchSelectedIdx > 0) {
          e.preventDefault()
          dispatch({ type: 'SELECT_BATCH_PROJECT', idx: batchSelectedIdx - 1 })
          return
        }
        if (e.key === 'ArrowRight' && batchSelectedIdx < batchProjects.length - 1) {
          e.preventDefault()
          dispatch({ type: 'SELECT_BATCH_PROJECT', idx: batchSelectedIdx + 1 })
          return
        }
      } else {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); seekTo(Math.max(0, currentTimeSec - 1 / 30)); return }
        if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(currentTimeSec + 1 / 30); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekTo])  // stable — stateRef keeps values current

  // ── toolbar actions ─────────────────────────────────────────────────────────

  const handleNewProject = useCallback(() => {
    if (!confirm('Start a new project? Unsaved changes will be lost.')) return
    dispatch({ type: 'SET_PROJECT', project: { ...defaultProject, accountId: state.currentAccountId || undefined, tracks: [{ id: uid(), type: 'video', label: 'VIDEO', segments: [], muted: true }] } })
    dispatch({ type: 'SET_FILE_PATH', path: null })
  }, [state.currentAccountId])

  const handleOpenProject = useCallback(() => {
    const accountId = stateRef.current.currentAccountId
    if (!accountId) {
      alert('Please select an account first')
      return
    }
    setShowProjectPicker(true)
  }, [])

  const handleSelectProject = useCallback(async (filePath: string) => {
    setShowProjectPicker(false)
    const result = await window.api.loadProjectFromPath(filePath)
    if (!result) return
    if ('error' in result) { alert(`Error: ${result.error}`); return }
    const project = result as Project
    // Switch to project's account if it has one
    console.log('[handleSelectProject] project.accountId:', project.accountId)
    console.log('[handleSelectProject] available accounts:', stateRef.current.accounts.map(a => a.id))
    if (project.accountId && stateRef.current.accounts.some(a => a.id === project.accountId)) {
      console.log('[handleSelectProject] Switching to account:', project.accountId)
      dispatch({ type: 'SET_CURRENT_ACCOUNT', accountId: project.accountId })
    }
    dispatch({ type: 'SET_PROJECT', project })
    dispatch({ type: 'SET_FILE_PATH', path: filePath })
    dispatch({ type: 'EXIT_BATCH' })
  }, [])

  const handleOpenFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (!result) return
    const batchProjects: BatchProject[] = result.projects.map((p) => ({
      name: p.name,
      path: p.path,
      project: p.project,
      thumbnail: null
    }))
    dispatch({ type: 'SET_BATCH', folderPath: result.folderPath, projects: batchProjects })
    // Render thumbnails in background
    for (const bp of batchProjects) {
      window.api.renderThumbnail(bp.path, 0.5).then((thumb) => {
        if (thumb) dispatch({ type: 'UPDATE_BATCH_THUMBNAIL', filename: bp.name, thumbnail: thumb })
      })
    }
  }, [])

  const handleSaveProject = useCallback(async () => {
    // Generate thumbnail from canvas
    let thumbnailDataUrl: string | undefined
    try {
      const canvasEl = document.querySelector('.canvas-wrapper video') as HTMLVideoElement
      if (canvasEl) {
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = 270 // 9:16 aspect ratio thumbnail
        tempCanvas.height = 480
        const ctx = tempCanvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(canvasEl, 0, 0, tempCanvas.width, tempCanvas.height)
          thumbnailDataUrl = tempCanvas.toDataURL('image/png')
        }
      }
    } catch (err) {
      console.error('Failed to generate thumbnail:', err)
    }

    const result = await window.api.saveProject(project, thumbnailDataUrl, currentFilePath)
    // Update file path if this was a new save
    if (result.filePath && result.filePath !== currentFilePath) {
      dispatch({ type: 'SET_FILE_PATH', path: result.filePath })
    }
    setLastSavedTime(new Date())
  }, [project, currentFilePath])

  // Auto-save on project changes (debounced)
  useEffect(() => {
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    // Set new timeout to save after 2 seconds of inactivity
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSaveProject()
    }, 2000)

    // Cleanup on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [project, handleSaveProject])

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
  }, [project])

  const handleDropVideoRef = useRef(handleDropVideo)
  handleDropVideoRef.current = handleDropVideo
  useEffect(() => {
    const handler = (e: Event) => handleDropVideoRef.current((e as CustomEvent<string>).detail)
    window.addEventListener('video-file-dropped', handler)
    return () => window.removeEventListener('video-file-dropped', handler)
  }, [])

  const handleDropLibraryClip = useCallback((clip: LibraryClip, timeUs: number) => {
    const durationUs = Math.round(clip.duration * 1e6)
    const timeSec = timeUs / 1e6
    const seg: VideoSegment = {
      id: uid(),
      type: 'video',
      src: clip.path,
      name: clip.name,
      startUs: timeUs,
      durationUs,
      sourceStartUs: 0,
      sourceDurationUs: durationUs,
      fileDurationUs: durationUs,
      sourceWidth: clip.width,
      sourceHeight: clip.height,
      clipX: 0,
      clipY: 0,
      clipScale: 1,
      cropLeft: 0,
      cropRight: 0,
      cropTop: 0,
      cropBottom: 0,
    }
    dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
    dispatch({ type: 'SET_TIME', t: timeSec })
  }, [project])

  const handleDropLibraryAudio = useCallback((audio: LibraryAudio, timeUs: number) => {
    try {
      console.log('[App] handleDropLibraryAudio called with:', audio, timeUs)
      const timeSec = timeUs / 1e6

      // Calculate actual duration considering trim
      const fullDurationMs = audio.duration * 1000
      const trimStartMs = audio.trimStartMs ?? 0
      const trimEndMs = audio.trimEndMs ?? fullDurationMs
      const trimmedDurationMs = trimEndMs - trimStartMs
      const trimmedDurationUs = Math.round(trimmedDurationMs * 1000)

      const seg: AudioSegment = {
        id: uid(),
        type: 'audio',
        src: audio.path,
        name: audio.name,
        startUs: timeUs,
        durationUs: trimmedDurationUs,
        sourceStartUs: Math.round(trimStartMs * 1000),
        sourceDurationUs: trimmedDurationUs,
        fileDurationUs: Math.round(fullDurationMs * 1000),
        volume: 1,
        dropTimeUs: audio.dropTimeMs ? Math.round(audio.dropTimeMs * 1000) : undefined
      }
      console.log('[App] Created audio segment:', seg)
      console.log('[App] Dispatching ADD_AUDIO_SEGMENT')
      dispatch({ type: 'ADD_AUDIO_SEGMENT', segment: seg })
      dispatch({ type: 'SET_SELECTED', id: seg.id })
      dispatch({ type: 'SET_TIME', t: timeSec })
      console.log('[App] Audio drop completed successfully')
    } catch (err) {
      console.error('[App] Error in handleDropLibraryAudio:', err)
      alert('Error dropping audio: ' + (err as Error).message)
    }
  }, [project])

  // ── hot-reload: apply external file changes (e.g. from MCP / Claude) ───────

  const [reloadToast, setReloadToast] = useState(false)
  useEffect(() => {
    const unsub = window.api.onProjectFileChanged((project) => {
      // Preserve playhead position and selection when reloading from file
      const currentTime = stateRef.current.currentTimeSec
      const currentSelection = stateRef.current.selectedId
      // Switch to project's account if it has one
      if (project.accountId && stateRef.current.accounts.some(a => a.id === project.accountId)) {
        dispatch({ type: 'SET_CURRENT_ACCOUNT', accountId: project.accountId })
      }
      dispatch({ type: 'SET_PROJECT', project })
      dispatch({ type: 'SET_TIME', t: currentTime })
      if (currentSelection) {
        dispatch({ type: 'SET_SELECTED', id: currentSelection })
      }
      setReloadToast(true)
      setTimeout(() => setReloadToast(false), 2000)
    })
    return unsub
  }, [])

  // Listen for Claude project load requests
  useEffect(() => {
    const unsub = window.api.onLoadProjectRequest(({ project, path }) => {
      // Switch to project's account if it has one
      if (project.accountId && stateRef.current.accounts.some(a => a.id === project.accountId)) {
        dispatch({ type: 'SET_CURRENT_ACCOUNT', accountId: project.accountId })
      }
      dispatch({ type: 'SET_PROJECT', project })
      dispatch({ type: 'SET_FILE_PATH', path })
      // Show toast notification
      setReloadToast(true)
      setTimeout(() => setReloadToast(false), 3000)
    })
    return unsub
  }, [])


  // batch mode hot-reload
  useEffect(() => {
    const unsub = window.api.onBatchFileChanged((data) => {
      dispatch({ type: 'UPDATE_BATCH_PROJECT', filename: data.filename, project: data.project })
      // Re-render thumbnail
      const bp = state.batchProjects.find((p) => p.name === data.filename.replace('.json', ''))
      if (bp) {
        window.api.renderThumbnail(bp.path, 0.5).then((thumb) => {
          if (thumb) dispatch({ type: 'UPDATE_BATCH_THUMBNAIL', filename: data.filename, thumbnail: thumb })
        })
      }
      setReloadToast(true)
      setTimeout(() => setReloadToast(false), 2000)
    })
    return unsub
  }, [state.batchProjects])

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

  // ── clip library ────────────────────────────────────────────────────────────

  const [showClipLibrary, setShowClipLibrary] = useState(true)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showReferenceModal, setShowReferenceModal] = useState(false)

  const handleSelectClip = useCallback(async (clip: LibraryClip) => {
    // Preview clip in canvas or add to timeline
    // For now, just log it - we'll implement add to timeline next
    console.log('Selected clip:', clip)
  }, [])

  // ── audio library ───────────────────────────────────────────────────────────

  const [audios, setAudios] = useState<LibraryAudio[]>([])
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(false)

  // Load audio library on mount
  useEffect(() => {
    window.api.getAudioLibrary().then((result: LibraryAudio[]) => {
      setAudios(result)
    })
  }, [])

  const handleImportAudio = useCallback(async (filePath?: string, isVideo?: boolean) => {
    let result
    if (filePath) {
      // Import from dropped file
      result = await window.api.importAudio(filePath, isVideo || false)
    } else {
      // Use Electron dialog to select audio/video file
      result = await window.api.selectAudioFile()
    }

    if (!result) return null
    if ('error' in result) {
      alert(`Error: ${result.error}`)
      return null
    }

    // Reload audio library
    const audios = await window.api.getAudioLibrary()
    setAudios(audios)

    // Return the newly imported audio so AudioLibrary can show config modal
    // The result has shape { ok: true, audio: LibraryAudio }
    return (result as any).audio as LibraryAudio
  }, [])

  const handleUpdateAudio = useCallback(async (audio: LibraryAudio) => {
    const result = await window.api.updateAudioMetadata(audio.id, {
      waveformData: audio.waveformData,
      dropTimeMs: audio.dropTimeMs,
      trimStartMs: audio.trimStartMs,
      trimEndMs: audio.trimEndMs
    })
    if ('error' in result) {
      alert(`Error: ${result.error}`)
      return
    }
    // Update local state
    setAudios(prev => prev.map(a => a.id === audio.id ? result.audio : a))
  }, [])

  const handleDeleteAudio = useCallback(async (id: string) => {
    const result = await window.api.deleteAudioFromLibrary(id)
    if ('error' in result) {
      alert(`Error: ${result.error}`)
      return
    }
    setAudios(prev => prev.filter(a => a.id !== id))
  }, [])

  // ── accounts ────────────────────────────────────────────────────────────────

  const handleSelectAccount = useCallback((accountId: string) => {
    dispatch({ type: 'SET_CURRENT_ACCOUNT', accountId })
  }, [])

  // Write current account to state file for MCP server
  useEffect(() => {
    window.api.setCurrentAccount(currentAccountId)
  }, [currentAccountId])

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      {reloadToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e1e', border: '1px solid #333', color: '#aaa',
          fontSize: 12, padding: '6px 14px', borderRadius: 6,
          pointerEvents: 'none', zIndex: 9999,
          animation: 'fadeInOut 2s ease forwards',
        }}>
          Reloaded from file
        </div>
      )}
      <Toolbar
        onNew={handleNewProject}
        onOpen={handleOpenProject}
        onSave={handleSaveProject}
        onOpenFolder={handleOpenFolder}
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
        mode={state.mode}
        onExitBatch={() => dispatch({ type: 'EXIT_BATCH' })}
        accounts={accounts}
        currentAccountId={currentAccountId}
        onSelectAccount={handleSelectAccount}
        lastSavedTime={lastSavedTime}
      />

      {/* Batch mode thumbnail grid */}
      {state.mode === 'batch' && state.batchProjects.length > 0 && (
        <div className="batch-grid">
          <div className="batch-header">
            <span className="batch-title">{state.batchFolder?.split('/').pop()} ({state.batchProjects.length} variations)</span>
          </div>
          <div className="batch-thumbnails">
            {state.batchProjects.map((bp, idx) => (
              <div
                key={bp.name}
                className={`batch-thumb ${idx === state.batchSelectedIdx ? 'selected' : ''}`}
                onClick={() => dispatch({ type: 'SELECT_BATCH_PROJECT', idx })}
              >
                {bp.thumbnail ? (
                  <img src={`data:image/jpeg;base64,${bp.thumbnail}`} alt={bp.name} />
                ) : (
                  <div className="batch-thumb-loading">Loading...</div>
                )}
                <div className="batch-thumb-label">{bp.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="app-body">
        {showClipLibrary && (
          <div className="clip-library-panel">
            <ClipLibrary
              onSelectClip={handleSelectClip}
              currentAccountId={currentAccountId}
            />
          </div>
        )}

        <div className="audio-library-panel">
          <AudioLibrary
            audios={audios}
            onImport={handleImportAudio}
            onUpdate={handleUpdateAudio}
            onDelete={handleDeleteAudio}
          />
        </div>

        <div
          className="canvas-area"
          onDoubleClick={() => { if (croppingId) dispatch({ type: 'SET_CROPPING', id: null }) }}
        >
          <div className="canvas-center">
            <Canvas
              project={project}
              currentTimeSec={currentTimeSec}
              selectedId={selectedId}
              croppingId={croppingId}
              isPlaying={isPlaying}
              videoRef={videoRef}
              onSelectSegment={(id) => dispatch({ type: 'SET_SELECTED', id })}
              onUpdateSegment={(id, patch) => dispatch({ type: 'MOVE_SEGMENT', id, patch })}
              onSetCropping={(id) => dispatch({ type: 'SET_CROPPING', id })}
            />
          </div>

          {/* Playback controls */}
          <div className="playback-bar">
            <div className="playback-bar-left">
              <button className="btn" onClick={handleAddVideo} title="Add video clip">+ Video</button>
              <button className="btn" onClick={handleAddText} title="Add text overlay">+ Text</button>
              <button className="btn" onClick={() => setShowReferenceModal(true)} title="Copy structure from a reference video">Copy Reference</button>
            </div>
            <div className="playback-bar-center">
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
            <div className="playback-bar-right"></div>
          </div>
        </div>

        {propertiesPanelOpen && (
          <div className="properties-area">
            <PropertiesPanel
              segment={selectedSegment}
              currentTimeSec={currentTimeSec}
              onUpdate={(id, patch) => dispatch({ type: 'UPDATE_SEGMENT', id, patch })}
              onDelete={(id) => {
                dispatch({ type: 'DELETE_SEGMENT', id })
                dispatch({ type: 'SET_SELECTED', id: null })
              }}
            />
            <button
              className="properties-panel-close"
              onClick={() => setPropertiesPanelOpen(false)}
              title="Hide Properties"
            >
              ×
            </button>
          </div>
        )}
        {!propertiesPanelOpen && (
          <button
            className="properties-panel-toggle"
            onClick={() => setPropertiesPanelOpen(true)}
            title="Show Properties"
          >
            <span>⚙</span>
          </button>
        )}
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
          onUpdateTrack={(id, patch) => dispatch({ type: 'UPDATE_TRACK', id, patch })}
          onDuplicateSegment={handleDuplicateSegment}
          onDropVideo={handleDropVideo}
          onDropLibraryClip={handleDropLibraryClip}
          onDropLibraryAudio={handleDropLibraryAudio}
          onZoomChange={(z) => dispatch({ type: 'SET_ZOOM', zoom: z })}
          onMoveSegmentToNewTrack={handleMoveSegmentToNewTrack}
          onMoveSegmentBetweenTracks={handleMoveSegmentBetweenTracks}
          onPackBaseTrack={handlePackBaseTrack}
        />
      </div>

      {/* Project Picker Modal */}
      {showProjectPicker && currentAccountId && (
        <ProjectPicker
          accountId={currentAccountId}
          onSelect={handleSelectProject}
          onClose={() => setShowProjectPicker(false)}
        />
      )}

      {/* Reference Video Modal */}
      {showReferenceModal && (
        <ReferenceVideoModal
          currentAccountId={currentAccountId}
          onClose={() => setShowReferenceModal(false)}
          onCreateProject={(newProject) => {
            dispatch({ type: 'SET_PROJECT', project: newProject })
            setShowReferenceModal(false)
          }}
        />
      )}
    </div>
  )
}

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
  currentTimeSec: 0,
  selectedId: null,
  zoom: 100,
  isPlaying: false
}

// ── reducer ───────────────────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TIME':
      return { ...state, currentTimeSec: Math.max(0, action.t) }

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.playing }

    case 'SET_SELECTED':
      return { ...state, selectedId: action.id }

    case 'SET_ZOOM':
      return { ...state, zoom: Math.min(500, Math.max(20, action.zoom)) }

    case 'SET_PROJECT':
      return { ...state, project: action.project, currentTimeSec: 0, selectedId: null }

    case 'ADD_VIDEO_SEGMENT': {
      const tracks = state.project.tracks.map((t) => {
        if (t.type !== 'video') return t
        return { ...t, segments: [...t.segments, action.segment] }
      })
      return { ...state, project: { ...state.project, tracks } }
    }

    case 'ADD_TEXT_TRACK': {
      return {
        ...state,
        project: { ...state.project, tracks: [...state.project.tracks, action.track] }
      }
    }

    case 'ADD_TEXT_SEGMENT': {
      const tracks = state.project.tracks.map((t) => {
        if (t.id !== action.trackId) return t
        return { ...t, segments: [...t.segments, action.segment] }
      })
      return { ...state, project: { ...state.project, tracks } }
    }

    case 'UPDATE_SEGMENT': {
      const tracks = state.project.tracks.map((t) => ({
        ...t,
        segments: t.segments.map((s) =>
          s.id === action.id ? ({ ...s, ...action.patch } as Segment) : s
        )
      }))
      return { ...state, project: { ...state.project, tracks } }
    }

    case 'DELETE_SEGMENT': {
      const tracks = state.project.tracks.map((t) => ({
        ...t,
        segments: t.segments.filter((s) => s.id !== action.id)
      }))
      return { ...state, project: { ...state.project, tracks } }
    }

    default:
      return state
  }
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

// Render a text segment to a transparent PNG at full canvas resolution.
// Uses the browser's text engine so emoji and font fallback work correctly.
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

  const { project, currentTimeSec, selectedId, zoom, isPlaying } = state

  // ── seek logic ──────────────────────────────────────────────────────────────

  const seekTo = useCallback((t: number) => {
    const clip = getActiveVideoSegment(project, t)
    if (clip && videoRef.current) {
      const videoSrc = `file://${clip.src}`
      if (videoRef.current.src !== videoSrc) {
        videoRef.current.src = videoSrc
      }
      videoRef.current.currentTime = clip.sourceStartUs / 1e6 + (t - clip.startUs / 1e6)
    }
    dispatch({ type: 'SET_TIME', t })
  }, [project])

  // ── play/pause ──────────────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
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
      // sync video
      const clip = getActiveVideoSegment(project, t)
      if (clip && videoRef.current) {
        const videoSrc = `file://${clip.src}`
        if (videoRef.current.src !== videoSrc) {
          videoRef.current.src = videoSrc
          videoRef.current.play().catch(() => {})
        }
        const expected = clip.sourceStartUs / 1e6 + (t - clip.startUs / 1e6)
        if (Math.abs(videoRef.current.currentTime - expected) > 0.2) {
          videoRef.current.currentTime = expected
        }
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

  // Update playStartRef when time changes externally during playback
  useEffect(() => {
    if (!isPlaying) return
    // This is called when seekTo is triggered while playing; restart RAF reference
  }, [isPlaying])

  // Stop RAF on unmount
  useEffect(() => () => stopRaf(), [stopRaf])

  // ── keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) dispatch({ type: 'DELETE_SEGMENT', id: selectedId })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, selectedId])

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
    // Find end of last video segment on timeline
    let startUs = 0
    for (const track of project.tracks) {
      if (track.type !== 'video') continue
      for (const seg of track.segments) {
        const end = seg.startUs + seg.durationUs
        if (end > startUs) startUs = end
      }
    }
    const seg: VideoSegment = {
      id: uid(),
      type: 'video',
      src: info.path,
      name: info.name,
      startUs,
      durationUs,
      sourceStartUs: 0,
      sourceDurationUs: durationUs,
      sourceWidth: info.width,
      sourceHeight: info.height,
      clipX: 0, clipY: 0, clipScale: 1
    }
    dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
    dispatch({ type: 'SET_TIME', t: startUs / 1e6 })
    // Directly update videoRef — seekTo can't be used here because the new
    // segment isn't in project state yet (dispatch is async)
    if (videoRef.current) {
      videoRef.current.src = `file://${info.path}`
      videoRef.current.currentTime = 0
    }
  }, [project])

  const handleAddText = useCallback(() => {
    // Find an existing text track or create one
    let textTrack = project.tracks.find((t) => t.type === 'text')
    let trackId: string
    if (!textTrack) {
      trackId = uid()
      const newTrack: Track = { id: trackId, type: 'text', label: 'TEXT', segments: [] }
      dispatch({ type: 'ADD_TEXT_TRACK', track: newTrack })
    } else {
      trackId = textTrack.id
    }

    // Place at current time for 3 seconds
    const startUs = Math.round(currentTimeSec * 1e6)
    const seg: TextSegment = {
      id: uid(),
      type: 'text',
      text: 'New Text',
      startUs,
      durationUs: 3_000_000,
      x: 0,
      y: 0,
      fontSize: 120,
      color: '#ffffff',
      bold: false,
      italic: false,
      strokeEnabled: true,
      strokeColor: '#000000',
      textAlign: 'center',
      textScale: 1
    }
    dispatch({ type: 'ADD_TEXT_SEGMENT', segment: seg, trackId })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
  }, [project, currentTimeSec])

  const handleExport = useCallback(async () => {
    let cleanup: (() => void) | null = null
    try {
      // Render text segments to PNGs in the browser first (preserves emoji + WYSIWYG)
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
      cleanup = window.api.onExportProgress((line) => {
        console.log('[ffmpeg]', line)
      })
      const result = await window.api.exportVideo(project, textOverlays)
      if (result.error) alert(`Export failed: ${result.error}`)
    } catch (err: any) {
      alert(`Export error: ${err?.message ?? String(err)}`)
    } finally {
      cleanup?.()
    }
  }, [project])

  // ── drop video onto timeline ────────────────────────────────────────────────

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
      id: uid(),
      type: 'video',
      src: info.path,
      name: info.name,
      startUs,
      durationUs,
      sourceStartUs: 0,
      sourceDurationUs: durationUs,
      sourceWidth: info.width,
      sourceHeight: info.height,
      clipX: 0, clipY: 0, clipScale: 1
    }
    dispatch({ type: 'ADD_VIDEO_SEGMENT', segment: seg })
    dispatch({ type: 'SET_SELECTED', id: seg.id })
    dispatch({ type: 'SET_TIME', t: startUs / 1e6 })
    if (videoRef.current) {
      videoRef.current.src = `file://${info.path}`
      videoRef.current.currentTime = 0
    }
  }, [project])

  // Also listen for the custom event dispatched by the window-level drop handler
  // (second path for drag-drop in case element-level handler doesn't fire)
  const handleDropVideoRef = useRef(handleDropVideo)
  handleDropVideoRef.current = handleDropVideo
  useEffect(() => {
    const handler = (e: Event) => handleDropVideoRef.current((e as CustomEvent<string>).detail)
    window.addEventListener('video-file-dropped', handler)
    return () => window.removeEventListener('video-file-dropped', handler)
  }, [])

  // ── selected segment ────────────────────────────────────────────────────────

  const selectedSegment = selectedId
    ? project.tracks.flatMap((t) => t.segments).find((s) => s.id === selectedId) ?? null
    : null

  const handleUpdateSegment = useCallback((id: string, patch: Partial<Segment>) => {
    dispatch({ type: 'UPDATE_SEGMENT', id, patch })
  }, [])

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-root">
      <Toolbar
        onNew={handleNewProject}
        onOpen={handleOpenProject}
        onSave={handleSaveProject}
        onAddVideo={handleAddVideo}
        onAddText={handleAddText}
        isPlaying={isPlaying}
        onTogglePlay={togglePlay}
        onStepBack={() => seekTo(Math.max(0, currentTimeSec - 1 / 30))}
        onStepForward={() => seekTo(currentTimeSec + 1 / 30)}
        zoom={zoom}
        onZoomChange={(z) => dispatch({ type: 'SET_ZOOM', zoom: z })}
        onExport={handleExport}
        projectName={project.name}
        onRenameProject={(name) =>
          dispatch({ type: 'SET_PROJECT', project: { ...project, name } })
        }
      />

      <div className="app-body">
        <div className="canvas-area">
          <Canvas
            project={project}
            currentTimeSec={currentTimeSec}
            selectedId={selectedId}
            videoRef={videoRef}
            onSelectSegment={(id) => dispatch({ type: 'SET_SELECTED', id })}
            onUpdateSegment={handleUpdateSegment}
          />
        </div>

        <div className="properties-area">
          <PropertiesPanel
            segment={selectedSegment}
            onUpdate={handleUpdateSegment}
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
            if (isPlaying) {
              playStartRef.current = { wallTime: performance.now(), timelineSec: t }
            }
            seekTo(t)
          }}
          onSelectSegment={(id) => dispatch({ type: 'SET_SELECTED', id })}
          onUpdateSegment={(id, patch) => dispatch({ type: 'UPDATE_SEGMENT', id, patch: patch as any })}
          onDropVideo={handleDropVideo}
        />
      </div>
    </div>
  )
}

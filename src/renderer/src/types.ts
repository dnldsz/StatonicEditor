export interface VideoSegment {
  id: string
  type: 'video'
  src: string          // absolute path
  name: string
  startUs: number      // position on timeline (microseconds)
  durationUs: number   // duration on timeline (microseconds)
  sourceStartUs: number    // trim: where in source to start
  sourceDurationUs: number // trim: how much of source to use
  sourceWidth: number      // intrinsic pixel width from ffprobe
  sourceHeight: number     // intrinsic pixel height from ffprobe
  clipX: number        // canvas-space position (-1 to 1), 0 = center
  clipY: number        // canvas-space position (-1 to 1), 0 = center
  clipScale: number    // 1.0 = fill canvas height
}

export interface TextSegment {
  id: string
  type: 'text'
  text: string
  startUs: number
  durationUs: number
  x: number       // -1 to 1 (canvas space)
  y: number       // -1 to 1 (canvas space)
  fontSize: number
  color: string   // hex e.g. "#ffffff"
  bold: boolean
  italic: boolean
  strokeEnabled: boolean  // outline on/off
  strokeColor: string     // outline color hex
  textAlign: 'left' | 'center' | 'right'
  textScale: number       // scale factor from handle drag (1.0 = base)
}

export type Segment = VideoSegment | TextSegment

export interface Track {
  id: string
  type: 'video' | 'text'
  label: string
  segments: Segment[]
}

export interface Project {
  name: string
  canvas: { width: number; height: number }
  tracks: Track[]
}

export interface AppState {
  project: Project
  past: Project[]
  future: Project[]
  clipboard: Segment | null
  currentTimeSec: number
  selectedId: string | null
  zoom: number
  isPlaying: boolean
}

export type Action =
  // ── playback / view ──────────────────────────────────────────────────────
  | { type: 'SET_TIME'; t: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_CLIPBOARD'; segment: Segment | null }
  // ── history ──────────────────────────────────────────────────────────────
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // ── project load ─────────────────────────────────────────────────────────
  | { type: 'SET_PROJECT'; project: Project }
  // ── undoable mutations ───────────────────────────────────────────────────
  | { type: 'ADD_VIDEO_SEGMENT'; segment: VideoSegment }
  | { type: 'ADD_TEXT_WITH_TRACK'; track: Track; segment: TextSegment }
  | { type: 'ADD_SEGMENT_TO_TRACK'; trackId: string; segment: Segment }
  | { type: 'UPDATE_SEGMENT'; id: string; patch: Partial<Segment> }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'SLICE_AT'; timeUs: number }
  // ── drag (no history) ────────────────────────────────────────────────────
  | { type: 'MOVE_SEGMENT'; id: string; patch: Partial<Segment> }

export interface VideoSegment {
  id: string
  type: 'video'
  src: string          // absolute path
  name: string
  startUs: number      // position on timeline (microseconds)
  durationUs: number   // duration on timeline (microseconds)
  sourceStartUs: number    // trim: where in source to start
  sourceDurationUs: number // trim: how much of source to use
  fileDurationUs: number   // total duration of source file (for resize clamping)
  sourceWidth: number      // intrinsic pixel width from ffprobe
  sourceHeight: number     // intrinsic pixel height from ffprobe
  clipX: number        // canvas-space position (-1 to 1), 0 = center
  clipY: number        // canvas-space position (-1 to 1), 0 = center
  clipScale: number    // 1.0 = fill canvas height
  cropLeft: number     // fraction of width to crop from left (0-1)
  cropRight: number    // fraction of width to crop from right (0-1)
  cropTop: number      // fraction of height to crop from top (0-1)
  cropBottom: number   // fraction of height to crop from bottom (0-1)
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

export interface BatchProject {
  name: string
  path: string
  project: Project
  thumbnail: string | null  // base64 JPEG
}

export interface Account {
  id: string
  name: string
  created: string
}

export interface LibraryClip {
  id: string
  accountId: string  // which account owns this clip
  name: string
  path: string
  originalPath: string
  duration: number
  width: number
  height: number
  thumbnail: string
  imported: string
  analyzed: boolean
  category: string
  // Optional analysis fields (from MCP)
  description?: string
  tags?: string[]
  mood?: string
  subject_visible?: boolean
  subject_position?: string
  setting?: string
}

export interface AppState {
  mode: 'single' | 'batch'
  project: Project
  batchFolder: string | null
  batchProjects: BatchProject[]
  batchSelectedIdx: number
  past: Project[]
  future: Project[]
  clipboard: Segment | null
  currentTimeSec: number
  selectedId: string | null
  croppingId: string | null
  zoom: number
  isPlaying: boolean
  currentAccountId: string | null
  accounts: Account[]
}

export type Action =
  // ── playback / view ──────────────────────────────────────────────────────
  | { type: 'SET_TIME'; t: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'SET_CROPPING'; id: string | null }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_CLIPBOARD'; segment: Segment | null }
  // ── history ──────────────────────────────────────────────────────────────
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // ── project load ─────────────────────────────────────────────────────────
  | { type: 'SET_PROJECT'; project: Project }
  // ── batch mode ───────────────────────────────────────────────────────────
  | { type: 'SET_BATCH'; folderPath: string; projects: BatchProject[] }
  | { type: 'SELECT_BATCH_PROJECT'; idx: number }
  | { type: 'UPDATE_BATCH_THUMBNAIL'; filename: string; thumbnail: string }
  | { type: 'UPDATE_BATCH_PROJECT'; filename: string; project: Project }
  | { type: 'EXIT_BATCH' }
  // ── accounts ─────────────────────────────────────────────────────────────
  | { type: 'SET_ACCOUNTS'; accounts: Account[] }
  | { type: 'SET_CURRENT_ACCOUNT'; accountId: string | null }
  | { type: 'ADD_ACCOUNT'; account: Account }
  // ── undoable mutations ───────────────────────────────────────────────────
  | { type: 'ADD_VIDEO_SEGMENT'; segment: VideoSegment }
  | { type: 'ADD_TEXT_WITH_TRACK'; track: Track; segment: TextSegment }
  | { type: 'ADD_SEGMENT_TO_TRACK'; trackId: string; segment: Segment }
  | { type: 'UPDATE_SEGMENT'; id: string; patch: Partial<Segment> }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'SLICE_AT'; timeUs: number }
  | { type: 'MOVE_SEGMENT_TO_TRACK'; segId: string; fromTrackId: string }
  | { type: 'MOVE_SEGMENT_BETWEEN_TRACKS'; segId: string; fromTrackId: string; toTrackId: string }
  // ── drag (no history) ────────────────────────────────────────────────────
  | { type: 'MOVE_SEGMENT'; id: string; patch: Partial<Segment> }
  | { type: 'PACK_BASE_TRACK' }

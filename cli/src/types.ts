export interface ScaleKeyframe {
  timeMs: number
  scale: number
}

export interface VideoSegment {
  id: string
  type: 'video'
  src: string
  name: string
  startUs: number
  durationUs: number
  sourceStartUs: number
  sourceDurationUs: number
  fileDurationUs: number
  sourceWidth: number
  sourceHeight: number
  clipX: number
  clipY: number
  clipScale: number
  scaleKeyframes?: ScaleKeyframe[]
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
}

export interface TextSegment {
  id: string
  type: 'text'
  text: string
  startUs: number
  durationUs: number
  x: number
  y: number
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  strokeEnabled: boolean
  strokeColor: string
  textAlign: 'left' | 'center' | 'right'
  textScale: number
}

export interface AudioSegment {
  id: string
  type: 'audio'
  src: string
  name: string
  startUs: number
  durationUs: number
  sourceStartUs: number
  sourceDurationUs: number
  fileDurationUs: number
  volume: number
  dropTimeUs?: number
}

export type Segment = VideoSegment | TextSegment | AudioSegment

export interface Track {
  id: string
  type: 'video' | 'text' | 'audio'
  label: string
  segments: Segment[]
  muted?: boolean
}

export interface Project {
  name: string
  accountId?: string
  canvas: { width: number; height: number }
  tracks: Track[]
}

export interface Account {
  id: string
  name: string
  created: string
}

export interface ClipMetadata {
  id: string
  path: string
  name: string
  category: string
  duration: number
  width: number
  height: number
  description: string
  tags: string[]
  mood: string
  subject_visible: boolean
  subject_position: string
  setting: string
  keyframe_timestamps: number[]
  added: string
  analyzed_by: string
}

export interface ClipIndex {
  clips: ClipMetadata[]
  categories: string[]
  last_updated: string
}

// ── Reel analysis types ──────────────────────────────────────────────────────

export interface ReelMetadata {
  id: string
  url: string
  views: number
  date: string
  company: string
  duration: number
  width: number
  height: number
}

export interface SceneInfo {
  start: number
  end: number
  duration: number
}

export interface SceneData {
  scenes: SceneInfo[]           // raw visual cuts from FFmpeg
  raw_cuts: SceneInfo[]         // same as scenes (before analysis)
  total_scenes: number
  total_cuts: number
  total_duration: number
  avg_scene_duration: number
  hook_duration: number
  body_avg_duration: number
  cuts_per_second: number
}

/** Claude's analysis of a reel's structure — stored in analysis.json */
export interface ReelAnalysis {
  logical_scenes: LogicalScene[]
  hook_type: string             // e.g. "comparison", "listicle", "question", "statement"
  hook_duration: number
  persistent_text: string[]     // text that stays across multiple scenes
  total_logical_scenes: number
  structure_summary: string     // e.g. "1 hook (3 cuts) + 4 showcase clips"
  notes: string                 // any other observations
}

export interface LogicalScene {
  start: number
  end: number
  duration: number
  cuts: number                  // visual cuts within this logical scene
  text_overlay: string[]        // text visible in this scene
  persistent_text: boolean      // true if text carries over from previous scene
  visual_description: string    // what's shown (e.g. "overhead desk shot, writing")
}

export interface ReelIndexEntry {
  id: string
  url: string
  views: number
  company: string
  detected: boolean
}

export interface LibraryClipMeta {
  id: string
  accountId: string
  name: string
  path: string
  duration: number
  width: number
  height: number
  category: string
  analyzed: boolean
  description?: string
  tags?: string[]
  mood?: string
  subject_visible?: boolean
  subject_position?: string
  setting?: string
}

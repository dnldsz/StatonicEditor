import React, { useEffect, useRef, useState } from 'react'
import { LibraryClip, Project, VideoSegment, TextSegment, Track } from '../types'

export interface ReferenceSlot {
  startSec: number
  durationSec: number
  thumbnailPath: string
  detectedText: string
  clipType: 'hook' | 'gizmo' | 'showcase'
  description: string
  assignedClipId?: string
}

interface SpanningText {
  text: string
  fromSlot: number
  toSlot: number
}

interface YValues {
  hookTextY: number
  spanningTextY: number
  slotTextY: number
}

interface Props {
  onClose: () => void
  onCreateProject: (project: Project) => void
  currentAccountId: string | null
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function keywordScore(slot: ReferenceSlot, clip: LibraryClip): number {
  const haystack = [clip.name, clip.description ?? '', ...(clip.tags ?? [])].join(' ').toLowerCase()
  const needle = [slot.detectedText, slot.description].join(' ').toLowerCase()
  const words = needle.split(/\s+/).filter(w => w.length > 3)
  return words.filter(w => haystack.includes(w)).length
}

function autoAssign(slots: ReferenceSlot[], clips: LibraryClip[], accountId: string | null): ReferenceSlot[] {
  const accountClips = accountId ? clips.filter(c => c.accountId === accountId) : clips
  const byCategory: Record<string, LibraryClip[]> = {}
  for (const clip of accountClips) {
    const cat = clip.category || 'uncategorized'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(clip)
  }
  const usedIds = new Set<string>()
  const cursor: Record<string, number> = {}
  return slots.map(slot => {
    const pool = byCategory[slot.clipType] ?? byCategory['uncategorized'] ?? []
    if (pool.length === 0) return slot
    const scored = pool.map(clip => ({ clip, score: keywordScore(slot, clip) }))
    scored.sort((a, b) => b.score - a.score)
    const best = scored.find(({ clip, score }) => score > 0 && !usedIds.has(clip.id))
    if (best) { usedIds.add(best.clip.id); return { ...slot, assignedClipId: best.clip.id } }
    const available = pool.filter(c => !usedIds.has(c.id))
    const fallback = available.length > 0 ? available : pool
    const idx = (cursor[slot.clipType] ?? 0) % fallback.length
    cursor[slot.clipType] = (cursor[slot.clipType] ?? 0) + 1
    usedIds.add(fallback[idx].id)
    return { ...slot, assignedClipId: fallback[idx].id }
  })
}

const DEFAULT_Y: YValues = { hookTextY: -0.1, spanningTextY: -0.1, slotTextY: -0.35 }

function buildProject(
  slots: ReferenceSlot[],
  spanningTexts: SpanningText[],
  clips: LibraryClip[],
  name: string,
  accountId: string | null,
  y: YValues,
): Project {
  const videoTrack: Track = { id: uid(), type: 'video', label: 'VIDEO', segments: [] }
  const textTrack: Track = { id: uid(), type: 'text', label: 'TEXT', segments: [] }
  const persistentTextTrack: Track = { id: uid(), type: 'text', label: 'PERSISTENT TEXT', segments: [] }

  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si]
    const startUs = Math.round(slot.startSec * 1e6)
    const durationUs = Math.round(slot.durationSec * 1e6)

    if (slot.assignedClipId) {
      const clip = clips.find(c => c.id === slot.assignedClipId)
      if (clip) {
        videoTrack.segments.push({
          id: uid(), type: 'video',
          src: clip.path, name: clip.name,
          startUs, durationUs,
          sourceStartUs: 0, sourceDurationUs: durationUs,
          fileDurationUs: Math.round(clip.duration * 1e6),
          sourceWidth: clip.width, sourceHeight: clip.height,
          clipX: 0, clipY: 0, clipScale: 1,
          cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
        } as VideoSegment)
      }
    }

    if (slot.detectedText) {
      textTrack.segments.push({
        id: uid(), type: 'text', text: slot.detectedText,
        startUs, durationUs,
        x: 0, y: si === 0 ? y.hookTextY : y.slotTextY,
        fontSize: si === 0 ? 75 : 85, color: '#ffffff',
        bold: false, italic: false,
        strokeEnabled: true, strokeColor: '#000000',
        textAlign: 'center', textScale: 1,
      } as TextSegment)
    }
  }

  for (const st of spanningTexts) {
    const fromSlot = slots[st.fromSlot]
    const toSlot = slots[Math.min(st.toSlot, slots.length - 1)]
    if (!fromSlot || !toSlot) continue
    const startUs = Math.round(fromSlot.startSec * 1e6)
    const endUs = Math.round((toSlot.startSec + toSlot.durationSec) * 1e6)
    if (st.text) {
      persistentTextTrack.segments.push({
        id: uid(), type: 'text', text: st.text,
        startUs, durationUs: endUs - startUs,
        x: 0, y: y.spanningTextY,
        fontSize: 60, color: '#ffffff',
        bold: false, italic: false,
        strokeEnabled: true, strokeColor: '#000000',
        textAlign: 'center', textScale: 1,
      } as TextSegment)
    }
  }

  return {
    name,
    accountId: accountId ?? undefined,
    canvas: { width: 1080, height: 1920 },
    tracks: [videoTrack, textTrack, persistentTextTrack].filter(t => t.segments.length > 0),
  }
}

export function ReferenceVideoModal({ onClose, onCreateProject, currentAccountId }: Props): JSX.Element {
  const [step, setStep] = useState<'pick' | 'extracting' | 'waiting'>('pick')
  const [frameCount, setFrameCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const clipsRef = useRef<LibraryClip[]>([])
  const accountIdRef = useRef<string | null>(null)

  useEffect(() => {
    window.api.getClipLibrary().then(c => { clipsRef.current = c }).catch(() => {})
  }, [])
  useEffect(() => { accountIdRef.current = currentAccountId }, [currentAccountId])

  useEffect(() => {
    const unsub = window.api.onReferenceResultReady((result: {
      slots: ReferenceSlot[]
      spanning_texts?: SpanningText[]
      hookTextY?: number
      spanningTextY?: number
      slotTextY?: number
    }) => {
      if (!result?.slots?.length) return
      const y: YValues = {
        hookTextY: result.hookTextY ?? DEFAULT_Y.hookTextY,
        spanningTextY: result.spanningTextY ?? DEFAULT_Y.spanningTextY,
        slotTextY: result.slotTextY ?? DEFAULT_Y.slotTextY,
      }
      const assigned = autoAssign(result.slots, clipsRef.current, accountIdRef.current)
      const project = buildProject(
        assigned,
        result.spanning_texts ?? [],
        clipsRef.current,
        'Reference Copy',
        accountIdRef.current,
        y,
      )
      onCreateProject(project)
    })
    return unsub
  }, [])

  async function handlePickVideo(): Promise<void> {
    const result = await window.api.openVideo()
    if (!result) return
    const videoPath = (result as any).path
    if (!videoPath) return
    setError(null)
    setStep('extracting')
    try {
      const { frameCount: n } = await window.api.extractReferenceFrames(videoPath)
      setFrameCount(n)
      setStep('waiting')
    } catch (err: any) {
      setError(err?.message ?? String(err))
      setStep('pick')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #333',
        borderRadius: 10, width: 600, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', color: '#ddd',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Copy Reference Video</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {step === 'pick' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: '#888', marginBottom: 24 }}>
                Select a reference video. Claude Code will analyze it and create the project automatically.
              </p>
              {error && <p style={{ color: '#e05252', marginBottom: 16, fontSize: 13 }}>{error}</p>}
              <button
                onClick={handlePickVideo}
                style={{ background: '#2a6ee0', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}
              >
                Select Reference Video
              </button>
            </div>
          )}

          {step === 'extracting' && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
              <div style={{ marginBottom: 16, fontSize: 24 }}>🎬</div>
              <p>Extracting keyframes...</p>
            </div>
          )}

          {step === 'waiting' && (
            <div style={{ padding: '32px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
                <p style={{ color: '#ccc', fontSize: 15, marginBottom: 4 }}>{frameCount} frames extracted</p>
                <p style={{ color: '#666', fontSize: 13 }}>Waiting for Claude Code to analyze...</p>
              </div>
              <div style={{ background: '#222', border: '1px solid #333', borderRadius: 8, padding: '16px 20px' }}>
                <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>In Claude Code, say:</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    flex: 1, background: '#111', borderRadius: 6, padding: '10px 14px',
                    fontFamily: 'monospace', fontSize: 13, color: '#7ec8e3', userSelect: 'all',
                  }}>
                    analyze the reference video frames and write the result
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('analyze the reference video frames and write the result')
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    style={{
                      background: copied ? '#2a4a2a' : '#2a2a2a',
                      border: `1px solid ${copied ? '#52c07a' : '#444'}`,
                      color: copied ? '#52c07a' : '#aaa',
                      borderRadius: 6, padding: '8px 12px',
                      cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <p style={{ color: '#555', fontSize: 12, marginTop: 12 }}>
                  Claude will analyze the frames and create the project automatically.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

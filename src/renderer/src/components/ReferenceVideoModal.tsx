import React, { useEffect, useState } from 'react'
import { LibraryClip, Project, VideoSegment, TextSegment, Track } from '../types'

export interface ReferenceSlot {
  startSec: number
  durationSec: number
  thumbnailPath: string
  detectedText: string
  clipType: 'hook' | 'gizmo' | 'showcase'
  description: string
  assignedClipId?: string
  textOverride?: string
}

interface Props {
  onClose: () => void
  onCreateProject: (project: Project) => void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function ReferenceVideoModal({ onClose, onCreateProject }: Props): JSX.Element {
  const [step, setStep] = useState<'pick' | 'extracting' | 'waiting' | 'edit'>('pick')
  const [frameCount, setFrameCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [slots, setSlots] = useState<ReferenceSlot[]>([])
  const [selectedSlotIdx, setSelectedSlotIdx] = useState(0)
  const [projectName, setProjectName] = useState('Reference Copy')
  const [clips, setClips] = useState<LibraryClip[]>([])

  useEffect(() => {
    window.api.getClipLibrary().then(setClips).catch(() => {})
  }, [])

  // Listen for Claude's analysis result arriving via the file watcher
  useEffect(() => {
    const unsub = window.api.onReferenceResultReady((result: { slots: ReferenceSlot[] }) => {
      if (result?.slots?.length) {
        setSlots(result.slots.map(s => ({ ...s, textOverride: s.detectedText })))
        setStep('edit')
      }
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

  function updateSlot(idx: number, patch: Partial<ReferenceSlot>): void {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  function handleCreateProject(): void {
    const videoTrack: Track = { id: uid(), type: 'video', label: 'VIDEO', segments: [] }
    const textTrack: Track = { id: uid(), type: 'text', label: 'TEXT', segments: [] }

    for (const slot of slots) {
      const startUs = Math.round(slot.startSec * 1e6)
      const durationUs = Math.round(slot.durationSec * 1e6)

      if (slot.assignedClipId) {
        const clip = clips.find(c => c.id === slot.assignedClipId)
        if (clip) {
          const seg: VideoSegment = {
            id: uid(), type: 'video',
            src: clip.path, name: clip.name,
            startUs, durationUs,
            sourceStartUs: 0,
            sourceDurationUs: durationUs,
            fileDurationUs: Math.round(clip.duration * 1e6),
            sourceWidth: clip.width, sourceHeight: clip.height,
            clipX: 0, clipY: 0, clipScale: 1,
            cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
          }
          videoTrack.segments.push(seg)
        }
      }

      const text = slot.textOverride ?? slot.detectedText
      if (text) {
        const seg: TextSegment = {
          id: uid(), type: 'text', text,
          startUs, durationUs,
          x: 0, y: 0.28,
          fontSize: 85, color: '#ffffff',
          bold: false, italic: false,
          strokeEnabled: false, strokeColor: '#000000',
          textAlign: 'center', textScale: 1,
        }
        textTrack.segments.push(seg)
      }
    }

    const project: Project = {
      name: projectName,
      canvas: { width: 1080, height: 1920 },
      tracks: [videoTrack, textTrack].filter(t => t.segments.length > 0),
    }

    onCreateProject(project)
  }

  const clipTypeColor: Record<string, string> = {
    hook: '#e05252',
    gizmo: '#52a8e0',
    showcase: '#52c07a',
  }

  const selectedSlot = slots[selectedSlotIdx]
  const filteredClips = selectedSlot
    ? clips.filter(c => !c.category || c.category === selectedSlot.clipType || c.category === 'uncategorized' || c.category === '')
    : clips

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #333',
        borderRadius: 10, width: 700, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', color: '#ddd',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Copy Reference Video</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

          {/* Step: pick */}
          {step === 'pick' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: '#888', marginBottom: 24 }}>
                Select a reference video to extract its scene structure, then have Claude Code analyze it.
              </p>
              {error && <p style={{ color: '#e05252', marginBottom: 16, fontSize: 13 }}>{error}</p>}
              <button
                onClick={handlePickVideo}
                style={{
                  background: '#2a6ee0', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '10px 24px', fontSize: 14, cursor: 'pointer',
                }}
              >
                Select Reference Video
              </button>
            </div>
          )}

          {/* Step: extracting frames */}
          {step === 'extracting' && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
              <div style={{ marginBottom: 16, fontSize: 24 }}>🎬</div>
              <p>Detecting scenes and extracting keyframes...</p>
            </div>
          )}

          {/* Step: waiting for Claude Code */}
          {step === 'waiting' && (
            <div style={{ padding: '32px 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
                <p style={{ color: '#ccc', fontSize: 15, marginBottom: 4 }}>
                  {frameCount} frames extracted
                </p>
                <p style={{ color: '#666', fontSize: 13 }}>Waiting for Claude Code to analyze the frames...</p>
              </div>

              <div style={{
                background: '#222', border: '1px solid #333', borderRadius: 8,
                padding: '16px 20px',
              }}>
                <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12, fontWeight: 600 }}>
                  In Claude Code, say:
                </p>
                <div style={{
                  background: '#111', borderRadius: 6, padding: '10px 14px',
                  fontFamily: 'monospace', fontSize: 13, color: '#7ec8e3',
                  userSelect: 'all',
                }}>
                  analyze the reference video frames and write the result
                </div>
                <p style={{ color: '#555', fontSize: 12, marginTop: 12 }}>
                  Claude will call <code style={{ color: '#888' }}>get_reference_frames</code> to view the scenes,
                  then <code style={{ color: '#888' }}>write_reference_result</code> to send the analysis here.
                  The modal will update automatically.
                </p>
              </div>
            </div>
          )}

          {/* Step: edit slots */}
          {step === 'edit' && slots.length > 0 && (
            <>
              {/* Slot strip */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {slots.map((slot, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedSlotIdx(idx)}
                    style={{
                      border: `2px solid ${idx === selectedSlotIdx ? '#2a6ee0' : '#333'}`,
                      borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
                      background: idx === selectedSlotIdx ? '#1e2d4a' : '#222',
                      minWidth: 80,
                    }}
                  >
                    <div style={{
                      fontSize: 10, color: clipTypeColor[slot.clipType] ?? '#888',
                      textTransform: 'uppercase', fontWeight: 600, marginBottom: 2,
                    }}>
                      {slot.clipType}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>
                      {slot.startSec.toFixed(1)}s · {slot.durationSec.toFixed(1)}s
                    </div>
                    {slot.assignedClipId && (
                      <div style={{ fontSize: 10, color: '#52c07a', marginTop: 2 }}>✓ clip</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Selected slot details */}
              {selectedSlot && (
                <div style={{ background: '#222', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                    {selectedSlot.description || 'No description detected'}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>TEXT OVERLAY</label>
                    <textarea
                      value={selectedSlot.textOverride ?? ''}
                      onChange={e => updateSlot(selectedSlotIdx, { textOverride: e.target.value })}
                      rows={3}
                      style={{
                        width: '100%', background: '#1a1a1a', border: '1px solid #444',
                        borderRadius: 4, color: '#ddd', padding: '6px 8px', fontSize: 13,
                        resize: 'vertical', boxSizing: 'border-box',
                      }}
                      placeholder="Text overlay (use \n for line breaks)"
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 6 }}>
                      ASSIGN CLIP
                      <span style={{ marginLeft: 8, color: clipTypeColor[selectedSlot.clipType] ?? '#888', textTransform: 'uppercase' }}>
                        (suggested: {selectedSlot.clipType})
                      </span>
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflow: 'auto' }}>
                      {filteredClips.length === 0 && (
                        <span style={{ fontSize: 12, color: '#555' }}>No clips in library matching this type</span>
                      )}
                      {filteredClips.slice(0, 20).map(clip => (
                        <div
                          key={clip.id}
                          onClick={() => updateSlot(selectedSlotIdx, { assignedClipId: clip.id })}
                          style={{
                            border: `2px solid ${selectedSlot.assignedClipId === clip.id ? '#2a6ee0' : '#333'}`,
                            borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                            background: selectedSlot.assignedClipId === clip.id ? '#1e2d4a' : '#1a1a1a',
                            fontSize: 11, color: '#ccc',
                          }}
                        >
                          {clip.name || clip.id.slice(0, 8)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Project name */}
              <div style={{ marginBottom: 4 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4 }}>PROJECT NAME</label>
                <input
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  style={{
                    width: '100%', background: '#222', border: '1px solid #444',
                    borderRadius: 4, color: '#ddd', padding: '6px 8px', fontSize: 13,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step === 'edit' && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #333', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              onClick={onClose}
              style={{ background: '#2a2a2a', border: '1px solid #444', color: '#aaa', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateProject}
              style={{ background: '#2a6ee0', border: 'none', color: '#fff', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 13 }}
            >
              Create Project
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

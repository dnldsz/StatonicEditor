import React, { useEffect, useState } from 'react'
import { Project, VideoSegment, TextSegment, LibraryClip } from '../types'

export interface VariationEntry {
  name: string
  path: string
  project: Project
  thumbnail: string | null
}

interface Props {
  project: Project
  clips: LibraryClip[]
  onOpenVariation: (v: VariationEntry) => void
  onClose: () => void
  projectName: string
}

function buildAnatomy(p: Project): Array<{ slotLabel: string; clipName: string; text: string }> {
  const videoSegs: VideoSegment[] = []
  for (const track of p.tracks) {
    if (track.type !== 'video') continue
    for (const seg of track.segments) {
      if (seg.type === 'video') videoSegs.push(seg as VideoSegment)
    }
  }
  videoSegs.sort((a, b) => a.startUs - b.startUs)

  const textSegs: TextSegment[] = []
  for (const track of p.tracks) {
    if (track.type !== 'text') continue
    for (const seg of track.segments) {
      if (seg.type === 'text') textSegs.push(seg as TextSegment)
    }
  }

  return videoSegs.map((vseg, i) => {
    const midUs = vseg.startUs + vseg.durationUs / 2
    const match = textSegs.find(t => t.startUs <= midUs && t.startUs + t.durationUs >= midUs)
    return {
      slotLabel: i === 0 ? 'Hook' : `Clip ${i + 1}`,
      clipName: vseg.name,
      text: match?.text ?? '',
    }
  })
}

export function VariationsPanel({ project, clips: _clips, onOpenVariation, onClose, projectName }: Props): JSX.Element {
  const [variations, setVariations] = useState<VariationEntry[]>([])
  const [rendering, setRendering] = useState<Set<string>>(new Set())
  const anatomy = buildAnatomy(project)

  useEffect(() => {
    const unsub = (window.api as any).onVariationAdded((data: { name: string; path: string; project: Project }) => {
      setVariations(prev => {
        const exists = prev.find(v => v.path === data.path)
        if (exists) {
          return prev.map(v => v.path === data.path ? { ...v, project: data.project } : v)
        }
        const entry: VariationEntry = { name: data.name, path: data.path, project: data.project, thumbnail: null }
        setRendering(s => new Set(s).add(data.path))
        window.api.renderThumbnail(data.path, 0.5).then((thumb: string | null) => {
          setVariations(prev2 => prev2.map(v => v.path === data.path ? { ...v, thumbnail: thumb } : v))
          setRendering(s => { const n = new Set(s); n.delete(data.path); return n })
        }).catch(() => {
          setRendering(s => { const n = new Set(s); n.delete(data.path); return n })
        })
        return [...prev, entry]
      })
    })
    return unsub
  }, [])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: '#141414', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        height: 48, flexShrink: 0,
        background: '#1e1e1e', borderBottom: '1px solid #2a2a2a',
        display: 'flex', alignItems: 'center',
        padding: '0 20px 0 160px', gap: 16,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#ddd', flex: 1, textAlign: 'center' }}>
          {projectName} <span style={{ color: '#555', fontWeight: 400, marginLeft: 6 }}>variations</span>
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: '1px solid #444', color: '#aaa',
            borderRadius: 6, padding: '5px 14px', fontSize: 13, cursor: 'pointer',
          }}
        >
          Exit Variations
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Project anatomy */}
        <div style={{
          width: 260, flexShrink: 0,
          background: '#1a1a1a', borderRight: '1px solid #2a2a2a',
          overflowY: 'auto', padding: '16px 14px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#555', marginBottom: 14 }}>
            Project Anatomy
          </div>
          {anatomy.map((slot, i) => (
            <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #242424' }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#555', letterSpacing: '0.06em', marginBottom: 3 }}>
                {slot.slotLabel}
              </div>
              <div style={{ fontSize: 12, color: '#bbb', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {slot.clipName}
              </div>
              {slot.text && (
                <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  "{slot.text}"
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: Variations grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {variations.length === 0 ? (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: '#444', fontSize: 14, gap: 10, textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 4 }}>✦</div>
              <div>No variations yet</div>
              <div style={{ fontSize: 12, color: '#333', maxWidth: 320 }}>
                Ask Claude Code to generate variations — they'll appear here automatically as each one is written.
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
              gap: 16, alignContent: 'start',
            }}>
              {variations.map((v) => (
                <VariationCard
                  key={v.path}
                  variation={v}
                  isRendering={rendering.has(v.path)}
                  onClick={() => onOpenVariation(v)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function VariationCard({ variation, isRendering, onClick }: {
  variation: VariationEntry
  isRendering: boolean
  onClick: () => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const anatomy = buildAnatomy(variation.project)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#1e1e1e',
        border: `1px solid ${hovered ? '#555' : '#2a2a2a'}`,
        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'none',
        transition: 'border-color 0.15s, transform 0.12s',
      }}
    >
      {/* Thumbnail */}
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {variation.thumbnail
          ? <img src={`data:image/jpeg;base64,${variation.thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 11, color: '#444' }}>{isRendering ? 'Rendering…' : 'No preview'}</span>
        }
      </div>

      {/* Name */}
      <div style={{ padding: '8px 10px 4px', fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>
        {variation.name}
      </div>

      {/* Slot chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 10px 10px' }}>
        {anatomy.map((slot, i) => (
          <div key={i} title={`${slot.clipName}${slot.text ? ` — "${slot.text}"` : ''}`} style={{
            fontSize: 10, color: '#777', background: '#252525',
            borderRadius: 3, padding: '2px 6px',
          }}>
            {slot.slotLabel}
          </div>
        ))}
      </div>
    </div>
  )
}

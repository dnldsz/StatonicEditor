import React, { useEffect, useState } from 'react'
import { LibraryClip, VideoSegment } from '../types'

interface Props {
  segment: VideoSegment
  currentAccountId: string | null
  onReplace: (clip: LibraryClip) => void
  onClose: () => void
}

export function ReplaceClipModal({ segment, currentAccountId, onReplace, onClose }: Props): JSX.Element {
  const [clips, setClips] = useState<LibraryClip[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.api.getClipLibrary().then((all) => {
      const filtered = currentAccountId ? all.filter((c) => c.accountId === currentAccountId) : all
      setClips(filtered)
    }).catch(() => {})
  }, [currentAccountId])

  const visible = clips.filter((c) => {
    if (!query) return true
    const q = query.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q) || (c.tags ?? []).some((t) => t.toLowerCase().includes(q))
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2500,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1c1c1c', border: '1px solid #333',
        borderRadius: 10, width: 600, height: '80vh',
        display: 'flex', flexDirection: 'column', color: '#ddd',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Replace: {segment.name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #222' }}>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clips..."
            style={{
              width: '100%', background: '#111', border: '1px solid #383838',
              borderRadius: 6, padding: '7px 12px', color: '#ddd',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Clip grid */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, alignContent: 'start' }}>
          {visible.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#555', padding: '40px 0', fontSize: 13 }}>
              {clips.length === 0 ? 'No clips in library' : 'No results'}
            </div>
          )}
          {visible.map((clip) => (
            <div
              key={clip.id}
              onClick={() => { onReplace(clip); onClose() }}
              style={{
                borderRadius: 7, overflow: 'hidden',
                border: clip.id === segment.id ? '2px solid #2a5ecc' : '2px solid transparent',
                cursor: 'pointer', background: '#111',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#555' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = clip.id === segment.id ? '#2a5ecc' : 'transparent' }}
            >
              {clip.thumbnail
                ? <img src={`file://${clip.thumbnail}`} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', aspectRatio: '9/16', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 20 }}>🎬</div>
              }
              <div style={{ padding: '6px 8px' }}>
                <div style={{ fontSize: 12, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.name}</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{clip.duration.toFixed(1)}s</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { LibraryClip } from '../types'

interface ClipLibraryProps {
  onSelectClip: (clip: LibraryClip) => void
  onRefresh?: () => void
  currentAccountId: string | null
}

export default function ClipLibrary({ onSelectClip, onRefresh, currentAccountId }: ClipLibraryProps): JSX.Element {
  const [clips, setClips] = useState<LibraryClip[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [claudeFilter, setClaudeFilter] = useState<string | null>(null)
  const dragCounter = React.useRef(0)
  const videoRefs = React.useRef<Map<string, HTMLVideoElement>>(new Map())

  const loadClips = async () => {
    setLoading(true)
    try {
      const libraryClips = await window.api.getClipLibrary()
      setClips(libraryClips)
    } catch (err) {
      console.error('Failed to load clip library:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClips()
  }, [])

  // Listen for Claude filter requests
  useEffect(() => {
    const unsubscribe = window.api.onFilterRequestChanged((filter) => {
      if (filter.accountId === currentAccountId) {
        setClaudeFilter(filter.category)
      }
    })
    return unsubscribe
  }, [currentAccountId])

  const handleImport = async () => {
    if (!currentAccountId) {
      alert('Please select an account first')
      return
    }
    const result = await window.api.openVideo()
    if (!result) return

    const imported = await window.api.importClip(result.path, currentAccountId)
    if (imported.ok && imported.clip) {
      setClips([...clips, imported.clip])
      onRefresh?.()
    } else if (imported.error) {
      alert(`Failed to import: ${imported.error}`)
    }
  }

  const handleDelete = async (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this clip from library?')) return

    const result = await window.api.deleteClipFromLibrary(clipId)
    if (result.ok) {
      setClips(clips.filter(c => c.id !== clipId))
      if (selectedId === clipId) setSelectedId(null)
    }
  }

  const handleTogglePlay = (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRefs.current.get(clipId)
    if (!video) return

    if (playingId === clipId) {
      video.pause()
      setPlayingId(null)
    } else {
      // Pause any other playing video
      if (playingId) {
        const prevVideo = videoRefs.current.get(playingId)
        if (prevVideo) prevVideo.pause()
      }
      video.currentTime = 0
      video.play()
      setPlayingId(clipId)
    }
  }

  const handleDragStart = (e: React.DragEvent, clip: LibraryClip) => {
    e.dataTransfer.setData('clipId', clip.id)
    e.dataTransfer.setData('clipPath', clip.path)
    e.dataTransfer.effectAllowed = 'copy'
  }

  // File drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDraggingOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    dragCounter.current = 0

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'))
    if (videoFiles.length === 0) {
      alert('Please drop video files only')
      return
    }

    setLoading(true)
    const imported: LibraryClip[] = []

    for (const file of videoFiles) {
      try {
        if (!currentAccountId) continue
        const filePath = window.api.getPathForFile(file)
        const result = await window.api.importClip(filePath, currentAccountId)

        if (result.ok && result.clip) {
          imported.push(result.clip)
        } else if (result.error) {
          console.error(`Failed to import ${file.name}:`, result.error)
        }
      } catch (err) {
        console.error(`Error importing ${file.name}:`, err)
      }
    }

    if (imported.length > 0) {
      setClips([...clips, ...imported])
      onRefresh?.()
    }

    setLoading(false)
  }

  const filtered = clips.filter(c => {
    // Account filter
    if (c.accountId !== currentAccountId) return false

    // Claude category filter
    if (claudeFilter && c.category !== claudeFilter) return false

    // Search filter
    if (search && !(
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.category.toLowerCase().includes(search.toLowerCase()) ||
      c.tags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
    )) return false

    return true
  })

  const unanalyzedCount = clips.filter(c => !c.analyzed && c.accountId === currentAccountId).length

  return (
    <div
      className={`clip-library ${isDraggingOver ? 'drop-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="clip-drop-overlay">
          <div className="clip-drop-message">
            <div className="clip-drop-icon">📁</div>
            <div>Drop videos to import</div>
          </div>
        </div>
      )}

      <div className="clip-library-header">
        <h3 className="clip-library-title">Clip Library</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button className="library-refresh-btn" onClick={loadClips} title="Refresh clip library">
            ↻
          </button>
          <button className="btn btn-sm" onClick={handleImport} title="Import clip to library">
            + Import
          </button>
        </div>
      </div>

      {claudeFilter && (
        <div className="claude-filter-banner">
          <div className="claude-filter-message">
            ✨ Filtered by Claude: showing only <strong>{claudeFilter}</strong> clips
          </div>
          <button
            className="claude-filter-clear"
            onClick={() => setClaudeFilter(null)}
            title="Clear Claude filter"
          >×</button>
        </div>
      )}

      {unanalyzedCount > 0 && (
        <div className="clip-analysis-banner">
          <div className="clip-analysis-message">
            {unanalyzedCount} clip{unanalyzedCount !== 1 ? 's' : ''} need{unanalyzedCount === 1 ? 's' : ''} analysis - Use Claude Code to analyze
          </div>
        </div>
      )}

      <div className="clip-grid">
        {loading ? (
          <div className="clip-library-empty">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="clip-library-empty">
            {clips.length === 0 ? 'No clips yet. Import videos to get started.' : 'No clips match search.'}
          </div>
        ) : (
          filtered.map((clip) => (
            <div
              key={clip.id}
              className={`clip-card ${selectedId === clip.id ? 'selected' : ''} ${playingId === clip.id ? 'playing' : ''}`}
              onClick={() => {
                setSelectedId(clip.id)
                onSelectClip(clip)
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, clip)}
            >
              <div className="clip-thumb">
                <img
                  src={`file://${clip.thumbnail}`}
                  alt={clip.name}
                  draggable={false}
                  style={{ opacity: playingId === clip.id ? 0 : 1 }}
                />
                <video
                  ref={(el) => {
                    if (el) videoRefs.current.set(clip.id, el)
                    else videoRefs.current.delete(clip.id)
                  }}
                  src={`file://${clip.path}`}
                  loop
                  muted
                  className="clip-thumb-video"
                  style={{ opacity: playingId === clip.id ? 1 : 0 }}
                  onEnded={() => setPlayingId(null)}
                />
                <div className="clip-duration">{clip.duration.toFixed(1)}s</div>
                {clip.analyzed && (
                  <div className="clip-hover-tooltip">
                    <div className="tooltip-section">
                      <div className="tooltip-label">Description</div>
                      <div className="tooltip-value">{clip.description || 'No description'}</div>
                    </div>
                    {clip.tags && clip.tags.length > 0 && (
                      <div className="tooltip-section">
                        <div className="tooltip-label">All Tags ({clip.tags.length})</div>
                        <div className="tooltip-tags">
                          {clip.tags.map(tag => (
                            <span key={tag} className="tooltip-tag">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="tooltip-section">
                      <div className="tooltip-label">Details</div>
                      <div className="tooltip-details">
                        <div>Category: <strong>{clip.category}</strong></div>
                        <div>Mood: <strong>{clip.mood}</strong></div>
                        {clip.subject_visible !== undefined && (
                          <div>Subject: <strong>{clip.subject_visible ? clip.subject_position : 'None visible'}</strong></div>
                        )}
                        {clip.setting && <div>Setting: <strong>{clip.setting}</strong></div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="clip-info">
                <div className="clip-name">
                  <span title={clip.name}>{clip.name}</span>
                  <button
                    className="clip-preview-btn"
                    onClick={(e) => handleTogglePlay(clip.id, e)}
                    title={playingId === clip.id ? "Pause preview" : "Play preview"}
                  >{playingId === clip.id ? '⏸' : '▶'}</button>
                </div>
                <div className="clip-meta">
                  {clip.width}×{clip.height}
                  {clip.analyzed && clip.category && clip.category !== 'uncategorized' && (
                    <span className={`clip-category-badge clip-category-${clip.category}`}>
                      {clip.category}
                    </span>
                  )}
                  {clip.analyzed && clip.mood && (
                    <span className="clip-mood" title={clip.mood}>
                      {clip.mood === 'focused' ? '🎯' : clip.mood === 'energetic' ? '⚡' : clip.mood === 'calm' ? '🌊' : '💼'}
                    </span>
                  )}
                </div>
                {clip.analyzed && clip.tags && clip.tags.length > 0 && (
                  <div className="clip-tags">
                    {clip.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="clip-tag">{tag}</span>
                    ))}
                    {clip.tags.length > 3 && <span className="clip-tag">+{clip.tags.length - 3}</span>}
                  </div>
                )}
              </div>
              <button
                className="clip-delete"
                onClick={(e) => handleDelete(clip.id, e)}
                title="Delete from library"
              >×</button>
            </div>
          ))
        )}
      </div>

      <div className="clip-library-footer">
        <span className="clip-count">{filtered.length} clip{filtered.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

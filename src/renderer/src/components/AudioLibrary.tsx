import { useState, useCallback, useRef, useEffect } from 'react'
import type { LibraryAudio } from '../types'
import { AudioConfigModal } from './AudioConfigModal'

interface Props {
  audios: LibraryAudio[]
  onImport: (filePath?: string, isVideo?: boolean) => Promise<LibraryAudio | null>
  onUpdate: (audio: LibraryAudio) => void
  onDelete: (id: string) => void
}

function WaveformThumbnail({ audio }: { audio: LibraryAudio }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height

    // Clear canvas with export button blue
    ctx.fillStyle = '#0a7ef0'
    ctx.fillRect(0, 0, width, height)

    // Draw waveform if available
    if (audio.waveformData && audio.waveformData.length > 0) {
      const waveform = audio.waveformData

      // Downsample to ~40 bars for cleaner look
      const numBars = 40
      const barWidth = 4
      const barSpacing = width / numBars
      const centerY = height / 2

      ctx.fillStyle = '#ffffff'

      for (let i = 0; i < numBars; i++) {
        // Sample waveform data
        const sampleIndex = Math.floor((i / numBars) * waveform.length)
        const value = waveform[sampleIndex] || 0

        // Calculate bar height with some randomness for abstraction
        const barHeight = Math.max(value * centerY * 0.7, 4)
        const x = i * barSpacing + (barSpacing - barWidth) / 2
        const y = centerY - barHeight / 2

        // Draw rounded bar
        const radius = barWidth / 2
        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, radius)
        ctx.fill()
      }
    } else {
      // Show placeholder if no waveform data
      ctx.fillStyle = '#ffffff'
      ctx.font = '40px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('🎵', width / 2, height / 2)
    }
  }, [audio.waveformData])

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={60}
      className="audio-waveform-thumbnail"
    />
  )
}

export function AudioLibrary({ audios, onImport, onUpdate, onDelete }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configModalAudio, setConfigModalAudio] = useState<LibraryAudio | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const dragCounter = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const handleDragStart = (e: React.DragEvent, audio: LibraryAudio) => {
    e.dataTransfer.setData('audioId', audio.id)
    e.dataTransfer.setData('audioPath', audio.path)
    e.dataTransfer.effectAllowed = 'copy'
    console.log('[AudioLibrary] Drag start - audioId:', audio.id, 'path:', audio.path)
  }

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDraggingOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    dragCounter.current = 0

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const file = files[0]
    const isAudioOrVideo = file.type.startsWith('audio/') || file.type.startsWith('video/')

    if (isAudioOrVideo) {
      const filePath = window.api.getPathForFile(file)
      const isVideo = file.type.startsWith('video/')
      const newAudio = await onImport(filePath, isVideo)

      // Show config modal for newly imported audio
      if (newAudio) {
        setConfigModalAudio(newAudio)
      }
    }
  }, [onImport])

  const handleDelete = useCallback((id: string) => {
    if (!confirm('Delete this audio from library?')) return
    onDelete(id)
    if (selectedId === id) setSelectedId(null)
  }, [selectedId, onDelete])

  const handleImportClick = useCallback(async () => {
    const newAudio = await onImport()
    if (newAudio) {
      setConfigModalAudio(newAudio)
    }
  }, [onImport])

  const handlePlayAudio = useCallback((e: React.MouseEvent, audio: LibraryAudio) => {
    e.stopPropagation()

    if (playingId === audio.id) {
      // Pause current audio
      audioRef.current?.pause()
      setPlayingId(null)
    } else {
      // Play new audio
      if (audioRef.current) {
        audioRef.current.src = `file://${audio.path}`
        audioRef.current.play()
        setPlayingId(audio.id)
      }
    }
  }, [playingId])

  // Handle audio ended
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => setPlayingId(null)
    audio.addEventListener('ended', handleEnded)
    return () => audio.removeEventListener('ended', handleEnded)
  }, [])

  return (
    <div
      className={`audio-library ${isDraggingOver ? 'drop-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="audio-drop-overlay">
          <div className="audio-drop-message">
            <div className="audio-drop-icon">🎵</div>
            <div>Drop audio/video to import</div>
          </div>
        </div>
      )}

      <div className="audio-library-header">
        <h3 className="audio-library-title">Audio Library</h3>
        <button className="btn btn-sm" onClick={handleImportClick} title="Import audio to library">
          + Import
        </button>
      </div>

      <div className="audio-grid">
        {audios.length === 0 ? (
          <div className="audio-library-empty">
            No audios yet. Drop audio/video files to import.
          </div>
        ) : (
          audios.map((audio) => (
            <div
              key={audio.id}
              className={`audio-card ${selectedId === audio.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(audio.id)}
              onDoubleClick={() => setConfigModalAudio(audio)}
              draggable
              onDragStart={(e) => handleDragStart(e, audio)}
            >
              <WaveformThumbnail audio={audio} />

              <div className="audio-info">
                <button
                  className="audio-play-btn"
                  onClick={(e) => handlePlayAudio(e, audio)}
                  title={playingId === audio.id ? 'Pause' : 'Play'}
                >
                  {playingId === audio.id ? '⏸' : '▶'}
                </button>

                <div className="audio-name" title={audio.name}>
                  {audio.name}
                </div>

                <div className="audio-meta">
                  <span>{formatDuration(audio.duration)}</span>
                  {audio.dropTimeMs !== undefined && (
                    <span className="audio-drop-badge">Drop: {formatTime(audio.dropTimeMs)}</span>
                  )}
                </div>
              </div>

              <button
                className="audio-delete-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(audio.id)
                }}
                title="Delete audio"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {configModalAudio && (
        <AudioConfigModal
          audio={configModalAudio}
          onSave={(updatedAudio) => {
            onUpdate(updatedAudio)
            setConfigModalAudio(null)
          }}
          onCancel={() => setConfigModalAudio(null)}
        />
      )}

      {/* Hidden audio element for playback */}
      <audio ref={audioRef} />
    </div>
  )
}

function formatDuration(sec: number): string {
  const mins = Math.floor(sec / 60)
  const secs = Math.floor(sec % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatTime(ms: number): string {
  const sec = ms / 1000
  const mins = Math.floor(sec / 60)
  const secs = Math.floor(sec % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

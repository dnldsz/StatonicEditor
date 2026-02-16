import { useState, useEffect, useRef, useCallback } from 'react'
import type { LibraryAudio } from '../types'

interface Props {
  audio: LibraryAudio
  onSave: (audio: LibraryAudio) => void
  onCancel: () => void
}

export function AudioConfigModal({ audio, onSave, onCancel }: Props) {
  const [dropTimeMs, setDropTimeMs] = useState(audio.dropTimeMs ?? 0)
  const [trimStartMs, setTrimStartMs] = useState(audio.trimStartMs ?? 0)
  const [trimEndMs, setTrimEndMs] = useState(audio.trimEndMs ?? audio.duration * 1000)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [duration, setDuration] = useState(audio.duration)
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const waveformDataRef = useRef<number[]>([])

  // Update duration when audio metadata loads
  useEffect(() => {
    const audioEl = audioRef.current
    if (!audioEl) return

    const handleLoadedMetadata = () => {
      const dur = audioEl.duration
      setDuration(dur)
      if (trimEndMs === audio.duration * 1000) {
        setTrimEndMs(dur * 1000)
      }
    }

    audioEl.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => audioEl.removeEventListener('loadedmetadata', handleLoadedMetadata)
  }, [])

  // Generate waveform from audio element
  useEffect(() => {
    if (audio.waveformData) {
      waveformDataRef.current = audio.waveformData
      drawWaveform()
    } else {
      generateWaveform()
    }
  }, [audio.path])

  const generateWaveform = async () => {
    try {
      const audioEl = audioRef.current
      if (!audioEl) return

      // Wait for audio to be loadable
      await new Promise((resolve) => {
        if (audioEl.readyState >= 2) {
          resolve(null)
        } else {
          audioEl.addEventListener('loadeddata', resolve, { once: true })
        }
      })

      const audioContext = new AudioContext()

      // Fetch the audio file as array buffer
      const response = await fetch(audioEl.src)
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      // Downsample to ~500 samples for visualization
      const samples = 500
      const blockSize = Math.floor(audioBuffer.length / samples)
      const channelData = audioBuffer.getChannelData(0)
      const waveformData: number[] = []

      for (let i = 0; i < samples; i++) {
        const start = i * blockSize
        const end = Math.min(start + blockSize, channelData.length)
        let max = 0
        for (let j = start; j < end; j++) {
          max = Math.max(max, Math.abs(channelData[j]))
        }
        waveformData.push(max)
      }

      waveformDataRef.current = waveformData
      drawWaveform()
    } catch (err) {
      console.error('Failed to generate waveform:', err)
    }
  }

  const drawWaveform = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const waveform = waveformDataRef.current
    if (waveform.length === 0) return

    const width = canvas.width
    const height = canvas.height
    const barWidth = width / waveform.length
    const centerY = height / 2

    ctx.clearRect(0, 0, width, height)

    // Draw waveform
    const totalDuration = duration * 1000
    waveform.forEach((value, i) => {
      const x = i * barWidth
      const timeMs = (i / waveform.length) * totalDuration

      // Dim the trimmed regions
      const isTrimmed = timeMs < trimStartMs || timeMs > trimEndMs
      ctx.fillStyle = isTrimmed ? '#444' : '#0a7ef0'

      const barHeight = value * centerY * 0.9
      ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight * 2)
    })

    // Draw trim handles
    const handleWidth = 8
    const trimStartX = (trimStartMs / totalDuration) * width
    const trimEndX = (trimEndMs / totalDuration) * width

    // Start handle
    ctx.fillStyle = '#00ff00'
    ctx.fillRect(trimStartX - handleWidth / 2, 0, handleWidth, height)

    // End handle
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(trimEndX - handleWidth / 2, 0, handleWidth, height)

    // Draw drop marker
    if (dropTimeMs > 0) {
      const dropX = (dropTimeMs / totalDuration) * width
      ctx.strokeStyle = '#ffff00'
      ctx.lineWidth = 3
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(dropX, 0)
      ctx.lineTo(dropX, height)
      ctx.stroke()
      ctx.setLineDash([])

      // Draw drop label
      ctx.fillStyle = '#ffff00'
      ctx.font = 'bold 14px Arial'
      ctx.fillText('DROP', dropX + 6, 20)
    }

    // Draw playhead
    const playheadX = (currentTimeMs / totalDuration) * width
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, height)
    ctx.stroke()
  }

  // Update waveform on state changes
  useEffect(() => {
    drawWaveform()
  }, [trimStartMs, trimEndMs, dropTimeMs, currentTimeMs, duration])

  // Audio playback time update
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => {
      setCurrentTimeMs(audio.currentTime * 1000)
    }

    const handleEnded = () => {
      setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('ended', handleEnded)
    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [])

  const getTimeFromX = (x: number): number => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    return (x / canvas.width) * duration * 1000
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const clickedTimeMs = getTimeFromX(x)

    const handleWidth = 8
    const totalDuration = duration * 1000
    const trimStartX = (trimStartMs / totalDuration) * canvas.width
    const trimEndX = (trimEndMs / totalDuration) * canvas.width

    // Check if clicking on handles
    if (Math.abs(x - trimStartX) < handleWidth) {
      setDragging('start')
      return
    }
    if (Math.abs(x - trimEndX) < handleWidth) {
      setDragging('end')
      return
    }

    // Shift+click to set drop point
    if (e.shiftKey) {
      setDropTimeMs(Math.round(clickedTimeMs))
    } else {
      // Regular click to seek
      setCurrentTimeMs(clickedTimeMs)
      if (audioRef.current) {
        audioRef.current.currentTime = clickedTimeMs / 1000
      }
    }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, canvas.width))
    const timeMs = getTimeFromX(x)

    if (dragging === 'start') {
      setTrimStartMs(Math.max(0, Math.min(timeMs, trimEndMs - 100)))
    } else if (dragging === 'end') {
      setTrimEndMs(Math.min(duration * 1000, Math.max(timeMs, trimStartMs + 100)))
    }
  }, [dragging, trimStartMs, trimEndMs, duration])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }

  const handleSave = () => {
    onSave({
      ...audio,
      waveformData: waveformDataRef.current,
      dropTimeMs: dropTimeMs > 0 ? dropTimeMs : undefined,
      trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
      trimEndMs: trimEndMs < duration * 1000 ? trimEndMs : undefined
    })
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content audio-config-modal">
        {/* Header */}
        <h2 className="modal-title">Configure Audio: {audio.name}</h2>

        {/* Waveform */}
        <canvas
          ref={canvasRef}
          width={752}
          height={150}
          onMouseDown={handleCanvasMouseDown}
          className="audio-waveform-canvas"
        />

        {/* Instructions */}
        <div className="audio-instructions">
          <span>🖱️ Click to seek</span>
          <span>⇧ Shift+Click to set DROP</span>
          <span>🟢 Drag green handle to trim start</span>
          <span>🔴 Drag red handle to trim end</span>
        </div>

        {/* Controls */}
        <div className="audio-controls">
          <button onClick={togglePlayback} className="btn">
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <div className="audio-time">
            <span>{formatTime(currentTimeMs)}</span>
            <span className="time-separator">/</span>
            <span>{formatTime(duration * 1000)}</span>
          </div>
        </div>

        {/* Metadata display */}
        <div className="audio-metadata">
          {trimStartMs > 0 && (
            <div className="metadata-item">
              <span className="metadata-label">Trim Start:</span>
              <span className="metadata-value">{formatTime(trimStartMs)}</span>
            </div>
          )}
          {trimEndMs < duration * 1000 && (
            <div className="metadata-item">
              <span className="metadata-label">Trim End:</span>
              <span className="metadata-value">{formatTime(trimEndMs)}</span>
            </div>
          )}
          {dropTimeMs > 0 && (
            <div className="metadata-item metadata-drop">
              <span className="metadata-label">🎯 Drop Point:</span>
              <span className="metadata-value">{formatTime(dropTimeMs)}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions">
          <button onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary">
            Save
          </button>
        </div>

        {/* Hidden audio element for playback */}
        <audio ref={audioRef} src={`file://${audio.path}`} />
      </div>
    </div>
  )
}

function formatTime(ms: number): string {
  if (isNaN(ms)) return '0:00.0'
  const totalSec = ms / 1000
  const mins = Math.floor(totalSec / 60)
  const secs = Math.floor(totalSec % 60)
  const millis = Math.floor((totalSec % 1) * 10)
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis}`
}

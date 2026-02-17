import React, { useCallback, useEffect, useRef, useState } from 'react'
import { VideoSegment } from '../types'

interface Props {
  segment: VideoSegment
  onApply: (patch: Partial<VideoSegment>) => void
  onClose: () => void
}

function formatSec(us: number): string {
  const s = us / 1e6
  const m = Math.floor(s / 60)
  const rem = (s - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${rem}`
}

const MIN_DUR_US = 100_000 // 0.1s minimum

export function ClipTrimModal({ segment, onApply, onClose }: Props): JSX.Element {
  const [sourceStartUs, setSourceStartUs] = useState(segment.sourceStartUs)
  const [sourceDurationUs, setSourceDurationUs] = useState(segment.sourceDurationUs)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    type: 'slip' | 'trim-left' | 'trim-right'
    startX: number
    startSourceStartUs: number
    startSourceDurationUs: number
  } | null>(null)

  const fileDurUs = segment.fileDurationUs || Math.max(sourceDurationUs, 1)

  // Fetch preview frame with debounce
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchPreview = useCallback((atUs: number) => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(async () => {
      try {
        const b64 = await (window.api as any).getVideoFrame(segment.src, atUs / 1e6)
        setPreviewSrc(b64)
      } catch { /* ignore */ }
    }, 120)
  }, [segment.src])

  useEffect(() => {
    fetchPreview(sourceStartUs)
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current) }
  }, [sourceStartUs, fetchPreview])

  // ── Drag handlers ───────────────────────────────────────────────────────────
  function handleBarMouseDown(e: React.MouseEvent, type: 'slip' | 'trim-left' | 'trim-right'): void {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      type, startX: e.clientX,
      startSourceStartUs: sourceStartUs,
      startSourceDurationUs: sourceDurationUs,
    }
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent): void {
      const d = dragRef.current
      if (!d || !barRef.current) return
      const barW = barRef.current.getBoundingClientRect().width
      const scale = fileDurUs / barW
      const deltaPx = e.clientX - d.startX
      const deltaUs = deltaPx * scale

      if (d.type === 'slip') {
        const clamped = Math.max(0, Math.min(d.startSourceStartUs + deltaUs, fileDurUs - d.startSourceDurationUs))
        setSourceStartUs(Math.round(clamped))
      } else if (d.type === 'trim-left') {
        const newStart = Math.max(0, Math.min(d.startSourceStartUs + deltaUs, d.startSourceStartUs + d.startSourceDurationUs - MIN_DUR_US))
        const newDur = d.startSourceDurationUs - (newStart - d.startSourceStartUs)
        setSourceStartUs(Math.round(newStart))
        setSourceDurationUs(Math.round(newDur))
      } else if (d.type === 'trim-right') {
        const newDur = Math.max(MIN_DUR_US, Math.min(d.startSourceDurationUs + deltaUs, fileDurUs - d.startSourceStartUs))
        setSourceDurationUs(Math.round(newDur))
      }
    }

    function onMouseUp(): void {
      dragRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [fileDurUs])

  function handleApply(): void {
    const newDurUs = sourceDurationUs
    onApply({ sourceStartUs, sourceDurationUs, durationUs: newDurUs })
    onClose()
  }

  // Bar geometry
  const leftPct = (sourceStartUs / fileDurUs) * 100
  const widthPct = (sourceDurationUs / fileDurUs) * 100

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#1c1c1c', border: '1px solid #333',
        borderRadius: 10, width: 580,
        color: '#ddd', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Trim: {segment.name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Preview frame */}
          <div style={{
            width: '100%', aspectRatio: '9/5',
            background: '#111', borderRadius: 6, overflow: 'hidden',
            marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {previewSrc
              ? <img src={previewSrc} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ color: '#444', fontSize: 13 }}>Loading preview...</span>
            }
          </div>

          {/* Source duration label */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: '#555' }}>
            <span>0:00.00</span>
            <span style={{ color: '#888' }}>Source: {formatSec(fileDurUs)}</span>
            <span>{formatSec(fileDurUs)}</span>
          </div>

          {/* Scrubber bar */}
          <div
            ref={barRef}
            style={{
              position: 'relative', height: 36,
              background: '#111', borderRadius: 4, overflow: 'visible',
              cursor: 'default', userSelect: 'none',
            }}
          >
            {/* Unused regions */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'repeating-linear-gradient(45deg,#1a1a1a,#1a1a1a 4px,#141414 4px,#141414 8px)',
              borderRadius: 4,
            }} />

            {/* Selected window */}
            <div
              style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${leftPct}%`, width: `${widthPct}%`,
                background: '#2a5ecc', borderRadius: 4,
                cursor: 'grab', zIndex: 2,
              }}
              onMouseDown={(e) => handleBarMouseDown(e, 'slip')}
            >
              {/* Left trim handle */}
              <div
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 10,
                  background: '#4a7eff', borderRadius: '4px 0 0 4px',
                  cursor: 'ew-resize', zIndex: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseDown={(e) => handleBarMouseDown(e, 'trim-left')}
              >
                <div style={{ width: 2, height: 14, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
              </div>

              {/* Window label */}
              <div style={{
                position: 'absolute', inset: '0 10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: 'rgba(255,255,255,0.7)', pointerEvents: 'none',
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {formatSec(sourceDurationUs)}
              </div>

              {/* Right trim handle */}
              <div
                style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0, width: 10,
                  background: '#4a7eff', borderRadius: '0 4px 4px 0',
                  cursor: 'ew-resize', zIndex: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseDown={(e) => handleBarMouseDown(e, 'trim-right')}
              >
                <div style={{ width: 2, height: 14, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
              </div>
            </div>
          </div>

          {/* Time stamps */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12 }}>
            <div style={{ color: '#aaa' }}>
              <span style={{ color: '#555', marginRight: 4 }}>In</span>
              {formatSec(sourceStartUs)}
            </div>
            <div style={{ color: '#aaa' }}>
              <span style={{ color: '#555', marginRight: 4 }}>Out</span>
              {formatSec(sourceStartUs + sourceDurationUs)}
            </div>
            <div style={{ color: '#aaa' }}>
              <span style={{ color: '#555', marginRight: 4 }}>Dur</span>
              {formatSec(sourceDurationUs)}
            </div>
          </div>

          {/* Note if duration changed */}
          {sourceDurationUs !== segment.sourceDurationUs && (
            <p style={{ color: '#f5c518', fontSize: 11, marginTop: 10, textAlign: 'center' }}>
              Timeline duration will update to {formatSec(sourceDurationUs)}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #2a2a2a', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid #444', color: '#888', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            style={{ background: '#2a5ecc', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 18px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

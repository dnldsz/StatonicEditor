import React, { RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Project, Segment, TextSegment, VideoSegment } from '../types'

interface CanvasProps {
  project: Project
  currentTimeSec: number
  selectedId: string | null
  croppingId: string | null
  videoRef: RefObject<HTMLVideoElement>
  onSelectSegment: (id: string | null) => void
  onUpdateSegment: (id: string, patch: Partial<Segment>) => void
  onSetCropping: (id: string | null) => void
}

const SNAP_THRESHOLD = 0.04
const HANDLE_SIZE = 10
const CROP_HANDLE_SIZE = 10

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const handleStyle = (dir: HandleDir): React.CSSProperties => {
  const h = HANDLE_SIZE
  const half = -h / 2
  const base: React.CSSProperties = {
    position: 'absolute', width: h, height: h,
    background: '#fff', border: '2px solid #0a7ef0',
    borderRadius: 2, zIndex: 10, boxSizing: 'border-box'
  }
  switch (dir) {
    case 'nw': return { ...base, top: half, left: half, cursor: 'nw-resize' }
    case 'n':  return { ...base, top: half, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' }
    case 'ne': return { ...base, top: half, right: half, cursor: 'ne-resize' }
    case 'e':  return { ...base, top: '50%', right: half, transform: 'translateY(-50%)', cursor: 'e-resize' }
    case 'se': return { ...base, bottom: half, right: half, cursor: 'se-resize' }
    case 's':  return { ...base, bottom: half, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' }
    case 'sw': return { ...base, bottom: half, left: half, cursor: 'sw-resize' }
    case 'w':  return { ...base, top: '50%', left: half, transform: 'translateY(-50%)', cursor: 'w-resize' }
  }
}

// ── drag state ─────────────────────────────────────────────────────────────

type ScaleDragState = {
  id: string; kind: 'text' | 'video'; dir: HandleDir
  canvasLeft: number; canvasTop: number
  centerX: number; centerY: number
  startDist: number; origScale: number
}

type MoveDragState = {
  id: string; startX: number; startY: number; origX: number; origY: number
  kind: 'text' | 'video'
}

// 8-direction crop handle: corners adjust two edges, edges adjust one
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type CropDragState = {
  id: string; handle: CropHandle
  startX: number; startY: number
  origLeft: number; origRight: number; origTop: number; origBottom: number
  elWidth: number; elHeight: number
}

export default function Canvas({
  project, currentTimeSec, selectedId, croppingId, videoRef,
  onSelectSegment, onUpdateSegment, onSetCropping
}: CanvasProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const moveDragRef = useRef<MoveDragState | null>(null)
  const scaleDragRef = useRef<ScaleDragState | null>(null)
  const cropDragRef = useRef<CropDragState | null>(null)
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 })

  const { canvas } = project
  const aspect = canvas.width / canvas.height

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0) setPreviewSize({ w: width, h: height })
    })
    observer.observe(el)
    const r = el.getBoundingClientRect()
    if (r.width > 0) setPreviewSize({ w: r.width, h: r.height })
    return () => observer.disconnect()
  }, [])

  const previewScale = previewSize.w > 0 ? previewSize.w / canvas.width : 1
  const previewH = previewSize.h > 0 ? previewSize.h : previewSize.w / aspect

  // ── find segments at current time ─────────────────────────────────────────

  let activeVideoSeg: VideoSegment | null = null
  const visibleTexts: Array<{ seg: TextSegment; z: number }> = []

  for (let ti = 0; ti < project.tracks.length; ti++) {
    const track = project.tracks[ti]
    const z = ti + 1  // higher index = higher z-layer
    for (const seg of track.segments) {
      const start = seg.startUs / 1e6
      const end = (seg.startUs + seg.durationUs) / 1e6
      if (currentTimeSec < start || currentTimeSec >= end) continue
      if (seg.type === 'video') activeVideoSeg = seg as VideoSegment
      else if (seg.type === 'text') visibleTexts.push({ seg: seg as TextSegment, z })
    }
  }

  const clipX = activeVideoSeg?.clipX ?? 0
  const clipY = activeVideoSeg?.clipY ?? 0
  const clipScale = activeVideoSeg?.clipScale ?? 1
  const srcW = activeVideoSeg?.sourceWidth ?? canvas.width
  const srcH = activeVideoSeg?.sourceHeight ?? canvas.height

  // Crop values
  const cl = activeVideoSeg?.cropLeft ?? 0
  const cr = activeVideoSeg?.cropRight ?? 0
  const ct = activeVideoSeg?.cropTop ?? 0
  const cb = activeVideoSeg?.cropBottom ?? 0
  const cropW = Math.max(0.01, 1 - cl - cr)
  const cropH = Math.max(0.01, 1 - ct - cb)

  const vidDisplayH = clipScale * (previewH || previewSize.w / aspect)
  const vidDisplayW = (srcW / srcH) * vidDisplayH
  const vidLeft = ((clipX + 1) / 2) * previewSize.w
  const vidTop = ((1 - clipY) / 2) * (previewH || previewSize.w / aspect)

  const isVideoSelected = activeVideoSeg !== null && activeVideoSeg.id === selectedId
  const isCropping = croppingId !== null && activeVideoSeg !== null && croppingId === activeVideoSeg.id

  // When in crop mode: show full frame with overlay. Otherwise: apply crop transform.
  const applyCropTransform = !isCropping

  const getRect = useCallback(() => wrapperRef.current?.getBoundingClientRect() ?? null, [])

  // ── move drag ──────────────────────────────────────────────────────────────

  const startMoveDrag = useCallback((
    e: React.MouseEvent, id: string, kind: 'text' | 'video',
    origX: number, origY: number
  ) => {
    e.stopPropagation()
    onSelectSegment(id)
    moveDragRef.current = { id, startX: e.clientX, startY: e.clientY, origX, origY, kind }

    const onMove = (me: MouseEvent) => {
      const drag = moveDragRef.current
      if (!drag) return
      const rect = getRect()
      if (!rect) return
      const dx = (me.clientX - drag.startX) / rect.width * 2
      const dy = (me.clientY - drag.startY) / rect.height * 2
      let newX = drag.origX + dx
      let newY = drag.origY - dy
      if (drag.kind === 'text') {
        newX = Math.max(-1, Math.min(1, newX))
        newY = Math.max(-1, Math.min(1, newY))
        const snapX = Math.abs(newX) < SNAP_THRESHOLD
        const snapY = Math.abs(newY) < SNAP_THRESHOLD
        if (snapX) newX = 0
        if (snapY) newY = 0
        setSnapGuide({ x: snapX, y: snapY })
        onUpdateSegment(id, { x: newX, y: newY } as Partial<TextSegment>)
      } else {
        onUpdateSegment(id, { clipX: newX, clipY: newY } as Partial<VideoSegment>)
      }
    }
    const onUp = () => {
      moveDragRef.current = null
      setSnapGuide({ x: false, y: false })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [getRect, onSelectSegment, onUpdateSegment])

  // ── scale drag ─────────────────────────────────────────────────────────────

  const startScaleDrag = useCallback((
    e: React.MouseEvent, seg: TextSegment | VideoSegment, dir: HandleDir
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = wrapperRef.current!.getBoundingClientRect()
    const elEl = (e.currentTarget as HTMLElement).parentElement!
    const elRect = elEl.getBoundingClientRect()
    const centerX = (elRect.left + elRect.right) / 2 - rect.left
    const centerY = (elRect.top + elRect.bottom) / 2 - rect.top
    const startOffX = e.clientX - rect.left - centerX
    const startOffY = e.clientY - rect.top - centerY
    const startDist = Math.sqrt(startOffX ** 2 + startOffY ** 2)
    const origScale = seg.type === 'text'
      ? (seg as TextSegment).textScale ?? 1
      : (seg as VideoSegment).clipScale ?? 1

    scaleDragRef.current = {
      id: seg.id, kind: seg.type === 'text' ? 'text' : 'video', dir,
      canvasLeft: rect.left, canvasTop: rect.top,
      centerX, centerY, startDist: Math.max(startDist, 1), origScale
    }
    const onMove = (me: MouseEvent) => {
      const drag = scaleDragRef.current
      if (!drag) return
      const curDist = Math.sqrt(
        (me.clientX - drag.canvasLeft - drag.centerX) ** 2 +
        (me.clientY - drag.canvasTop - drag.centerY) ** 2
      )
      const ratio = curDist / drag.startDist
      if (drag.kind === 'text') {
        onUpdateSegment(drag.id, { textScale: Math.max(0.1, drag.origScale * ratio) } as Partial<TextSegment>)
      } else {
        onUpdateSegment(drag.id, { clipScale: Math.max(0.05, drag.origScale * ratio) } as Partial<VideoSegment>)
      }
    }
    const onUp = () => {
      scaleDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onUpdateSegment])

  // ── crop drag ──────────────────────────────────────────────────────────────

  const startCropDrag = (e: React.MouseEvent, handle: CropHandle) => {
    e.stopPropagation()
    e.preventDefault()
    if (!activeVideoSeg) return
    // The handle's parent is the outer video container div
    const el = (e.currentTarget as HTMLElement).closest('[data-crop-container]') as HTMLElement
      || (e.currentTarget as HTMLElement).parentElement!
    const rect = el.getBoundingClientRect()
    cropDragRef.current = {
      id: activeVideoSeg.id, handle,
      startX: e.clientX, startY: e.clientY,
      origLeft: cl, origRight: cr, origTop: ct, origBottom: cb,
      elWidth: rect.width, elHeight: rect.height
    }
    const onMove = (me: MouseEvent) => {
      const drag = cropDragRef.current
      if (!drag) return
      const dx = (me.clientX - drag.startX) / drag.elWidth
      const dy = (me.clientY - drag.startY) / drag.elHeight
      const clampL = (v: number) => Math.max(0, Math.min(1 - drag.origRight - 0.05, v))
      const clampR = (v: number) => Math.max(0, Math.min(1 - drag.origLeft - 0.05, v))
      const clampT = (v: number) => Math.max(0, Math.min(1 - drag.origBottom - 0.05, v))
      const clampB = (v: number) => Math.max(0, Math.min(1 - drag.origTop - 0.05, v))
      const patch: Partial<VideoSegment> = {}
      const h = drag.handle
      if (h === 'nw' || h === 'w' || h === 'sw') patch.cropLeft   = clampL(drag.origLeft + dx)
      if (h === 'ne' || h === 'e' || h === 'se') patch.cropRight  = clampR(drag.origRight - dx)
      if (h === 'nw' || h === 'n' || h === 'ne') patch.cropTop    = clampT(drag.origTop + dy)
      if (h === 'sw' || h === 's' || h === 'se') patch.cropBottom = clampB(drag.origBottom - dy)
      onUpdateSegment(drag.id, patch)
    }
    const onUp = () => {
      cropDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Crop handle positions relative to the full video frame (used in crop mode)
  const cropHandlePositions: Array<{ handle: CropHandle; left: string; top: string; cursor: string }> = [
    { handle: 'nw', left: `${cl * 100}%`,            top: `${ct * 100}%`,            cursor: 'nw-resize' },
    { handle: 'n',  left: `${(cl + cropW / 2) * 100}%`, top: `${ct * 100}%`,         cursor: 'n-resize' },
    { handle: 'ne', left: `${(1 - cr) * 100}%`,      top: `${ct * 100}%`,            cursor: 'ne-resize' },
    { handle: 'e',  left: `${(1 - cr) * 100}%`,      top: `${(ct + cropH / 2) * 100}%`, cursor: 'e-resize' },
    { handle: 'se', left: `${(1 - cr) * 100}%`,      top: `${(1 - cb) * 100}%`,      cursor: 'se-resize' },
    { handle: 's',  left: `${(cl + cropW / 2) * 100}%`, top: `${(1 - cb) * 100}%`,  cursor: 's-resize' },
    { handle: 'sw', left: `${cl * 100}%`,            top: `${(1 - cb) * 100}%`,      cursor: 'sw-resize' },
    { handle: 'w',  left: `${cl * 100}%`,            top: `${(ct + cropH / 2) * 100}%`, cursor: 'w-resize' },
  ]

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="canvas-wrapper"
      ref={wrapperRef}
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        maxHeight: '100%',
        maxWidth: `calc(100% * ${aspect})`,
        width: 'auto', height: '100%',
        position: 'relative', overflow: 'hidden', background: '#000'
      }}
      onClick={(e) => {
        if (e.target === wrapperRef.current) {
          onSelectSegment(null)
          if (croppingId) onSetCropping(null)
        }
      }}
    >
      {/* ── Video clip ─────────────────────────────────────────────────────── */}
      <div
        data-crop-container="1"
        style={{
          position: 'absolute',
          width: vidDisplayW,
          height: vidDisplayH,
          left: vidLeft,
          top: vidTop,
          transform: 'translate(-50%, -50%)',
          zIndex: 1,
          overflow: 'hidden',
          outline: isVideoSelected && !isCropping ? '2px solid #0a7ef0' : 'none',
          cursor: activeVideoSeg ? (isCropping ? 'default' : 'move') : 'default',
          boxSizing: 'border-box',
          visibility: activeVideoSeg ? 'visible' : 'hidden'
        }}
        onMouseDown={activeVideoSeg && !isCropping ? (e) =>
          startMoveDrag(e, activeVideoSeg!.id, 'video', clipX, clipY) : undefined}
        onClick={(e) => { e.stopPropagation(); if (activeVideoSeg) onSelectSegment(activeVideoSeg.id) }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (activeVideoSeg) onSetCropping(isCropping ? null : activeVideoSeg.id)
        }}
      >
        {/* Inner video wrapper — zoomed in to show crop result (when not in crop mode) */}
        <div style={{
          position: 'absolute',
          left: applyCropTransform ? `${-(cl / cropW) * 100}%` : '0%',
          top:  applyCropTransform ? `${-(ct / cropH) * 100}%` : '0%',
          width:  applyCropTransform ? `${100 / cropW}%` : '100%',
          height: applyCropTransform ? `${100 / cropH}%` : '100%',
        }}>
          <video
            ref={videoRef}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
            playsInline
            preload="auto"
          />
        </div>

        {/* ── Crop mode overlay ─────────────────────────────────────────── */}
        {isCropping && activeVideoSeg && (
          <>
            {/* Dark masks outside the crop rectangle */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: `${cl * 100}%`, height: '100%', background: 'rgba(0,0,0,0.65)', pointerEvents: 'none', zIndex: 15 }} />
            <div style={{ position: 'absolute', top: 0, right: 0, width: `${cr * 100}%`, height: '100%', background: 'rgba(0,0,0,0.65)', pointerEvents: 'none', zIndex: 15 }} />
            <div style={{ position: 'absolute', top: 0, left: `${cl * 100}%`, right: `${cr * 100}%`, height: `${ct * 100}%`, background: 'rgba(0,0,0,0.65)', pointerEvents: 'none', zIndex: 15 }} />
            <div style={{ position: 'absolute', bottom: 0, left: `${cl * 100}%`, right: `${cr * 100}%`, height: `${cb * 100}%`, background: 'rgba(0,0,0,0.65)', pointerEvents: 'none', zIndex: 15 }} />

            {/* Crop rectangle border */}
            <div style={{
              position: 'absolute',
              left: `${cl * 100}%`, right: `${cr * 100}%`,
              top: `${ct * 100}%`, bottom: `${cb * 100}%`,
              border: '1px solid rgba(255,255,255,0.8)',
              pointerEvents: 'none', zIndex: 16
            }} />

            {/* Traditional rectangular crop handles */}
            {cropHandlePositions.map(({ handle, left, top, cursor }) => (
              <div
                key={handle}
                style={{
                  position: 'absolute',
                  left, top,
                  width: CROP_HANDLE_SIZE, height: CROP_HANDLE_SIZE,
                  transform: 'translate(-50%, -50%)',
                  background: '#fff',
                  border: '1.5px solid rgba(0,0,0,0.4)',
                  borderRadius: 2,
                  cursor,
                  zIndex: 20,
                  boxSizing: 'border-box',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
                }}
                onMouseDown={(e) => startCropDrag(e, handle)}
              />
            ))}

            {/* Hint */}
            <div style={{
              position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11,
              padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
              pointerEvents: 'none', zIndex: 25
            }}>
              Double-click or Esc to exit crop
            </div>
          </>
        )}

        {/* Scale handles (selected, not cropping) */}
        {isVideoSelected && !isCropping && HANDLES.map((dir) => (
          <div
            key={dir}
            style={handleStyle(dir)}
            onMouseDown={(e) => startScaleDrag(e, activeVideoSeg!, dir)}
          />
        ))}
      </div>

      {/* ── Snap guides ───────────────────────────────────────────────────── */}
      {snapGuide.x && (
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#ff3b30', opacity: 0.8, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 30 }} />
      )}
      {snapGuide.y && (
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#ff3b30', opacity: 0.8, transform: 'translateY(-50%)', pointerEvents: 'none', zIndex: 30 }} />
      )}

      {!activeVideoSeg && visibleTexts.length === 0 && (
        <div className="canvas-overlay-placeholder">Add a video clip to get started</div>
      )}

      {/* ── Text overlays ─────────────────────────────────────────────────── */}
      {visibleTexts.map(({ seg, z }) => {
        const leftPct = ((seg.x + 1) / 2) * 100
        const topPct = ((1 - seg.y) / 2) * 100
        const isSelected = selectedId === seg.id
        const alignTransform =
          seg.textAlign === 'left' ? 'translate(0, -50%)' :
          seg.textAlign === 'right' ? 'translate(-100%, -50%)' :
          'translate(-50%, -50%)'
        return (
          <div
            key={seg.id}
            style={{ position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`, transform: alignTransform, zIndex: isSelected ? 100 : z }}
          >
            <div
              className={`text-overlay${isSelected ? ' selected' : ''}`}
              style={{
                position: 'relative', display: 'inline-block',
                fontSize: seg.fontSize * (seg.textScale ?? 1) * previewScale,
                color: seg.color,
                fontWeight: seg.bold ? 700 : 400,
                fontStyle: seg.italic ? 'italic' : 'normal',
                fontFamily: "'TikTokText', -apple-system, sans-serif",
                WebkitTextStroke: (seg.strokeEnabled ?? false)
                  ? `${seg.fontSize * (seg.textScale ?? 1) * (6.9 / 97.0) * 2 * previewScale}px ${seg.strokeColor}`
                  : undefined,
                cursor: 'move', userSelect: 'none', whiteSpace: 'pre',
                textAlign: seg.textAlign ?? 'center', lineHeight: 1.0, padding: '2px 4px'
              }}
              onMouseDown={(e) => startMoveDrag(e, seg.id, 'text', seg.x, seg.y)}
              onClick={(e) => { e.stopPropagation(); onSelectSegment(seg.id) }}
            >
              {seg.text}
              {isSelected && HANDLES.map((dir) => (
                <div key={dir} style={handleStyle(dir)} onMouseDown={(e) => startScaleDrag(e, seg, dir)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

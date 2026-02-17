import React, { useEffect, useRef } from 'react'

interface MenuItem {
  label: string
  icon?: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function SegmentContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleDown, true)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleDown, true)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Keep menu on screen
  const menuW = 160
  const menuH = items.length * 34 + 8
  const left = x + menuW > window.innerWidth ? x - menuW : x
  const top = y + menuH > window.innerHeight ? y - menuH : y

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left, top,
        background: '#242424', border: '1px solid #383838',
        borderRadius: 7, padding: '4px 0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        zIndex: 3000, minWidth: menuW,
        userSelect: 'none',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          style={{
            padding: '7px 14px',
            fontSize: 13,
            color: item.danger ? '#e05252' : '#ddd',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 9,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#333' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {item.icon && <span style={{ fontSize: 15, opacity: 0.8 }}>{item.icon}</span>}
          {item.label}
        </div>
      ))}
    </div>
  )
}

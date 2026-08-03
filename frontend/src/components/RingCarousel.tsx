import { useEffect, useRef, useState } from 'react'

export type RingItem = {
  key: string
  title: string
  subtitle?: string
  posterUrl: string
  uploading?: boolean
}

type Props = {
  items: RingItem[]
  onSelect: (key: string) => void
  emptyMessage?: string
  hint?: string
}

function angleDiff(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

export function RingCarousel({ items, onSelect, emptyMessage = '还没有内容。', hint = '继续滚动浏览' }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  const [rotation, setRotation] = useState(0)

  const count = items.length
  const scrollLengthVh = Math.min(220 + count * 14, 520)

  useEffect(() => {
    const section = sectionRef.current
    if (!section || count === 0) return

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const rect = section.getBoundingClientRect()
        const total = rect.height - window.innerHeight
        const scrolled = -rect.top
        const progress = total > 0 ? Math.min(Math.max(scrolled / total, 0), 1) : 0
        setRotation(progress * 360)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [count])

  if (count === 0) {
    return (
      <div className="ring-empty">
        <p>{emptyMessage}</p>
      </div>
    )
  }

  const step = 360 / count

  return (
    <div ref={sectionRef} className="ring-section" style={{ height: `${scrollLengthVh}vh` }}>
      <div className="ring-sticky">
        <div className="ring-perspective">
          <div className="ring" style={{ transform: `rotateY(${-rotation}deg)` }}>
            {items.map((item, i) => {
              const angle = step * i
              const diff = angleDiff(angle, rotation)
              const active = Math.abs(diff) < step / 2 + 1
              const opacity = Math.max(0.22, 1 - Math.abs(diff) / 130)
              const clickable = Math.abs(diff) < 60

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`ring-card${active ? ' ring-card-active' : ''}`}
                  style={{
                    transform: `translate(-50%, -50%) rotateY(${angle}deg) translateZ(var(--ring-radius))`,
                    opacity,
                    pointerEvents: clickable ? 'auto' : 'none',
                  }}
                  onClick={() => onSelect(item.key)}
                  tabIndex={clickable ? 0 : -1}
                >
                  <span className="ring-card-poster">
                    <img src={item.posterUrl} crossOrigin="use-credentials" alt={item.title} loading="lazy" />
                    {item.uploading && <span className="ring-card-uploading">上传中</span>}
                  </span>
                  <span className="ring-card-meta">
                    <span className="ring-card-title">{item.title}</span>
                    {item.subtitle && <span className="ring-card-sub">{item.subtitle}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <p className="ring-hint">{hint}</p>
      </div>
    </div>
  )
}

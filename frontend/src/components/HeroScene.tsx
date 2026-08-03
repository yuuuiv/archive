import { useEffect, useRef, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** 用于企划场景等重复出现的场次标题，比全站首屏 hero 矮一些 */
  compact?: boolean
}

export function HeroScene({ children, compact = false }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner) return

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const rect = wrapper.getBoundingClientRect()
        const total = rect.height - window.innerHeight
        const progress = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0
        inner.style.opacity = String(1 - progress)
        inner.style.transform = `scale(${1 - progress * 0.1}) translateY(${progress * 24}px)`
        inner.style.pointerEvents = progress > 0.9 ? 'none' : 'auto'
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={wrapperRef} className={`hero-wrapper${compact ? ' hero-wrapper-compact' : ''}`}>
      <div ref={innerRef} className={`hero-scene${compact ? ' hero-scene-compact' : ''}`}>
        {children}
      </div>
    </div>
  )
}

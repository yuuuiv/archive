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
}

export function RingCarousel({ items, onSelect, emptyMessage = '还没有内容。' }: Props) {
  if (items.length === 0) {
    return (
      <div className="ring-empty">
        <p>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="ring-grid">
      {items.map((item) => (
        <button key={item.key} type="button" className="ring-card" onClick={() => onSelect(item.key)}>
          <span className="ring-card-poster">
            <img src={item.posterUrl} crossOrigin="use-credentials" alt={item.title} loading="lazy" />
            {item.uploading && <span className="ring-card-uploading">上传中</span>}
          </span>
          <span className="ring-card-meta">
            <span className="ring-card-title">{item.title}</span>
            {item.subtitle && <span className="ring-card-sub">{item.subtitle}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { FranchiseGroup } from '../api'
import { watchProgress } from '../api'
import { CloseIcon, ChevronDownIcon, SearchIcon } from './icons'

type Props = {
  open: boolean
  onClose: () => void
  franchises: FranchiseGroup[]
}

/** 企划名、场次名、文件名任意一层命中都保留该分支；命中的那一层以下全部保留，
 *  不然搜"愛知"却只剩一个空的场次壳子，反而更难找。 */
function filterTree(franchises: FranchiseGroup[], query: string): FranchiseGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return franchises
  const hit = (s: string) => s.toLowerCase().includes(q)

  return franchises
    .map((franchise) => {
      if (hit(franchise.name)) return franchise
      const lives = franchise.lives
        .map((live) => {
          if (hit(live.name)) return live
          const files = live.files.filter((f) => hit(f.title))
          return files.length ? { ...live, files } : null
        })
        .filter((l) => l !== null)
      return lives.length ? { ...franchise, lives } : null
    })
    .filter((f) => f !== null)
}

export function Sidebar({ open, onClose, franchises }: Props) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTree(franchises, query), [franchises, query])
  const searching = query.trim().length > 0

  return (
    <>
      <div
        className={`sidebar-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="目录">
        <div className="sidebar-header">
          <span>目录</span>
          <button type="button" className="sidebar-close" onClick={onClose} aria-label="关闭目录">
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="sidebar-search">
          <SearchIcon width={15} height={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索企划 / 场次 / 文件"
            aria-label="搜索"
          />
        </div>
        <nav className="sidebar-nav">
          {franchises.length === 0 && <p className="sidebar-empty">还没有内容</p>}
          {franchises.length > 0 && filtered.length === 0 && (
            <p className="sidebar-empty">没有匹配「{query.trim()}」的内容</p>
          )}
          {filtered.map((franchise) => (
            <details key={franchise.slug} className="sidebar-group" open>
              <summary>
                <ChevronDownIcon className="sidebar-chevron" width={14} height={14} />
                {franchise.name}
              </summary>
              {franchise.lives.map((live) => (
                // 搜索状态下全部展开，否则命中的文件还藏在折叠里等于没搜
                <details
                  key={live.slug}
                  className="sidebar-group sidebar-group-nested"
                  open={searching}
                >
                  <summary>
                    <ChevronDownIcon className="sidebar-chevron" width={12} height={12} />
                    {live.name}
                  </summary>
                  <ul className="sidebar-file-list">
                    {live.files.map((file) => {
                      const progress = watchProgress(file)
                      return (
                        <li key={file.slug}>
                          <Link to={`/v/${file.slug}`} onClick={onClose}>
                            {file.title}
                            {progress.done && <span className="sidebar-seen">已看完</span>}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              ))}
            </details>
          ))}
        </nav>
      </aside>
    </>
  )
}

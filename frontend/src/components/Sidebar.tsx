import { Link } from 'react-router'
import type { FranchiseGroup } from '../api'
import { CloseIcon, ChevronDownIcon } from './icons'

type Props = {
  open: boolean
  onClose: () => void
  franchises: FranchiseGroup[]
}

export function Sidebar({ open, onClose, franchises }: Props) {
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
        <nav className="sidebar-nav">
          {franchises.length === 0 && <p className="sidebar-empty">还没有内容</p>}
          {franchises.map((franchise) => (
            <details key={franchise.slug} className="sidebar-group" open>
              <summary>
                <ChevronDownIcon className="sidebar-chevron" width={14} height={14} />
                {franchise.name}
              </summary>
              {franchise.lives.map((live) => (
                <details key={live.slug} className="sidebar-group sidebar-group-nested">
                  <summary>
                    <ChevronDownIcon className="sidebar-chevron" width={12} height={12} />
                    {live.name}
                  </summary>
                  <ul className="sidebar-file-list">
                    {live.files.map((file) => (
                      <li key={file.slug}>
                        <Link to={`/v/${file.slug}`} onClick={onClose}>
                          {file.title}
                        </Link>
                      </li>
                    ))}
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

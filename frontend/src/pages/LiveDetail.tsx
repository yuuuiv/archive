import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  fetchNav,
  formatDuration,
  isVideoComplete,
  usePageTitle,
  watchProgress,
  type FranchiseGroup,
} from '../api'
import { TopBar } from '../components/TopBar'
import { Sidebar } from '../components/Sidebar'
import { StaggeredText } from '../components/StaggeredText'

export function LiveDetail() {
  const { franchiseSlug, liveSlug, fileSlug } = useParams()
  const navigate = useNavigate()
  const [franchises, setFranchises] = useState<FranchiseGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const fileRefs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    fetchNav()
      .then((r) => setFranchises(r.franchises))
      .catch((e) => setError((e as Error).message))
  }, [])

  const franchise = franchises?.find((f) => f.slug === franchiseSlug)
  const live = franchise?.lives.find((l) => l.slug === liveSlug)
  usePageTitle(live ? `${live.name} · ${franchise?.name ?? ''}` : '')

  useEffect(() => {
    if (!live) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const slug = visible?.target.getAttribute('data-slug')
        if (slug && slug !== fileSlug) {
          navigate(`/f/${franchiseSlug}/l/${liveSlug}/${slug}`, { replace: true })
        }
      },
      { threshold: 0.6 }
    )
    fileRefs.current.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  return (
    <div>
      <TopBar back={{ to: '/', label: franchise?.name ?? '首页' }} onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} franchises={franchises ?? []} />
      {error ? (
        <div className="state-message is-error">加载失败：{error}</div>
      ) : !franchises ? (
        <div className="state-message">加载中...</div>
      ) : !franchise || !live ? (
        <div className="state-message is-error">没有找到这个场次。</div>
      ) : (
        <div className="live-detail">
          <h1 className="live-detail-title">
            <StaggeredText text={live.name} />
          </h1>
          <div className="live-file-slides">
            {live.files.map((file) => {
              const progress = watchProgress(file)
              return (
              <Link
                key={file.slug}
                to={`/v/${file.slug}`}
                data-slug={file.slug}
                ref={(el) => {
                  if (el) fileRefs.current.set(file.slug, el)
                  else fileRefs.current.delete(file.slug)
                }}
                className="live-file-slide"
              >
                <span className="live-file-poster">
                  <img src={file.poster_url} crossOrigin="use-credentials" alt={file.title} loading="lazy" />
                  {!isVideoComplete(file) && <span className="ring-card-uploading">上传中</span>}
                  {progress.started && (
                    <span className="card-progress" aria-hidden="true">
                      <span
                        className={progress.done ? 'is-complete' : ''}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </span>
                  )}
                </span>
                <span className="live-file-meta">
                  <span className="live-file-title">{file.title}</span>
                  <span className="live-file-sub">
                    {file.date} · {formatDuration(file.duration_seconds)}
                    {progress.started &&
                      (progress.done
                        ? ' · 已看完'
                        : ` · 看到 ${formatDuration(file.progress_seconds)}`)}
                  </span>
                </span>
              </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

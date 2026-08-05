import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatDuration, usePageTitle, UnauthorizedError } from '../api'
import { TopBar } from '../components/TopBar'
import { ChartIcon, ClockIcon, FilmIcon, PlayIcon } from '../components/icons'

type MyVideo = {
  slug: string
  title: string
  date: string | null
  views: number
  watch_seconds: number
  max_position: number
  duration_seconds: number
  last_viewed_at: number
}

type MyPlayback = {
  total_views: number
  watched_videos: number
  total_watch_seconds: number
  last_viewed_at: number
  completed_videos: number
  completion_threshold: number
  videos: MyVideo[]
}

function formatUnix(seconds: number): string {
  if (!seconds) return '—'
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function MyStats() {
  const [data, setData] = useState<MyPlayback | null>(null)
  const [unauthed, setUnauthed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  usePageTitle('我的观看数据')

  async function clearHistory() {
    if (!confirm('清除后无法恢复，全部观看记录和进度都会消失。确定？')) return
    setClearing(true)
    try {
      const res = await fetch('/api/me/playback', { method: 'DELETE' })
      if (!res.ok) throw new Error(`清除失败 (${res.status})`)
      setData({
        total_views: 0,
        watched_videos: 0,
        total_watch_seconds: 0,
        last_viewed_at: 0,
        completed_videos: 0,
        completion_threshold: data?.completion_threshold ?? 0.9,
        videos: [],
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    fetch('/api/me/playback')
      .then((res) => {
        if (res.status === 401) throw new UnauthorizedError()
        if (!res.ok) throw new Error(`加载失败 (${res.status})`)
        return res.json()
      })
      .then(setData)
      .catch((e) => {
        if (e instanceof UnauthorizedError) {
          setUnauthed(true)
          return
        }
        setError((e as Error).message)
      })
  }, [])

  if (unauthed) {
    return (
      <div>
        <TopBar back={{ to: '/', label: '首页' }} />
        <div className="state-message state-message-login">
          <p>登录后查看你的观看数据</p>
          <a href="/api/login" className="btn-primary">
            登录
          </a>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <TopBar back={{ to: '/', label: '首页' }} />
        <div className="state-message is-error">{error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <TopBar back={{ to: '/', label: '首页' }} />
        <div className="admin-gate">
          <div className="admin-spinner" />
        </div>
      </div>
    )
  }

  const thresholdPct = Math.round(data.completion_threshold * 100)
  // 有进度但没看完的排在前面，方便直接接着看
  const inProgress = data.videos.filter(
    (v) => v.duration_seconds > 0 && v.max_position < v.duration_seconds * data.completion_threshold
  )

  return (
    <div>
      <TopBar back={{ to: '/', label: '首页' }} />
      <div className="mystats-page">
        <header className="admin-page-head">
          <h1>我的观看数据</h1>
          {/* 原来写的是"只有你自己能看到" —— 这话不成立：观众标识是邮箱哈希，
              站点管理员手上有全部邮箱，对上号就能还原任何人的记录。别在界面上
              许一个做不到的承诺，改成说实话，同时给一个真的能按的清除按钮。 */}
          <p className="admin-page-sub">
            其他观众看不到这些数字 · 观看时长只统计真正在播放的时间 · 站点管理员能看到
          </p>
        </header>
        <div className="mystats-actions">
          <button
            type="button"
            className="mystats-danger"
            onClick={clearHistory}
            disabled={clearing || !data.total_views}
          >
            {clearing ? '清除中…' : '清除我的观看记录'}
          </button>
          <a href="/api/logout" className="mystats-quiet">
            退出登录
          </a>
        </div>

        {data.total_views === 0 ? (
          <section className="admin-section">
            <p className="admin-empty">
              还没有观看记录。去首页挑一个视频看看，这里就会记录你的进度。
            </p>
          </section>
        ) : (
          <>
            <section className="admin-section">
              <h2>概览</h2>
              <div className="admin-stat-grid">
                {[
                  { label: '看过的视频', value: String(data.watched_videos), hint: `共播放 ${data.total_views} 次`, hue: 210, Icon: FilmIcon },
                  { label: '总观看时长', value: formatDuration(data.total_watch_seconds), hint: `约 ${(data.total_watch_seconds / 3600).toFixed(1)} 小时`, hue: 35, Icon: ClockIcon },
                  { label: '看完的视频', value: String(data.completed_videos), hint: `看到 ${thresholdPct}% 即算看完`, hue: 150, Icon: ChartIcon },
                  { label: '最近观看', value: formatUnix(data.last_viewed_at).slice(5), hint: formatUnix(data.last_viewed_at).slice(0, 4) + ' 年', hue: 265, Icon: PlayIcon },
                ].map((c, i) => (
                  <div
                    key={c.label}
                    className="admin-stat-card"
                    style={{ '--i': i, '--tile-hue': c.hue } as React.CSSProperties}
                  >
                    <span className="admin-stat-tile">
                      <c.Icon width={19} height={19} />
                    </span>
                    <div className="admin-stat-body">
                      <div className="admin-stat-value">{c.value}</div>
                      <div className="admin-stat-label">{c.label}</div>
                      <div className="admin-stat-hint">{c.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {inProgress.length > 0 && (
              <section className="admin-section" style={{ '--i': 1 } as React.CSSProperties}>
                <h2>
                  继续观看
                  <span className="admin-section-tag">还没看完的 {inProgress.length} 个</span>
                </h2>
                <div className="mystats-resume">
                  {inProgress.slice(0, 6).map((v) => {
                    const pct = (v.max_position / v.duration_seconds) * 100
                    return (
                      <Link
                        key={v.slug}
                        to={`/v/${v.slug}?t=${Math.floor(v.max_position)}`}
                        className="mystats-resume-card"
                      >
                        <div className="mystats-resume-title">{v.title}</div>
                        <div className="admin-mini-track">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mystats-resume-meta">
                          <span>{pct.toFixed(0)}%</span>
                          <span>
                            {formatDuration(v.max_position)} / {formatDuration(v.duration_seconds)}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="admin-section" style={{ '--i': 2 } as React.CSSProperties}>
              <h2>
                全部记录
                <span className="admin-section-tag">按最近观看排序</span>
              </h2>
              <div className="table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>视频</th>
                      <th>播放次数</th>
                      <th>观看时长</th>
                      <th>我的进度</th>
                      <th>最近观看</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((v) => {
                      const pct = v.duration_seconds
                        ? Math.min(100, (v.max_position / v.duration_seconds) * 100)
                        : 0
                      const done = pct >= thresholdPct
                      return (
                        <tr key={v.slug}>
                          <td className="admin-table-title">
                            <Link to={`/v/${v.slug}`} className="mystats-link">
                              {v.title}
                            </Link>
                          </td>
                          <td className="admin-table-num">{v.views}</td>
                          <td className="admin-table-num">{formatDuration(v.watch_seconds)}</td>
                          <td>
                            <div className="admin-cell-progress">
                              <span className="admin-mini-track">
                                <span
                                  className={done ? 'is-complete' : ''}
                                  style={{ width: `${pct}%` }}
                                />
                              </span>
                              <span className="admin-table-dim">
                                {done ? '已看完' : `${pct.toFixed(0)}%`}
                              </span>
                            </div>
                          </td>
                          <td className="admin-table-dim">{formatUnix(v.last_viewed_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

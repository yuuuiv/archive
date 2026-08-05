import { useCallback, useEffect, useState } from 'react'
import { formatDuration, isVideoComplete, type FranchiseGroup } from '../api'
import { TopBar } from '../components/TopBar'
import {
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  FilmIcon,
  LayersIcon,
  LogoutIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  UsersIcon,
} from '../components/icons'

const STORAGE_KEY = 'archive_admin_auth'
const PAGE_SIZE = 20

type ContentStats = {
  franchises: number
  lives: number
  videos: number
  total_duration_seconds: number
  total_segments: number
  uploaded_segments: number
  incomplete_videos: number
  custom_live_posters: number
  earliest_date: string
  latest_date: string
}

type UserStats = {
  email_users: number
  oauth_users: number
  total_users: number
  active_users: number
  active_users_7d: number
  new_users_7d: number
  new_users_30d: number
  by_login_type: { login_type: string; count: number }[]
}

type TopVideo = {
  slug: string
  title: string
  views: number
  unique_viewers: number
  watch_seconds: number
  avg_progress: number
  completed_views: number
  rated_views: number
  last_viewed_at: number
}

type PlaybackStats = {
  total_views: number
  unique_viewers: number
  total_watch_seconds: number
  watched_videos: number
  views_7d: number
  watch_seconds_7d: number
  rated_views: number
  completed_views: number
  avg_progress: number
  completion_threshold: number
  top_videos: TopVideo[]
}

type AdminData = {
  content: ContentStats | null
  videos: FranchiseGroup[]
  playback: PlaybackStats | null
  users: UserStats | null
}

type UserRow = {
  user_email: string
  user_name: string | null
  login_type: string
  created_at: string | null
  updated_at: string | null
}

type Tab = 'overview' | 'playback' | 'content' | 'users'

const TABS: { key: Tab; label: string; Icon: typeof ChartIcon }[] = [
  { key: 'overview', label: '总览', Icon: ChartIcon },
  { key: 'playback', label: '播放数据', Icon: PlayIcon },
  { key: 'content', label: '内容', Icon: FilmIcon },
  { key: 'users', label: '账号', Icon: UsersIcon },
]

async function postAdmin<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) throw new Error('密码不对')
  if (!res.ok) throw new Error(`请求失败 (${res.status})`)
  return res.json()
}

/** 后端两张表的时间戳格式不统一（sqlite 空格分隔 / supabase ISO），统一按本地时间显示到分钟 */
function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const d = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Admin() {
  const [password, setPassword] = useState('')
  const [data, setData] = useState<AdminData | null>(null)
  const [authed, setAuthed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      setChecking(false)
      return
    }
    postAdmin<AdminData>('/api/admin/stats', { password: saved })
      .then((r) => {
        setData(r)
        setAuthed(saved)
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setChecking(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await postAdmin<AdminData>('/api/admin/stats', { password })
      localStorage.setItem(STORAGE_KEY, password)
      setData(result)
      setAuthed(password)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    if (!authed || refreshing) return
    setRefreshing(true)
    try {
      setData(await postAdmin<AdminData>('/api/admin/stats', { password: authed }))
    } catch {
      /* 刷新失败保留上一次数据，不清空视图 */
    } finally {
      setRefreshing(false)
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
    setData(null)
    setAuthed(null)
    setPassword('')
    setTab('overview')
  }

  if (checking) {
    return (
      <div>
        <TopBar back={{ to: '/', label: '首页' }} />
        <div className="admin-gate">
          <div className="admin-spinner" />
        </div>
      </div>
    )
  }

  if (!data || !authed) {
    return (
      <div>
        <TopBar back={{ to: '/', label: '首页' }} />
        <div className="admin-gate">
          <form className="admin-gate-form" onSubmit={submit}>
            <div className="admin-gate-icon">
              <SettingsGlyph />
            </div>
            <h1>管理员面板</h1>
            <p className="admin-gate-hint">输入密码进入控制台</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={loading || !password}>
              {loading ? '验证中…' : '进入'}
            </button>
            {error && <p className="admin-gate-error">{error}</p>}
          </form>
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar back={{ to: '/', label: '首页' }} />
      <div className="admin-shell">
        <nav className="admin-sidebar">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`admin-navitem${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              <span className="admin-navicon">
                <Icon width={16} height={16} />
              </span>
              <span>{label}</span>
            </button>
          ))}
          <div className="admin-sidebar-foot">
            <button
              type="button"
              className="admin-navitem admin-navitem-quiet"
              onClick={refresh}
              disabled={refreshing}
            >
              <span className="admin-navicon">
                <RefreshIcon width={16} height={16} className={refreshing ? 'is-spinning' : ''} />
              </span>
              <span>{refreshing ? '刷新中…' : '刷新数据'}</span>
            </button>
            <button type="button" className="admin-navitem admin-navitem-danger" onClick={logout}>
              <span className="admin-navicon">
                <LogoutIcon width={16} height={16} />
              </span>
              <span>退出登录</span>
            </button>
          </div>
        </nav>
        <main className="admin-main" key={tab}>
          {tab === 'overview' && <Overview data={data} />}
          {tab === 'playback' && <PlaybackPanel playback={data.playback} />}
          {tab === 'content' && <ContentDetail franchises={data.videos} />}
          {tab === 'users' && <UsersPanel password={authed} stats={data.users} />}
        </main>
      </div>
    </div>
  )
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" width={26} height={26}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

type StatCard = {
  label: string
  value: string
  hint?: string
  hue: number
  Icon: typeof ChartIcon
}

function StatGrid({ cards }: { cards: StatCard[] }) {
  return (
    <div className="admin-stat-grid">
      {cards.map((c, i) => (
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
            {c.hint && <div className="admin-stat-hint">{c.hint}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

const LOGIN_TYPE_LABELS: Record<string, string> = {
  email: '邮箱',
  github: 'GitHub',
  google: 'Google',
  ms: 'Microsoft',
  web3: 'Web3',
  unknown: '未知',
}

function Overview({ data }: { data: AdminData }) {
  const c = data.content
  const u = data.users
  const uploadPct = c && c.total_segments ? (c.uploaded_segments / c.total_segments) * 100 : 0

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <h1>总览</h1>
        <p className="admin-page-sub">存档内容与账号的整体情况</p>
      </header>

      <section className="admin-section">
        <h2>内容规模</h2>
        {c ? (
          <>
            <StatGrid
              cards={[
                { label: '企划', value: String(c.franchises), hue: 210, Icon: LayersIcon },
                { label: '场次', value: String(c.lives), hue: 265, Icon: CalendarIcon },
                { label: '视频文件', value: String(c.videos), hint: c.incomplete_videos ? `${c.incomplete_videos} 个上传中` : '全部已完成', hue: 150, Icon: FilmIcon },
                { label: '总时长', value: formatDuration(c.total_duration_seconds), hint: `约 ${(c.total_duration_seconds / 3600).toFixed(1)} 小时`, hue: 35, Icon: ClockIcon },
              ]}
            />
            <div className="admin-progress-block">
              <div className="admin-progress-head">
                <span>分段上传进度</span>
                <span className="admin-progress-num">
                  {c.uploaded_segments.toLocaleString()} / {c.total_segments.toLocaleString()}
                </span>
              </div>
              <div className="admin-progress-track">
                <div className="admin-progress-fill" style={{ width: `${uploadPct}%` }} />
              </div>
              <div className="admin-progress-foot">
                <span>{uploadPct.toFixed(1)}%</span>
                <span>{(c.total_segments - c.uploaded_segments).toLocaleString()} 段待传</span>
              </div>
            </div>
            <dl className="admin-kv">
              <div><dt>最早场次日期</dt><dd>{c.earliest_date || '—'}</dd></div>
              <div><dt>最新场次日期</dt><dd>{c.latest_date || '—'}</dd></div>
              <div><dt>自定义场次封面</dt><dd>{c.custom_live_posters} 张</dd></div>
            </dl>
          </>
        ) : (
          <p className="admin-stat-error">加载失败</p>
        )}
      </section>

      <section className="admin-section">
        <h2>播放数据</h2>
        {data.playback && data.playback.total_views > 0 ? (
          <StatGrid
            cards={[
              { label: '总播放次数', value: data.playback.total_views.toLocaleString(), hint: `近 7 天 ${data.playback.views_7d}`, hue: 210, Icon: PlayIcon },
              { label: '总观看时长', value: formatDuration(data.playback.total_watch_seconds), hint: `近 7 天 ${formatDuration(data.playback.watch_seconds_7d)}`, hue: 35, Icon: ClockIcon },
              { label: '独立观看人数', value: String(data.playback.unique_viewers), hint: `覆盖 ${data.playback.watched_videos} 个视频`, hue: 265, Icon: UsersIcon },
              {
                label: '完播率',
                value: data.playback.rated_views
                  ? `${((data.playback.completed_views / data.playback.rated_views) * 100).toFixed(1)}%`
                  : '—',
                hint: `看完 ${Math.round(data.playback.completion_threshold * 100)}% 即算完播`,
                hue: 150,
                Icon: ChartIcon,
              },
            ]}
          />
        ) : (
          <p className="admin-empty">还没有播放记录。埋点已上线，有人看过之后这里就会有数据。</p>
        )}
      </section>

      <section className="admin-section">
        <h2>账号（auth 网关）</h2>
        {u ? (
          <>
            <StatGrid
              cards={[
                { label: '注册总数', value: String(u.total_users), hint: '按邮箱去重', hue: 210, Icon: UsersIcon },
                { label: `近 30 天活跃`, value: String(u.active_users), hint: `近 7 天 ${u.active_users_7d ?? 0}`, hue: 150, Icon: ChartIcon },
                { label: '近 7 天新增', value: String(u.new_users_7d ?? 0), hint: `近 30 天 ${u.new_users_30d ?? 0}`, hue: 35, Icon: CalendarIcon },
                { label: '邮箱 / OAuth', value: `${u.email_users} / ${u.oauth_users}`, hint: '登录记录数，可重叠', hue: 265, Icon: LayersIcon },
              ]}
            />
            {u.by_login_type?.length > 0 && (
              <div className="admin-breakdown">
                <div className="admin-breakdown-title">登录方式分布</div>
                <ul className="admin-breakdown-list">
                  {u.by_login_type.map((row) => {
                    const pct = u.total_users ? (row.count / u.total_users) * 100 : 0
                    return (
                      <li key={row.login_type}>
                        <span className="admin-breakdown-name">
                          {LOGIN_TYPE_LABELS[row.login_type] ?? row.login_type}
                        </span>
                        <span className="admin-breakdown-bar">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="admin-breakdown-count">{row.count}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="admin-stat-error">加载失败（auth 网关没返回数据）</p>
        )}
      </section>
    </div>
  )
}

function PlaybackPanel({ playback }: { playback: PlaybackStats | null }) {
  if (!playback) {
    return (
      <div className="admin-page">
        <header className="admin-page-head">
          <h1>播放数据</h1>
        </header>
        <section className="admin-section">
          <p className="admin-stat-error">加载失败</p>
        </section>
      </div>
    )
  }

  const thresholdPct = Math.round(playback.completion_threshold * 100)
  const completionRate = playback.rated_views
    ? (playback.completed_views / playback.rated_views) * 100
    : 0
  const maxViews = playback.top_videos[0]?.views ?? 0

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <h1>播放数据</h1>
        <p className="admin-page-sub">
          一次播放会话记一次；观看时长只累计真正在播放的时间，暂停与拖动不计入
        </p>
      </header>

      {playback.total_views === 0 ? (
        <section className="admin-section">
          <p className="admin-empty">
            还没有播放记录。埋点已经上线，有人打开视频看过之后这里就会出现数据。
          </p>
        </section>
      ) : (
        <>
          <section className="admin-section">
            <h2>整体</h2>
            <StatGrid
              cards={[
                { label: '总播放次数', value: playback.total_views.toLocaleString(), hint: `近 7 天 ${playback.views_7d}`, hue: 210, Icon: PlayIcon },
                { label: '总观看时长', value: formatDuration(playback.total_watch_seconds), hint: `近 7 天 ${formatDuration(playback.watch_seconds_7d)}`, hue: 35, Icon: ClockIcon },
                { label: '独立观看人数', value: String(playback.unique_viewers), hint: `覆盖 ${playback.watched_videos} 个视频`, hue: 265, Icon: UsersIcon },
                { label: '平均观看进度', value: `${(playback.avg_progress * 100).toFixed(1)}%`, hint: '各次会话到达的最远位置均值', hue: 150, Icon: ChartIcon },
              ]}
            />
            <div className="admin-progress-block">
              <div className="admin-progress-head">
                <span>完播率</span>
                <span className="admin-progress-num">
                  {playback.completed_views} / {playback.rated_views} 次会话
                </span>
              </div>
              <div className="admin-progress-track">
                <div className="admin-progress-fill" style={{ width: `${completionRate}%` }} />
              </div>
              <div className="admin-progress-foot">
                <span>{completionRate.toFixed(1)}%</span>
                <span>看到 {thresholdPct}% 以上算完播</span>
              </div>
            </div>
          </section>

          <section className="admin-section" style={{ '--i': 1 } as React.CSSProperties}>
            <h2>
              热门视频
              <span className="admin-section-tag">按播放次数排序，最多 20 条</span>
            </h2>
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>视频</th>
                    <th>播放次数</th>
                    <th>观看人数</th>
                    <th>观看时长</th>
                    <th>平均进度</th>
                    <th>完播</th>
                    <th>最近观看</th>
                  </tr>
                </thead>
                <tbody>
                  {playback.top_videos.map((v) => (
                    <tr key={v.slug}>
                      <td className="admin-table-title">{v.title}</td>
                      <td>
                        <div className="admin-cell-progress">
                          <span className="admin-mini-track">
                            <span style={{ width: `${maxViews ? (v.views / maxViews) * 100 : 0}%` }} />
                          </span>
                          <span className="admin-table-num">{v.views}</span>
                        </div>
                      </td>
                      <td className="admin-table-num">{v.unique_viewers}</td>
                      <td className="admin-table-num">{formatDuration(v.watch_seconds)}</td>
                      <td className="admin-table-num">{(v.avg_progress * 100).toFixed(1)}%</td>
                      <td>
                        <span className="admin-chip">
                          {v.rated_views ? `${v.completed_views}/${v.rated_views}` : '—'}
                        </span>
                      </td>
                      <td className="admin-table-dim">{formatUnix(v.last_viewed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function formatUnix(seconds: number): string {
  if (!seconds) return '—'
  const d = new Date(seconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ContentDetail({ franchises }: { franchises: FranchiseGroup[] }) {
  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <h1>内容</h1>
        <p className="admin-page-sub">按企划 → 场次 → 文件展开，含每个文件的上传进度</p>
      </header>
      {franchises.length === 0 && <p className="admin-stat-error">还没有内容</p>}
      {franchises.map((franchise, fi) => (
        <section key={franchise.slug} className="admin-section" style={{ '--i': fi } as React.CSSProperties}>
          <h2>
            {franchise.name}
            <span className="admin-section-tag">
              {franchise.lives.length} 场次 ·{' '}
              {franchise.lives.reduce((n, l) => n + l.files.length, 0)} 文件
            </span>
          </h2>
          {franchise.lives.map((live) => {
            const totalDuration = live.files.reduce((n, f) => n + f.duration_seconds, 0)
            return (
              <div key={live.slug} className="admin-live-group">
                <div className="admin-live-head">
                  <h3 className="admin-live-title">{live.name}</h3>
                  <span className="admin-live-meta">{formatDuration(totalDuration)}</span>
                </div>
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>文件</th>
                        <th>日期</th>
                        <th>时长</th>
                        <th>分段进度</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {live.files.map((file) => {
                        const complete = isVideoComplete(file)
                        const pct = file.segment_count
                          ? Math.min(100, (file.uploaded_segments / file.segment_count) * 100)
                          : 0
                        return (
                          <tr key={file.slug}>
                            <td className="admin-table-title">{file.title}</td>
                            <td className="admin-table-dim">{file.date ?? '—'}</td>
                            <td className="admin-table-num">{formatDuration(file.duration_seconds)}</td>
                            <td>
                              <div className="admin-cell-progress">
                                <span className="admin-mini-track">
                                  <span
                                    className={complete ? 'is-complete' : ''}
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                <span className="admin-table-dim">
                                  {file.uploaded_segments.toLocaleString()} /{' '}
                                  {file.segment_count.toLocaleString()}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`admin-status-badge${complete ? ' is-complete' : ' is-uploading'}`}
                              >
                                {complete ? '已完成' : `${pct.toFixed(1)}%`}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function UsersPanel({ password, stats }: { password: string; stats: UserStats | null }) {
  const [rows, setRows] = useState<UserRow[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await postAdmin<{ results: UserRow[]; count: number }>('/api/admin/users', {
        password,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        query: submittedQuery,
      })
      setRows(res.results ?? [])
      setCount(res.count ?? 0)
    } catch (e) {
      setError((e as Error).message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [password, page, submittedQuery])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <h1>账号</h1>
        {/* count 是登录记录条数，total_users 是去重邮箱数——同一邮箱绑多种登录方式时两者不等，分开写清楚 */}
        <p className="admin-page-sub">
          auth 网关下的全部账号（该部署全局，不区分应用）
          {count > 0 && ` · ${count} 条登录记录`}
          {stats ? `，${stats.total_users} 个独立邮箱` : ''}
        </p>
      </header>

      <section className="admin-section">
        <form
          className="admin-searchbar"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setSubmittedQuery(query.trim())
          }}
        >
          <SearchIcon width={16} height={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索邮箱或用户名"
          />
          {submittedQuery && (
            <button
              type="button"
              className="admin-search-clear"
              onClick={() => {
                setQuery('')
                setSubmittedQuery('')
                setPage(1)
              }}
            >
              清除
            </button>
          )}
        </form>

        {error ? (
          <p className="admin-stat-error">{error}</p>
        ) : loading ? (
          <div className="admin-loading-row">
            <div className="admin-spinner" />
          </div>
        ) : rows.length === 0 ? (
          <p className="admin-empty">没有匹配的账号</p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>用户名</th>
                  <th>登录方式</th>
                  <th>注册时间</th>
                  <th>最后活跃</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.login_type}:${r.user_email}`}>
                    <td className="admin-table-title">{r.user_email}</td>
                    <td className="admin-table-dim">{r.user_name || '—'}</td>
                    <td>
                      <span className="admin-chip">
                        {LOGIN_TYPE_LABELS[r.login_type] ?? r.login_type}
                      </span>
                    </td>
                    <td className="admin-table-dim">{formatTimestamp(r.created_at)}</td>
                    <td className="admin-table-dim">{formatTimestamp(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="admin-pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

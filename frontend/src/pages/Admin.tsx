import { useState } from 'react'
import { formatDuration } from '../api'
import { TopBar } from '../components/TopBar'

type ContentStats = {
  franchises: number
  lives: number
  videos: number
  total_duration_seconds: number
  total_segments: number
}

type UserStats = {
  email_users: number
  oauth_users: number
  total_users: number
  active_users: number
}

type AdminStats = {
  content: ContentStats | null
  users: UserStats | null
}

export function Admin() {
  const [password, setPassword] = useState('')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.status === 401) {
        setError('密码不对')
        return
      }
      if (!res.ok) {
        setError(`请求失败 (${res.status})`)
        return
      }
      setStats(await res.json())
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <TopBar back={{ to: '/', label: '首页' }} />
      {!stats ? (
        <div className="admin-gate">
          <form className="admin-gate-form" onSubmit={submit}>
            <h1>管理员面板</h1>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={loading || !password}>
              {loading ? '验证中...' : '进入'}
            </button>
            {error && <p className="admin-gate-error">{error}</p>}
          </form>
        </div>
      ) : (
        <div className="admin-page">
          <h1>管理员面板</h1>
          <section className="admin-section">
            <h2>本站内容</h2>
            {stats.content ? (
              <ul className="admin-stat-list">
                <li><span>企划</span><span>{stats.content.franchises}</span></li>
                <li><span>场次</span><span>{stats.content.lives}</span></li>
                <li><span>视频</span><span>{stats.content.videos}</span></li>
                <li><span>总时长</span><span>{formatDuration(stats.content.total_duration_seconds)}</span></li>
                <li><span>总分段数</span><span>{stats.content.total_segments}</span></li>
              </ul>
            ) : (
              <p className="admin-stat-error">加载失败</p>
            )}
          </section>
          <section className="admin-section">
            <h2>账号（auth 网关）</h2>
            {stats.users ? (
              <ul className="admin-stat-list">
                <li><span>注册总数</span><span>{stats.users.total_users}</span></li>
                <li><span>邮箱账号</span><span>{stats.users.email_users}</span></li>
                <li><span>OAuth 账号</span><span>{stats.users.oauth_users}</span></li>
                <li><span>近 30 天活跃</span><span>{stats.users.active_users}</span></li>
              </ul>
            ) : (
              <p className="admin-stat-error">加载失败（auth 网关没返回数据）</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

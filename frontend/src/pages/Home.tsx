import { useEffect, useState } from 'react'
import { fetchNav, UnauthorizedError, type FranchiseGroup } from '../api'
import { TopBar } from '../components/TopBar'
import { Sidebar } from '../components/Sidebar'
import { HeroScene } from '../components/HeroScene'
import { FranchiseScene } from '../components/FranchiseScene'
import { StaggeredText } from '../components/StaggeredText'

type AuthState = 'checking' | 'unauthed' | 'authed'

export function Home() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [franchises, setFranchises] = useState<FranchiseGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    fetchNav()
      .then((r) => {
        setFranchises(r.franchises)
        setAuthState('authed')
      })
      .catch((e) => {
        if (e instanceof UnauthorizedError) {
          setAuthState('unauthed')
          return
        }
        setError((e as Error).message)
      })
  }, [])

  return (
    <div>
      <TopBar onMenuClick={authState === 'authed' ? () => setSidebarOpen(true) : undefined} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} franchises={franchises ?? []} />
      <HeroScene>
        <img src="/icon.png" alt="" className="hero-logo" />
        <h1 className="hero-title">
          <StaggeredText text="archive-collection" />
        </h1>
        {authState === 'unauthed' ? (
          <>
            <p className="hero-subtitle">登录后浏览存档</p>
            <a href="/api/login" className="btn-primary hero-login-btn">
              登录
            </a>
          </>
        ) : (
          <p className="hero-subtitle">往期回放存档，向下滚动浏览</p>
        )}
      </HeroScene>

      {error ? (
        <div className="state-message is-error">加载失败：{error}</div>
      ) : authState === 'authed' && franchises ? (
        franchises.length === 0 ? (
          <div className="state-message">还没有视频。</div>
        ) : (
          franchises.map((franchise) => <FranchiseScene key={franchise.slug} franchise={franchise} />)
        )
      ) : null}
    </div>
  )
}

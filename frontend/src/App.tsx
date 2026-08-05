import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { LiveDetail } from './pages/LiveDetail'
import { NotFound } from './pages/NotFound'

// 播放页把 Artplayer + hls.js 拖进包里，占了首屏 JS 的一大半，但只逛列表的人
// 一行都用不上。管理面板和个人数据页同理，都是少数人偶尔打开。
const VideoPlayer = lazy(() => import('./pages/VideoPlayer').then((m) => ({ default: m.VideoPlayer })))
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })))
const MyStats = lazy(() => import('./pages/MyStats').then((m) => ({ default: m.MyStats })))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading"><div className="admin-spinner" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/f/:franchiseSlug/l/:liveSlug/:fileSlug?" element={<LiveDetail />} />
          <Route path="/v/:slug" element={<VideoPlayer />} />
          <Route path="/me" element={<MyStats />} />
          <Route path="/admin" element={<Admin />} />
          {/* 静态资源配的是 SPA 兜底，任何打错的地址都会返回 index.html。
              没有这条的话 Routes 一个都匹配不上，渲染出来是纯白页。 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

import { BrowserRouter, Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { LiveDetail } from './pages/LiveDetail'
import { VideoPlayer } from './pages/VideoPlayer'
import { Admin } from './pages/Admin'
import { MyStats } from './pages/MyStats'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/f/:franchiseSlug/l/:liveSlug/:fileSlug?" element={<LiveDetail />} />
        <Route path="/v/:slug" element={<VideoPlayer />} />
        <Route path="/me" element={<MyStats />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  )
}

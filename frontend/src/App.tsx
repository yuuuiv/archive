import { BrowserRouter, Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { LiveDetail } from './pages/LiveDetail'
import { VideoPlayer } from './pages/VideoPlayer'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/f/:franchiseSlug/l/:liveSlug/:fileSlug?" element={<LiveDetail />} />
        <Route path="/v/:slug" element={<VideoPlayer />} />
      </Routes>
    </BrowserRouter>
  )
}

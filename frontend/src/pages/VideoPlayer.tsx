import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { fetchVideo, formatDuration, isVideoComplete, UnauthorizedError, type VideoDetail } from '../api'
import { TopBar } from '../components/TopBar'
import { StaggeredText } from '../components/StaggeredText'

export function VideoPlayer() {
  const { slug } = useParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthed, setUnauthed] = useState(false)

  useEffect(() => {
    if (!slug) return
    fetchVideo(slug)
      .then(setVideo)
      .catch((e) => {
        if (e instanceof UnauthorizedError) {
          setUnauthed(true)
          return
        }
        setError((e as Error).message)
      })
  }, [slug])

  useEffect(() => {
    if (!video || !containerRef.current) return

    let hls: Hls | null = null

    const art = new Artplayer({
      container: containerRef.current,
      url: video.m3u8_url,
      poster: video.poster_url,
      type: 'm3u8',
      customType: {
        m3u8: (videoEl, url) => {
          hls = new Hls({
            // 上传中的视频播放列表是 EVENT 类型（没有 ENDLIST），hls.js 默认按直播处理会跳到最新位置，
            // 但这其实是点播内容只是清单还在长，强制从头开始播
            startPosition: 0,
            xhrSetup: (xhr) => {
              xhr.withCredentials = true
            },
          })
          hls.loadSource(url)
          hls.attachMedia(videoEl)
        },
      },
      moreVideoAttr: { crossOrigin: 'use-credentials' },
      volume: 0.8,
      autoplay: false,
      screenshot: true,
      setting: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      hotkey: true,
      theme: '#0a84ff',
      playsInline: true,
      gesture: true,
      lock: true,
      fastForward: true,
      autoOrientation: true,
      autoPlayback: true,
    })
    artRef.current = art

    return () => {
      hls?.destroy()
      art.destroy()
      artRef.current = null
    }
  }, [video])

  return (
    <div>
      <TopBar back={{ to: '/', label: '列表' }} />
      <div className="player-page">
        {error ? (
          <div className="state-message is-error">加载失败：{error}</div>
        ) : unauthed ? (
          <div className="state-message state-message-login">
            <p>登录后才能观看</p>
            <a href="/api/login" className="btn-primary">
              登录
            </a>
          </div>
        ) : !video ? (
          <div className="state-message">加载中...</div>
        ) : (
          <>
            <div className="player-card">
              <div ref={containerRef} className="player-video" />
            </div>
            <h1 className="player-title">
              <StaggeredText text={video.title} delayStep={0.015} />
            </h1>
            <p className="player-meta">
              {video.date} · {formatDuration(video.duration_seconds)}
              {!isVideoComplete(video) && (
                <span className="player-uploading">
                  {' '}
                  · 上传中 {video.uploaded_segments}/{video.segment_count} 段
                </span>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

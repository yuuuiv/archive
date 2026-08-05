import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import {
  fetchVideo,
  formatDuration,
  isVideoComplete,
  usePageTitle,
  UnauthorizedError,
  type VideoDetail,
} from '../api'
import { TopBar } from '../components/TopBar'
import { StaggeredText } from '../components/StaggeredText'

export function VideoPlayer() {
  const { slug } = useParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unauthed, setUnauthed] = useState(false)
  const [resumedFrom, setResumedFrom] = useState(0)
  usePageTitle(video?.title ?? '')

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

    // 续播位置：?t= 优先（"继续观看"卡片点进来的），否则用服务端记的这个人的进度。
    // 服务端那份是跨设备的——手机上看到一半，电脑打开接着播。
    // 快到片尾就别续了，不然点进来直接是片尾字幕；起点也夹在片长内，防手改 URL。
    const requested = Number(new URLSearchParams(window.location.search).get('t'))
    const fromServer =
      video.progress_seconds > 30 && video.progress_seconds < video.duration_seconds * 0.95
        ? video.progress_seconds
        : 0
    const resumeAt = Math.min(
      Math.max(0, Number.isFinite(requested) && requested > 0 ? requested : fromServer),
      Math.max(0, video.duration_seconds - 5)
    )
    setResumedFrom(resumeAt)

    const art = new Artplayer({
      container: containerRef.current,
      url: video.m3u8_url,
      poster: video.poster_url,
      type: 'm3u8',
      customType: {
        m3u8: (videoEl, url) => {
          hls = new Hls({
            // 上传中的视频播放列表是 EVENT 类型（没有 ENDLIST），hls.js 默认按直播处理会跳到最新位置，
            // 但这其实是点播内容只是清单还在长，强制从头开始播。
            // ?t= 是"继续观看"带过来的服务端进度，有就从那儿起播（跨设备也能接着看）。
            startPosition: resumeAt,
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

    // ---- 播放埋点 ----
    // 每秒采样一次：只在真正处于播放状态时累加观看秒数，暂停/缓冲/拖动都不计，
    // 所以"观看时长"是实际看进去的时间，不会被挂着页面刷出来。
    const sessionId = crypto.randomUUID()
    let watchedSeconds = 0
    let maxPosition = 0
    let pendingReport = false

    const sample = window.setInterval(() => {
      const el = art.video
      if (!el) return
      if (!el.paused && !el.ended && el.readyState >= 2) {
        watchedSeconds += 1
        pendingReport = true
      }
      maxPosition = Math.max(maxPosition, el.currentTime || 0)
    }, 1000)

    const report = () => {
      // 没真正播过就不上报，避免"点开就走"污染浏览次数
      if (!pendingReport) return
      pendingReport = false
      fetch('/api/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          slug: video.slug,
          watched_seconds: watchedSeconds,
          position: maxPosition,
          duration: video.duration_seconds,
        }),
        keepalive: true, // 页面卸载途中也能把最后一次心跳发出去
      }).catch(() => {})
    }

    const heartbeat = window.setInterval(report, 30000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') report()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', report)

    return () => {
      window.clearInterval(sample)
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', report)
      report()
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
            {resumedFrom > 0 && (
              <p className="player-resumed">
                已从 {formatDuration(resumedFrom)} 继续播放
                <button
                  type="button"
                  onClick={() => {
                    if (artRef.current) artRef.current.seek = 0
                    setResumedFrom(0)
                  }}
                >
                  从头播放
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

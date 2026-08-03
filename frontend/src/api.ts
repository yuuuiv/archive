export type FileSummary = {
  slug: string
  title: string
  date: string | null
  duration_seconds: number
  poster_url: string
  segment_count: number
  uploaded_segments: number
}

export function isVideoComplete(v: Pick<FileSummary, 'segment_count' | 'uploaded_segments'>): boolean {
  return v.uploaded_segments >= v.segment_count
}

export type LiveGroup = {
  slug: string
  name: string
  poster_url: string
  files: FileSummary[]
}

export type FranchiseGroup = {
  slug: string
  name: string
  lives: LiveGroup[]
}

export type VideoDetail = FileSummary & {
  m3u8_url: string
  franchise_slug: string | null
  franchise_name: string | null
  live_slug: string | null
  live_name: string | null
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
  }
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export function fetchNav(): Promise<{ franchises: FranchiseGroup[] }> {
  return apiFetch('/api/videos')
}

export function fetchVideo(slug: string): Promise<VideoDetail> {
  return apiFetch(`/api/videos/${slug}`)
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

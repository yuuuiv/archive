import { useNavigate } from 'react-router'
import type { FranchiseGroup } from '../api'
import { isVideoComplete, watchProgress } from '../api'
import { HeroScene } from './HeroScene'
import { RingCarousel } from './RingCarousel'
import { StaggeredText } from './StaggeredText'

export function FranchiseScene({ franchise }: { franchise: FranchiseGroup }) {
  const navigate = useNavigate()

  return (
    <section className="franchise-scene">
      <HeroScene compact>
        <h2 className="franchise-title">
          <StaggeredText text={franchise.name} />
        </h2>
        <p className="franchise-subtitle">
          {franchise.lives.length} 场 live · 向下滚动浏览
        </p>
      </HeroScene>
      <RingCarousel
        items={franchise.lives.map((live) => ({
          key: live.slug,
          title: live.name,
          subtitle: `${live.files.length} 个文件`,
          posterUrl: live.poster_url,
          uploading: live.files.some((f) => !isVideoComplete(f)),
          // 场次卡显示整场的平均进度：看完一半文件、另一半没动，就是 50%
          progressPercent:
            live.files.reduce((sum, f) => sum + watchProgress(f).percent, 0) / live.files.length,
        }))}
        onSelect={(liveSlug) => navigate(`/f/${franchise.slug}/l/${liveSlug}`)}
        emptyMessage="这个企划还没有场次。"
      />
    </section>
  )
}

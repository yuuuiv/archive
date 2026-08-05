import { Link } from 'react-router'
import { usePageTitle } from '../api'
import { TopBar } from '../components/TopBar'

export function NotFound() {
  usePageTitle('页面不存在')
  return (
    <div>
      <TopBar back={{ to: '/', label: '首页' }} />
      <div className="state-message state-message-login">
        <p>没有这个页面。地址可能打错了，或者内容已经不在了。</p>
        <Link to="/" className="btn-primary">
          回首页
        </Link>
      </div>
    </div>
  )
}

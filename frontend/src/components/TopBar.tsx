import { Link } from 'react-router'
import { useTheme } from '../theme/ThemeProvider'
import { ChevronLeftIcon, MenuIcon, MoonIcon, SunIcon, UserChartIcon } from './icons'

type Props = {
  back?: { to: string; label: string }
  onMenuClick?: () => void
}

export function TopBar({ back, onMenuClick }: Props) {
  const { theme, toggle } = useTheme()

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          {onMenuClick && (
            <button
              type="button"
              className="topbar-menu"
              onClick={onMenuClick}
              aria-label="打开目录"
            >
              <MenuIcon width={20} height={20} />
            </button>
          )}
          {back ? (
            <Link to={back.to} className="topbar-back">
              <ChevronLeftIcon className="topbar-back-icon" />
              <span>{back.label}</span>
            </Link>
          ) : (
            <Link to="/" className="topbar-brand">
              <img src="/icon.png" alt="" className="topbar-logo" />
              <span>archive-collection</span>
            </Link>
          )}
        </div>
        <div className="topbar-right">
          <Link to="/me" className="topbar-admin-entry" aria-label="我的观看数据">
            <UserChartIcon width={18} height={18} />
          </Link>
          {/* 管理面板入口不再挂在这里：对每个访客亮一个齿轮等于公告"这儿有后台"。
              /admin 直接输地址照样能进，密码那道门没变。 */}
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            <SunIcon className="theme-icon theme-icon-sun" />
            <MoonIcon className="theme-icon theme-icon-moon" />
          </button>
        </div>
      </div>
    </header>
  )
}

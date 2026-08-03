import { Link } from 'react-router'
import { useTheme } from '../theme/ThemeProvider'
import { ChevronLeftIcon, MenuIcon, MoonIcon, SunIcon } from './icons'

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
    </header>
  )
}

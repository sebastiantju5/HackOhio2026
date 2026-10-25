export default function TopBar({ view, onHome, onProfile }) {
  return (
    <div className="capsule-wrapper">
      <nav className="capsule-nav" aria-label="Primary">
        <span
          className="capsule-brand"
          onClick={onHome}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onHome?.()
            }
          }}
        >
          <span className="capsule-brand-mark">w.</span> WeatherWay
        </span>
        <div className="capsule-tabs">
          <button type="button" aria-current={view === 'planner' ? 'page' : undefined} onClick={onHome}>
            Home
          </button>
          <button type="button" aria-current={view === 'account' ? 'page' : undefined} onClick={onProfile}>
            Profile
          </button>
        </div>
      </nav>
    </div>
  )
}


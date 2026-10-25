export default function TopBar({ view, signedIn, onHome, onProfile, onSignOut }) {
  return (
    <div className="capsule-wrapper">
      <nav className="capsule-nav" aria-label="Primary">
        <div className="capsule-tabs">
          <button type="button" aria-current={view === 'planner' ? 'page' : undefined} onClick={onHome}>
            Home
          </button>
          <button type="button" aria-current={view === 'account' ? 'page' : undefined} onClick={onProfile}>
            Profile
          </button>
          <button type="button" className="capsule-signout" onClick={onSignOut} disabled={!signedIn}>
            Sign out
          </button>
        </div>
      </nav>
    </div>
  )
}

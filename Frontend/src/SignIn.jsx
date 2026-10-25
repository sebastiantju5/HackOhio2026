import { useState } from 'react'
import './SignIn.css'
import VehicleProfile from './VehicleProfile.jsx'

const DEMO = {
  email: 'alex@weatherway.app',
  password: 'neighborhood',
}

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  remember: true,
}

function validate(form, mode) {
  const errors = {}
  if (mode === 'signup' && form.name.trim().length < 2) {
    errors.name = 'Enter the name you want on your profile.'
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (form.password.length < 8) {
    errors.password = 'Use at least 8 characters.'
  }
  return errors
}

export default function SignIn({ session, onLogin, onLogout, onBack, vehicle, vehicleError, onVehicleChange, vehicleReady }) {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setErrors({})
    setFormError('')
    setShowPassword(false)
  }

  function fillDemo() {
    setMode('signin')
    setForm((current) => ({
      ...current,
      email: DEMO.email,
      password: DEMO.password,
    }))
    setErrors({})
    setFormError('')
  }

  async function onSubmit(event) {
    event.preventDefault()
    const nextErrors = validate(form, mode)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    setFormError('')

    const path = mode === 'signin' ? '/api/auth/login' : '/api/auth/signup'
    const body =
      mode === 'signin'
        ? { email: form.email.trim(), password: form.password }
        : { name: form.name.trim(), email: form.email.trim(), password: form.password }

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setFormError(data.error || 'Something went wrong. Try again.')
        return
      }
      const nextSession = { token: data.token, user: data.user }
      if (onLogin) {
        onLogin(nextSession, form.remember)
      }
      setForm(EMPTY_FORM)
    } catch {
      setFormError('Cannot reach the WeatherWay server. Ensure the backend and postgres database are running.')
    } finally {
      setSubmitting(false)
    }
  }

  const isSignup = mode === 'signup'
  const user = session?.user

  return (
    <main className="auth-page">
      <button type="button" className="auth-back-nav" onClick={onBack}>
        ← Back to trip planner
      </button>

      <div className="shell">
        <header className="topbar">
          <div className="brand" onClick={onBack} style={{ cursor: 'pointer' }}>
            <span className="brand-symbol" aria-hidden="true">w.</span>
            <div className="brand-names">
              <strong>weatherway</strong>
              <small>OHIO CORRIDOR DISPATCH</small>
            </div>
          </div>
          <div className="auth-edition">HACKOHIO / 2026</div>
        </header>

        <section className="auth-stage" aria-label="WeatherWay Intelligence">
          <p className="eyebrow">Corridor Forecasting</p>
          <h1>
            <span>The road ahead,</span>
            <em>clarified.</em>
          </h1>
          <p className="stage-copy">
            Sign in to save your car, estimate fuel needs, and find better moments for a food or weather break.
          </p>

          <div className="auth-features">
            <div className="auth-feature-item">
              <span className="feature-dot" />
              <div>
                <strong>Point forecast synchronization</strong>
                <p>Arrival-matched 15-minute weather along I-71, I-75, and I-90.</p>
              </div>
            </div>
            <div className="auth-feature-item">
              <span className="feature-dot" />
              <div>
                <strong>A plan for your car</strong>
                <p>EPA highway mileage, fuel reserves, and arrival-matched break timing.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          {user ? (
            <div className="signed-in-card">
              <div className="signed-in-header">
                <div className="user-avatar-large">
                  {(user.name || 'User').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="eyebrow">Authenticated Operator</p>
                  <h2>Welcome back, {(user.name || 'there').split(' ')[0]}.</h2>
                </div>
              </div>

              <div className="session-details">
                <div className="detail-row">
                  <span>Account Email</span>
                  <strong>{user.email}</strong>
                </div>
                <div className="detail-row">
                  <span>Profile Name</span>
                  <strong>{user.name}</strong>
                </div>
                <div className="detail-row">
                  <span>Database Session</span>
                  <span className="status-live-tag">Active (PostgreSQL)</span>
                </div>
              </div>

              {vehicleReady ? <VehicleProfile session={session} vehicle={vehicle} onChange={onVehicleChange} loadError={vehicleError} /> : <p role="status">Loading your garage…</p>}
              <div className="signed-in-actions">
                <button type="button" className="primary btn-return-planner" onClick={onBack}>
                  ← Return to Trip Planner
                </button>
                <button type="button" className="secondary btn-signout" onClick={onLogout}>
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <form className="auth-form" onSubmit={onSubmit} noValidate>
              <div className="form-mode-tabs">
                <button
                  type="button"
                  className={`tab-btn ${!isSignup ? 'active' : ''}`}
                  onClick={() => switchMode('signin')}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`tab-btn ${isSignup ? 'active' : ''}`}
                  onClick={() => switchMode('signup')}
                >
                  Create Account
                </button>
              </div>

              <div className="panel-intro">
                <h2>{isSignup ? 'Create your profile.' : 'Welcome back.'}</h2>
                <p className="panel-copy">
                  {isSignup
                    ? 'Enter your name, email, and password to start saving routes.'
                    : 'Sign in to access your saved Ohio travel corridors.'}
                </p>
              </div>

              {!isSignup && (
                <div className="demo-callout">
                  <div>
                    <span className="demo-label">TEST DEMO ACCOUNT</span>
                    <span className="demo-creds">{DEMO.email} · pass: {DEMO.password}</span>
                  </div>
                  <button type="button" className="demo-fill-btn" onClick={fillDemo}>
                    Auto-fill
                  </button>
                </div>
              )}

              {isSignup && (
                <label className="field">
                  <span className="field-title">Full Name</span>
                  <input
                    name="name"
                    autoComplete="name"
                    placeholder="Alex Rivera"
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? 'name-error' : undefined}
                  />
                  {errors.name && (
                    <small id="name-error" className="field-error">
                      {errors.name}
                    </small>
                  )}
                </label>
              )}

              <label className="field">
                <span className="field-title">Email Address</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="alex@weatherway.app"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email && (
                  <small id="email-error" className="field-error">
                    {errors.email}
                  </small>
                )}
              </label>

              <div className="field">
                <span className="field-title">Password</span>
                <div className="password-input-wrap">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    placeholder="At least 8 characters"
                    value={form.password}
                    onChange={(event) => updateField('password', event.target.value)}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((curr) => !curr)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && (
                  <small id="password-error" className="field-error">
                    {errors.password}
                  </small>
                )}
              </div>

              <label className="remember-option">
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(event) => updateField('remember', event.target.checked)}
                />
                <span>Remember session on this computer</span>
              </label>

              {formError && (
                <div className="form-error-alert" role="alert">
                  {formError}
                </div>
              )}

              <button type="submit" className="primary submit-btn" disabled={submitting}>
                {submitting ? 'Authenticating…' : isSignup ? 'Create Account' : 'Sign In to WeatherWay'}
              </button>

              <p className="auth-switch-prompt">
                {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
                >
                  {isSignup ? 'Sign in here' : 'Create an account'}
                </button>
              </p>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

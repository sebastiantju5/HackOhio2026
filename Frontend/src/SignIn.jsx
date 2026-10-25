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
      <div className={user ? 'shell shell-profile' : 'shell shell-auth'}>
        <section className="auth-panel">
          {user ? (
            <div className="signed-in-card">
              <div className="signed-in-header">
                <div className="signed-in-header-left">
                  <div className="user-avatar-large">
                    {(user.name || 'User').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="signed-in-identity">
                    <h2>{user.name || 'Your profile'}</h2>
                    <p>{user.email}</p>
                  </div>
                </div>
                <button type="button" className="header-signout-btn" onClick={onLogout}>
                  Sign out
                </button>
              </div>

              {vehicleReady ? <VehicleProfile session={session} vehicle={vehicle} onChange={onVehicleChange} loadError={vehicleError} /> : <p role="status">Loading your car…</p>}
            </div>
          ) : (
            <form className="auth-form" onSubmit={onSubmit} noValidate>
              <div className="panel-intro">
                <button type="button" className="brand-symbol" onClick={onBack} aria-label="Back to planner">w.</button>
                <h2>{isSignup ? 'Create your account' : 'Welcome back'}</h2>
                <p className="panel-copy">
                  {isSignup ? 'Save your car to plan fuel and breaks.' : 'Sign in to WeatherWay.'}
                </p>
              </div>

              {isSignup && (
                <label className="field">
                  <span className="field-title">Name</span>
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
                <span className="field-title">Email</span>
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

              {formError && (
                <div className="form-error-alert" role="alert">
                  {formError}
                </div>
              )}

              <button type="submit" className="primary submit-btn" disabled={submitting}>
                {submitting ? (isSignup ? 'Creating account…' : 'Signing in…') : isSignup ? 'Create account' : 'Sign in'}
              </button>

              <p className="auth-switch-prompt">
                {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
                >
                  {isSignup ? 'Sign in' : 'Create one'}
                </button>
              </p>

              {!isSignup && (
                <button type="button" className="demo-link" onClick={fillDemo}>
                  Use the demo account
                </button>
              )}
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

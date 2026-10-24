import { useEffect, useState } from 'react'
import './SignIn.css'

const DEMO = {
  email: 'alex@locallens.app',
  password: 'neighborhood',
}

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  remember: true,
}

function readStoredSession() {
  const raw = localStorage.getItem('locallens-session') || sessionStorage.getItem('locallens-session')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function storeSession(session, remember) {
  const raw = JSON.stringify(session)
  localStorage.removeItem('locallens-session')
  sessionStorage.removeItem('locallens-session')
  const store = remember ? localStorage : sessionStorage
  store.setItem('locallens-session', raw)
}

function clearSession() {
  localStorage.removeItem('locallens-session')
  sessionStorage.removeItem('locallens-session')
}

function savedSession() {
  const stored = readStoredSession()
  if (!stored?.token || !stored?.user?.email) return null
  return stored
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

export default function SignIn() {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [session, setSession] = useState(savedSession)

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored?.token) return

    const controller = new AbortController()
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${stored.token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (readStoredSession()?.token !== stored.token) return
        if (response.status === 401) {
          clearSession()
          setSession(null)
          return
        }
        if (!response.ok) return
        const data = await response.json()
        if (!data?.user?.email) return
        if (readStoredSession()?.token !== stored.token) return
        setSession({ token: stored.token, user: data.user })
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
      })

    return () => controller.abort()
  }, [])

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
      storeSession(nextSession, form.remember)
      setSession(nextSession)
      setForm(EMPTY_FORM)
    } catch {
      setFormError('LocalLens can’t reach the server. Start the backend and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut() {
    const token = session?.token
    setSession(null)
    clearSession()
    if (!token) return
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }

  const isSignup = mode === 'signup'

  return (
    <main className="auth-page">
      <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg className="pixel-mark" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6 1h4v2h2v2h2v8H2V5h2V3h2V1zm1 2v2H5v8h6V5H9V3H7zm1 4h2v2H8V7z"
            />
          </svg>
          <p>LocalLens</p>
        </div>
        <div className="swatches" aria-hidden="true">
          <span className="swatch cream" />
          <span className="swatch olive" />
          <span className="swatch stone" />
        </div>
      </header>

      <section className="auth-stage" aria-label="LocalLens">
        <p className="eyebrow">HackOhio</p>
        <h1>
          <span>Local</span>
          <span>Lens</span>
        </h1>
        <p className="stage-copy">
          Sign in to find what’s nearby — the shops, events, and people that make a block feel like home.
        </p>
      </section>

      <section className="auth-panel">
        {session ? (
          <div className="signed-in">
            <p className="eyebrow">Signed in</p>
            <h2>Welcome back, {(session.user.name || 'there').split(' ')[0]}.</h2>
            <p className="panel-copy">You’re in as {session.user.email}.</p>
            <button type="button" className="primary" onClick={signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <p className="eyebrow">{isSignup ? 'Create account' : 'Sign in'}</p>
            <h2>{isSignup ? 'Start looking closer.' : 'Welcome back.'}</h2>
            <p className="panel-copy">
              {isSignup
                ? 'A name, an email, and a password is all it takes.'
                : 'Use your LocalLens email and password to continue.'}
            </p>

            {isSignup && (
              <label className="field">
                <span>Name</span>
                <input
                  name="name"
                  autoComplete="name"
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
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
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
              <label htmlFor="password">Password</label>
              <span className="password-row">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={(event) => updateField('password', event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </span>
              {errors.password && (
                <small id="password-error" className="field-error">
                  {errors.password}
                </small>
              )}
            </div>

            <label className="remember">
              <input
                type="checkbox"
                checked={form.remember}
                onChange={(event) => updateField('remember', event.target.checked)}
              />
              <span>Keep me signed in on this device</span>
            </label>

            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}

            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
            </button>

            <p className="switch">
              {isSignup ? 'Already have an account?' : 'New to LocalLens?'}{' '}
              <button type="button" className="text-button" onClick={() => switchMode(isSignup ? 'signin' : 'signup')}>
                {isSignup ? 'Sign in' : 'Create an account'}
              </button>
            </p>

            {!isSignup && (
              <p className="demo">
                Demo account{' '}
                <button type="button" className="text-button" onClick={fillDemo}>
                  {DEMO.email}
                </button>
                <span className="demo-pass">password {DEMO.password}</span>
              </p>
            )}
          </form>
        )}
      </section>
      </div>
    </main>
  )
}

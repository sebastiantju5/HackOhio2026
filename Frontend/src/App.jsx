import { useEffect, useState } from 'react'
import SignIn from './SignIn.jsx'
import TripPlanner from './TripPlanner.jsx'
import { readStoredSession, storeSession, clearSession, verifySession, logoutUser } from './auth.js'

export default function App() {
  const [view, setView] = useState('planner')
  const [session, setSession] = useState(readStoredSession)

  useEffect(() => {
    const stored = readStoredSession()
    if (!stored?.token) return

    const controller = new AbortController()
    verifySession(stored.token, controller.signal)
      .then((user) => {
        if (!user) {
          clearSession()
          setSession(null)
        } else {
          setSession({ token: stored.token, user })
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          // Keep offline session if server is momentarily unreachable
        }
      })

    return () => controller.abort()
  }, [])

  function handleLogin(nextSession, remember = true) {
    storeSession(nextSession, remember)
    setSession(nextSession)
    setView('planner')
  }

  async function handleLogout() {
    const token = session?.token
    setSession(null)
    clearSession()
    if (token) {
      await logoutUser(token)
    }
  }

  if (view === 'account') {
    return (
      <SignIn
        session={session}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onBack={() => setView('planner')}
      />
    )
  }

  return (
    <TripPlanner
      session={session}
      onAccount={() => setView('account')}
      onLogout={handleLogout}
    />
  )
}

const STORAGE_KEYS = ['weatherway-session', 'locallens-session']

export function readStoredSession() {
  for (const key of STORAGE_KEYS) {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.token && parsed?.user?.email) {
          return parsed
        }
      } catch {
        // ignore JSON parse error
      }
    }
  }
  return null
}

export function storeSession(session, remember = true) {
  const raw = JSON.stringify(session)
  clearSession()
  const store = remember ? localStorage : sessionStorage
  store.setItem('weatherway-session', raw)
}

export function clearSession() {
  for (const key of STORAGE_KEYS) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
}

export async function verifySession(token, signal) {
  if (!token) return null
  const response = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) return null
  const data = await response.json()
  return data?.user || null
}

export async function logoutUser(token) {
  clearSession()
  if (!token) return
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // ignore network failure on logout
  }
}

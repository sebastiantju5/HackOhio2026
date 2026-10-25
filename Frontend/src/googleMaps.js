let loading
let authFailed = false
const authListeners = new Set()

export function mapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
}

export function isGoogleMapsAuthFailed() {
  return authFailed
}

export function onGoogleMapsAuthFailure(callback) {
  authListeners.add(callback)
  if (authFailed) {
    try { callback() } catch {
      // Ignore
    }
  }
  return () => authListeners.delete(callback)
}

function notifyAuthFailure() {
  authFailed = true
  authListeners.forEach((cb) => {
    try { cb() } catch {
      // Ignore
    }
  })
}

// Hook into gm_authFailure globally so Google Maps auth errors are caught immediately
if (typeof window !== 'undefined') {
  const previousAuthFailure = window.gm_authFailure
  window.gm_authFailure = () => {
    notifyAuthFailure()
    if (typeof previousAuthFailure === 'function') {
      try { previousAuthFailure() } catch {
        // Ignore
      }
    }
  }
}

export function loadGoogleMaps() {
  const key = mapsKey()
  if (!key) {
    return Promise.reject(new Error('Add VITE_GOOGLE_MAPS_API_KEY to Frontend/.env, then restart the site.'))
  }
  if (authFailed) {
    return Promise.reject(new Error('Google Maps authentication failed.'))
  }
  if (window.google?.maps?.places && window.google.maps.Geocoder) {
    return Promise.resolve(window.google)
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly&loading=async`
      script.async = true
      script.onerror = () => {
        loading = null
        notifyAuthFailure()
        reject(new Error('Google Maps failed to load. Check network connection or API key.'))
      }
      script.onload = () => {
        if (authFailed) {
          reject(new Error('Google Maps authentication failed.'))
        } else {
          resolve(window.google)
        }
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

export async function geocodeAddress(address) {
  const query = address.trim()
  if (!query) return Promise.reject(new Error('Enter a starting point and a destination.'))

  // 1. Try Google Maps Geocoder if key is set and auth hasn't failed
  if (mapsKey() && !authFailed) {
    try {
      const google = await loadGoogleMaps()
      if (google?.maps?.Geocoder) {
        const result = await new Promise((resolve, reject) => {
          new google.maps.Geocoder().geocode({ address: query }, (results, status) => {
            const location = results?.[0]?.geometry?.location
            if (status === 'OK' && location) {
              const name = results[0].formatted_address || query
              resolve({ name: name.slice(0, 180), coordinates: [location.lng(), location.lat()] })
            } else {
              reject(new Error(status || 'Google geocode failed'))
            }
          })
        })
        return result
      }
    } catch {
      // Fall through to OpenStreetMap Nominatim
    }
  }

  // 2. High-reliability fallback: OpenStreetMap Nominatim (works globally without billing or API key)
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const list = await res.json()
      if (Array.isArray(list) && list.length > 0) {
        const item = list[0]
        const addr = item.address || {}
        const city = addr.city || addr.town || addr.village || addr.hamlet || item.name || (item.display_name || '').split(',')[0].trim()
        const stateCode = addr['ISO3166-2-lvl4'] ? addr['ISO3166-2-lvl4'].replace('US-', '') : (addr.state || '')
        const cleanName = (city && stateCode) ? `${city}, ${stateCode}` : (item.display_name?.split(',').slice(0, 2).join(',').trim() || query)
        return {
          name: cleanName.slice(0, 180),
          coordinates: [parseFloat(item.lon), parseFloat(item.lat)],
        }
      }
    }
  } catch {
    // Fall through
  }

  throw new Error(`Could not find “${query}”. Choose a suggestion from the list or check spelling.`)
}

export async function searchPlaceSuggestions(query) {
  const q = query.trim()
  if (q.length < 2) return []

  const key = mapsKey()
  // 1. Try Google Places New API if key is available and not auth-failed
  if (key && !authFailed) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
        body: JSON.stringify({ input: q }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.suggestions && data.suggestions.length > 0) {
          return data.suggestions.map((s) => {
            const pred = s.placePrediction
            const main = pred.structuredFormat?.mainText?.text || pred.text?.text || q
            const secondary = pred.structuredFormat?.secondaryText?.text || ''
            const statePart = secondary.split(',')[0]?.trim() || ''
            const cleanName = statePart ? `${main}, ${statePart}` : (pred.text?.text || q)
            return {
              name: cleanName,
              mainText: main,
              secondaryText: secondary,
            }
          })
        }
      }
    } catch {
      // Fall through
    }
  }

  // 2. Fallback to OpenStreetMap Nominatim suggestions
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const list = await res.json()
      if (Array.isArray(list)) {
        return list.map((item) => {
          const addr = item.address || {}
          const city = addr.city || addr.town || addr.village || addr.hamlet || item.name || (item.display_name || '').split(',')[0].trim()
          const stateCode = addr['ISO3166-2-lvl4'] ? addr['ISO3166-2-lvl4'].replace('US-', '') : (addr.state || '')
          const cleanName = (city && stateCode) ? `${city}, ${stateCode}` : (item.display_name?.split(',').slice(0, 2).join(',').trim() || q)
          const secondary = [addr.county, addr.state, addr.country].filter(Boolean).join(', ') || item.display_name || ''
          return {
            name: cleanName,
            mainText: city,
            secondaryText: secondary,
            coordinates: [parseFloat(item.lon), parseFloat(item.lat)],
          }
        })
      }
    }
  } catch {
    // Fall through
  }

  return []
}

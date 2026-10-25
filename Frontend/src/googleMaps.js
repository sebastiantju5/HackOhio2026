import { compactRoute } from './routeGeometry.js'
import { compareFuelStations } from './fuelPrices.js'

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
  if (window.google?.maps?.Map && window.google?.maps?.places && window.google?.maps?.Geocoder) {
    return Promise.resolve(window.google)
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const callbackName = '__googleMapsCallback_' + Math.random().toString(36).slice(2)
      window[callbackName] = () => {
        delete window[callbackName]
        if (authFailed) {
          reject(new Error('Google Maps authentication failed.'))
        } else {
          resolve(window.google)
        }
      }

      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,routes,geometry,marker&callback=${callbackName}`
      script.async = true
      script.onerror = () => {
        delete window[callbackName]
        loading = null
        notifyAuthFailure()
        reject(new Error('Google Maps failed to load. Check network connection or API key.'))
      }
      document.head.appendChild(script)
    })
  }
  return loading
}

function geocodePoint(location) {
  const lng = typeof location?.lng === 'function' ? location.lng() : location?.lng
  const lat = typeof location?.lat === 'function' ? location.lat() : location?.lat
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}

function geocodeWithGoogle(request) {
  return loadGoogleMaps().then(google => new Promise((resolve, reject) => {
    if (!google?.maps?.Geocoder) {
      reject(new Error('Google Geocoding is unavailable.'))
      return
    }
    new google.maps.Geocoder().geocode(request, (results, status) => {
      const match = results?.[0]
      const coordinates = geocodePoint(match?.geometry?.location)
      if (status === 'OK' && coordinates) resolve({ coordinates, address: match.formatted_address || '' })
      else reject(new Error(status || 'Google geocode failed'))
    })
  }))
}

export async function geocodeCheckpoint(place) {
  const query = [place?.name, place?.address].filter(Boolean).join(', ').trim()
  if (!query) throw new Error('This place has no address to geocode.')
  if (!mapsKey() || authFailed) throw new Error('Google Geocoding is unavailable.')
  const request = { address: query }
  if (Array.isArray(place.coordinates) && place.coordinates.length === 2 && place.coordinates.every(Number.isFinite)) {
    const google = await loadGoogleMaps()
    const [lng, lat] = place.coordinates
    request.bounds = new google.maps.LatLngBounds(
      { lat: lat - 0.2, lng: lng - 0.25 },
      { lat: lat + 0.2, lng: lng + 0.25 },
    )
  }
  const located = await geocodeWithGoogle(request)
  return { ...located, address: located.address || place.address || query }
}

export async function geocodeAddress(address) {
  const query = address.trim()
  if (!query) return Promise.reject(new Error('Enter a starting point and a destination.'))

  // 1. Try Google Maps Geocoder if key is set and auth hasn't failed
  if (mapsKey() && !authFailed) {
    try {
      const google = await loadGoogleMaps()
      if (google?.maps?.Geocoder) {
        const located = await geocodeWithGoogle({ address: query })
        return { name: located.address.slice(0, 180) || query, coordinates: located.coordinates }
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

export async function getGoogleRoutes(form, departure, googleApi = null) {
  const departureTime = new Date(departure)
  if (!Number.isFinite(departureTime.getTime())) throw new Error('Choose a valid route departure time.')
  const google = googleApi || await loadGoogleMaps()
  const { Route } = await google.maps.importLibrary('routes')
  const location = place => ({ lng: place.coordinates[0], lat: place.coordinates[1] })
  const result = await Route.computeRoutes({
    origin: location(form.originPlace), destination: location(form.destinationPlace),
    travelMode: 'DRIVING', computeAlternativeRoutes: form.alternatives,
    departureTime, routingPreference: 'TRAFFIC_AWARE',
    fields: ['path', 'legs', 'durationMillis', 'distanceMeters'],
  }).catch(error => {
    console.warn('WeatherWay Google Routes:', String(error.message || error).split('\n')[0].replace(/AIza[\w-]+/g, '[redacted]'))
    throw new Error('Google Routes could not calculate this drive. Enable Routes API for your Maps key and check your endpoints.')
  })
  if (!result.routes?.length) throw new Error('Google Routes found no drivable routes between these places.')
  return result.routes.slice(0, form.alternatives ? 2 : 1).map(route => compactRoute(
    route.legs.flatMap(leg => leg.steps.map(step => ({
      path: step.path.map(point => [point.lng, point.lat]),
      seconds: step.staticDurationMillis / 1000,
    }))),
    route.durationMillis / 1000, route.distanceMeters,
  ))
}

export async function findStopPlaces(stop, fuelOnly = stop.fuel, { radius = fuelOnly ? 1500 : 10000, maxResultCount = fuelOnly ? 3 : 5 } = {}) {
  const google = await loadGoogleMaps()
  const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary('places')
  const { places } = await Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'],
    locationRestriction: { center: { lat: stop.coordinates[1], lng: stop.coordinates[0] }, radius },
    includedTypes: [fuelOnly ? 'gas_station' : 'restaurant'], maxResultCount,
    rankPreference: SearchNearbyRankPreference.DISTANCE,
  })
  return places.map(place => ({ id: place.id, name: place.displayName, address: place.formattedAddress,
    url: place.googleMapsURI, coordinates: [place.location.lng(), place.location.lat()] }))
}

export async function findStopFuelPrices(stop, grade, googleApi = null) {
  const google = googleApi || await loadGoogleMaps()
  const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary('places')
  const { places } = await Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI', 'fuelOptions'],
    locationRestriction: { center: { lat: stop.coordinates[1], lng: stop.coordinates[0] }, radius: 1500 },
    includedTypes: ['gas_station'], maxResultCount: 10, rankPreference: SearchNearbyRankPreference.DISTANCE,
  })
  return compareFuelStations(places.map(place => ({ id: place.id, name: place.displayName, address: place.formattedAddress,
    url: place.googleMapsURI, coordinates: [place.location.lng(), place.location.lat()], fuelPrices: place.fuelOptions?.fuelPrices })), grade)
}

import { compactRoute } from './routeGeometry.js'
import { fromWallInput } from './format.js'

let loading

export function mapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
}

export function loadGoogleMaps() {
  const key = mapsKey()
  if (!key) {
    return Promise.reject(new Error('Add VITE_GOOGLE_MAPS_API_KEY to Frontend/.env, then restart the site.'))
  }
  if (window.google?.maps?.places && window.google.maps.Geocoder) return Promise.resolve(window.google)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`
      script.async = true
      script.onerror = () => {
        loading = null
        reject(new Error('Google Maps failed to load. Check the API key and that Maps JavaScript, Places, and Geocoding are enabled.'))
      }
      script.onload = () => resolve(window.google)
      document.head.appendChild(script)
    })
  }
  return loading
}

export function geocodeAddress(address) {
  const query = address.trim()
  if (!query) return Promise.reject(new Error('Enter a starting point and a destination.'))
  return loadGoogleMaps().then((google) => new Promise((resolve, reject) => {
    new google.maps.Geocoder().geocode({ address: query }, (results, status) => {
      const location = results?.[0]?.geometry?.location
      if (status !== 'OK' || !location) {
        reject(new Error(`Could not find “${query}”. Choose a suggestion from the list.`))
        return
      }
      const name = results[0].formatted_address || query
      resolve({ name: name.slice(0, 180), coordinates: [location.lng(), location.lat()] })
    })
  }))
}

export async function getGoogleRoutes(form) {
  const google = await loadGoogleMaps()
  const { Route } = await google.maps.importLibrary('routes')
  const location = place => ({ lng: place.coordinates[0], lat: place.coordinates[1] })
  const result = await Route.computeRoutes({
    origin: location(form.originPlace), destination: location(form.destinationPlace),
    travelMode: 'DRIVING', computeAlternativeRoutes: form.alternatives,
    departureTime: new Date(fromWallInput(form.start)), routingPreference: 'TRAFFIC_AWARE',
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

export async function findStopPlaces(stop, fuelOnly = stop.fuel) {
  const google = await loadGoogleMaps()
  const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary('places')
  const { places } = await Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'],
    locationRestriction: { center: { lat: stop.coordinates[1], lng: stop.coordinates[0] }, radius: 1500 },
    includedTypes: [fuelOnly ? 'gas_station' : 'restaurant'], maxResultCount: 3,
    rankPreference: SearchNearbyRankPreference.DISTANCE,
  })
  return places.map(place => ({ id: place.id, name: place.displayName, address: place.formattedAddress,
    url: place.googleMapsURI, coordinates: [place.location.lng(), place.location.lat()] }))
}

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

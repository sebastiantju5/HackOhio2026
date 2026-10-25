import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LEVELS } from './format.js'
import { isGoogleMapsAuthFailed, loadGoogleMaps, mapsKey, onGoogleMapsAuthFailure } from './googleMaps.js'

const latLng = coordinates => [coordinates[1], coordinates[0]]

function GoogleRouteMap({ route, candidate, onSelect, originPlace, destinationPlace, stops, onAuthError }) {
  const container = useRef(null)
  const map = useRef(null)
  const drawn = useRef([])
  const onAuthErrorRef = useRef(onAuthError)
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  onAuthErrorRef.current = onAuthError

  function clearDrawn() {
    drawn.current.forEach((item) => {
      try { item.setMap(null) } catch {
        // Ignore
      }
    })
    drawn.current = []
  }

  useEffect(() => {
    let cancelled = false
    const unsubscribe = onGoogleMapsAuthFailure(() => {
      if (!cancelled) onAuthErrorRef.current?.()
    })

    if (isGoogleMapsAuthFailed()) {
      onAuthErrorRef.current?.()
      return () => unsubscribe()
    }

    loadGoogleMaps().then((google) => {
      if (cancelled || !container.current) return
      try {
        map.current = new google.maps.Map(container.current, {
          center: { lat: 39.96, lng: -82.99 },
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        })
        setMapReady(true)
        setMapError('')
      } catch {
        if (!cancelled) onAuthErrorRef.current?.()
      }
    }).catch(() => {
      if (!cancelled) onAuthErrorRef.current?.()
    })

    return () => {
      cancelled = true
      unsubscribe()
      clearDrawn()
      map.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const google = window.google
    if (!mapReady || !map.current || !google?.maps || !route) return
    clearDrawn()
    const bounds = new google.maps.LatLngBounds()
    const addPath = (coordinates, options) => {
      const path = coordinates.map(([lng, lat]) => ({ lat, lng }))
      path.forEach((point) => bounds.extend(point))
      const line = new google.maps.Polyline({ ...options, path, map: map.current })
      drawn.current.push(line)
      return line
    }

    addPath(route.geometry.coordinates, { strokeColor: '#fbf9ef', strokeWeight: 12, strokeOpacity: 0.95 })
    route.segments.forEach((segment, index) => {
      const level = candidate.segmentLevels[index]
      const line = addPath(segment.coordinates, {
        strokeColor: LEVELS[level].color,
        strokeWeight: 6,
        strokeOpacity: 1,
        icons: level === 'unknown' ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }] : undefined,
      })
      line.addListener('click', () => onSelect(index))
    })

    stops?.forEach((stop, index) => {
      const marker = new google.maps.Marker({
        map: map.current,
        position: { lat: stop.coordinates[1], lng: stop.coordinates[0] },
        label: { text: `S${index + 1}`, color: '#fff', fontSize: '11px' },
        title: `Break ${index + 1}: ${stop.durationMinutes} minutes`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 17, fillColor: '#6f281a', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        zIndex: 100,
      })
      marker.addListener('click', () => onSelect?.(stop.checkpointIndex))
      drawn.current.push(marker)
    })

    if (!bounds.isEmpty()) map.current.fitBounds(bounds, 55)
  }, [mapReady, route, candidate, stops, onSelect])

  // Direct line preview without calling legacy DirectionsService (which throws REQUEST_DENIED)
  useEffect(() => {
    const google = window.google
    if (!mapReady || !map.current || !google?.maps || route) return undefined
    if (!originPlace?.coordinates || !destinationPlace?.coordinates) return undefined
    clearDrawn()
    const path = [
      { lat: originPlace.coordinates[1], lng: originPlace.coordinates[0] },
      { lat: destinationPlace.coordinates[1], lng: destinationPlace.coordinates[0] },
    ]
    const bounds = new google.maps.LatLngBounds()
    path.forEach((pt) => bounds.extend(pt))
    const line = new google.maps.Polyline({
      path,
      map: map.current,
      strokeColor: '#254d3a',
      strokeWeight: 4,
      strokeOpacity: 0.8,
    })
    drawn.current.push(line)
    if (!bounds.isEmpty()) map.current.fitBounds(bounds, 65)
  }, [mapReady, route, originPlace, destinationPlace])

  return (
    <div className="map-wrap">
      <div ref={container} className="route-map" role="region" aria-label="Google map of the route." />
      {mapError && (
        <div className="map-empty">
          <span className="mini-label">GOOGLE MAPS</span>
          <h2>The map needs an API key.</h2>
          <p>{mapError}</p>
        </div>
      )}
      {!mapError && !route && !(originPlace?.coordinates && destinationPlace?.coordinates) && (
        <div className="map-empty">
          <span className="mini-label">GOOGLE MAPS</span>
          <h2>A little foresight.<br />A better drive.</h2>
          <p>Choose a starting point and a destination anywhere, then analyze the trip.</p>
        </div>
      )}
      <div className="map-legend" aria-label="Exposure legend">
        {Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}
      </div>
    </div>
  )
}

function LeafletRouteMap({ route, candidate, onSelect, originPlace, destinationPlace, stops }) {
  const container = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)
  const [tileIssue, setTileIssue] = useState(false)

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = L.map(container.current, { zoomControl: true }).setView([39.96, -82.99], 6)
    map.current = instance
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18,
    }).on('tileerror', () => setTileIssue(true)).addTo(instance)
    layers.current = L.layerGroup().addTo(instance)
    const observer = new ResizeObserver(() => instance.invalidateSize())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current || !route) return
    map.current.fitBounds(L.latLngBounds(route.geometry.coordinates.map(latLng)), { padding: [55, 55], maxZoom: 9 })
  }, [route])

  // Direct line preview between origin and destination before route analysis is run
  useEffect(() => {
    if (!map.current || !layers.current || route) return
    if (!originPlace?.coordinates || !destinationPlace?.coordinates) return
    layers.current.clearLayers()
    const coords = [latLng(originPlace.coordinates), latLng(destinationPlace.coordinates)]
    L.polyline(coords, { color: '#254d3a', weight: 4, opacity: 0.8, dashArray: '6 8' }).addTo(layers.current)
    map.current.fitBounds(L.latLngBounds(coords), { padding: [65, 65], maxZoom: 9 })
  }, [route, originPlace, destinationPlace])

  useEffect(() => {
    if (!layers.current) return
    layers.current.clearLayers()
    if (!route || !candidate) return
    L.polyline(route.geometry.coordinates.map(latLng), { color: '#fbf9ef', weight: 13, opacity: 0.95 }).addTo(layers.current)
    route.segments.forEach((segment, index) => {
      const level = candidate.segmentLevels[index]
      L.polyline(segment.coordinates.map(latLng), { color: LEVELS[level].color, weight: 7, opacity: 1, dashArray: level === 'unknown' ? '5 8' : undefined }).addTo(layers.current).on('click', () => onSelect(index))
    })

    stops?.forEach((stop, index) => {
      L.marker(latLng(stop.coordinates), {
        icon: L.divIcon({ className: 'checkpoint-marker stop-marker', html: `<span class="map-dot stop-dot">S${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `Suggested break ${index + 1}: ${stop.durationMinutes} min`,
        keyboard: true,
      }).on('click', () => onSelect?.(stop.checkpointIndex)).addTo(layers.current)
    })
  }, [route, candidate, stops, onSelect])

  return (
    <div className="map-wrap">
      <div ref={container} className="route-map" role="region" aria-label="Interactive route map." />
      {!route && !(originPlace?.coordinates && destinationPlace?.coordinates) && (
        <div className="map-empty">
          <span className="mini-label">OHIO WEATHER CORRIDOR</span>
          <h2>A little foresight.<br />A better drive.</h2>
          <p>Plan a trip to see conditions along the way.</p>
        </div>
      )}
      {tileIssue && <p className="tile-warning" role="status">Some map tiles are unavailable. The route line is still shown.</p>}
      <div className="map-legend" aria-label="Exposure legend">
        {Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}
      </div>
    </div>
  )
}

export default function RouteMap(props) {
  const [authError, setAuthError] = useState(() => isGoogleMapsAuthFailed())

  useEffect(() => {
    return onGoogleMapsAuthFailure(() => setAuthError(true))
  }, [])

  const canUseGoogle = Boolean(mapsKey()) && !authError

  return canUseGoogle ? (
    <GoogleRouteMap {...props} onAuthError={() => setAuthError(true)} />
  ) : (
    <LeafletRouteMap {...props} />
  )
}

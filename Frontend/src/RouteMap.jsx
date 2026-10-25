import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LEVELS } from './format.js'
import { isGoogleMapsAuthFailed, loadGoogleMaps, mapsKey, onGoogleMapsAuthFailure } from './googleMaps.js'
import { stopLabel, stopPopup, venuePopup, visibleStopEntries } from './stopPresentation.js'
import './RouteStops.css'

const latLng = coordinates => [coordinates[1], coordinates[0]]

function GoogleRouteMap({ route, candidate, onSelect, originPlace, destinationPlace, stops, onAuthError, focus, onStopSelect, places, timeZone, hiddenStops }) {
  const container = useRef(null)
  const map = useRef(null)
  const drawn = useRef([])
  const stopMarkers = useRef([])
  const venueMarkers = useRef([])
  const info = useRef(null)
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)

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
      if (!cancelled) {
        onAuthError?.()
      }
    })

    if (isGoogleMapsAuthFailed()) {
      onAuthError?.()
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
        info.current = new google.maps.InfoWindow()
        setMapReady(true)
        setMapError('')
      } catch {
        if (!cancelled) onAuthError?.()
      }
    }).catch(() => {
      if (!cancelled) onAuthError?.()
    })

    return () => {
      cancelled = true
      unsubscribe()
      clearDrawn()
      info.current?.close()
      map.current = null
    }
  }, [onAuthError])

  useEffect(() => {
    const google = window.google
    if (!mapReady || !map.current || !google?.maps || !route || !candidate) return
    clearDrawn()
    info.current?.close()
    stopMarkers.current = []
    venueMarkers.current = []
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

    ;[{ coordinates: route.geometry.coordinates[0], label: 'A', title: `Start: ${originPlace?.name || 'Origin'}` },
      { coordinates: route.geometry.coordinates.at(-1), label: 'B', title: `Destination: ${destinationPlace?.name || 'Destination'}` }].forEach(point => {
      const marker = new google.maps.Marker({ map: map.current, position: { lng: point.coordinates[0], lat: point.coordinates[1] },
        label: { text: point.label, color: '#1d5b43', fontSize: '12px', fontWeight: '700' }, title: point.title,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#fff', fillOpacity: 1, strokeColor: '#1d5b43', strokeWeight: 2 }, zIndex: 500 })
      drawn.current.push(marker)
    })
    visibleStopEntries(stops, hiddenStops).forEach(({ stop, index }) => {
      const marker = new google.maps.Marker({
        map: map.current,
        position: { lat: stop.coordinates[1], lng: stop.coordinates[0] },
        label: { text: `S${index + 1}`, color: '#fff', fontSize: '11px' },
        title: stopLabel(stop, index, timeZone),
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 21, fillColor: '#6f281a', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
        zIndex: 1000,
      })
      marker.addListener('click', () => onStopSelect(index))
      stopMarkers.current[index] = marker
      drawn.current.push(marker)
    })
    places.forEach((place, index) => {
      const marker = new google.maps.Marker({ map: map.current, position: { lng: place.coordinates[0], lat: place.coordinates[1] },
        label: { text: `V${index + 1}`, color: '#fff', fontSize: '11px' }, title: `Nearby option: ${place.name}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 16, fillColor: '#245c8b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, zIndex: 900 })
      marker.addListener('click', () => onStopSelect(place.stopIndex, place.id))
      venueMarkers.current.push(marker); drawn.current.push(marker)
    })
  }, [mapReady, route, candidate, stops, onSelect, originPlace, destinationPlace, places, onStopSelect, timeZone, hiddenStops])

  useEffect(() => {
    if (!mapReady || !map.current || !route) return
    stopMarkers.current.forEach((marker, index) => marker.setOptions({ zIndex: focus.stopIndex === index ? 1500 : 1000 }))
    const venueIndex = places.findIndex(place => place.id === focus.venueId)
    const stop = stops?.[focus.stopIndex]
    const place = places[venueIndex]
    const marker = place ? venueMarkers.current[venueIndex] : stopMarkers.current[focus.stopIndex]
    if ((place || stop) && marker) {
      const coordinates = place?.coordinates || stop.coordinates
      map.current.setZoom(12)
      map.current.panTo({ lat: coordinates[1], lng: coordinates[0] })
      info.current.setContent(place ? venuePopup(place) : stopPopup(stop, focus.stopIndex, timeZone))
      info.current.open({ map: map.current, anchor: marker })
    } else {
      info.current?.close()
      const bounds = new window.google.maps.LatLngBounds()
      route.geometry.coordinates.forEach(([lng, lat]) => bounds.extend({ lat, lng }))
      map.current.fitBounds(bounds, 55)
    }
  }, [mapReady, route, candidate, stops, places, focus, timeZone, hiddenStops])

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
      {stops?.length > 0 && <div className="map-stop-notice">S pins: {stops.length - hiddenStops.length}/{stops.length} visible recommended {stops.length === 1 ? 'stop' : 'stops'} · select a pin for timing</div>}
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

function LeafletRouteMap({ route, candidate, onSelect, originPlace, destinationPlace, stops, focus, onStopSelect, places, timeZone, hiddenStops }) {
  const container = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)
  const stopMarkers = useRef([])
  const venueMarkers = useRef([])
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
    stopMarkers.current = []
    venueMarkers.current = []
    const coords = [latLng(originPlace.coordinates), latLng(destinationPlace.coordinates)]
    L.polyline(coords, { color: '#254d3a', weight: 4, opacity: 0.8, dashArray: '6 8' }).addTo(layers.current)
    map.current.fitBounds(L.latLngBounds(coords), { padding: [65, 65], maxZoom: 9 })
  }, [route, originPlace, destinationPlace])

  useEffect(() => {
    if (!layers.current) return
    layers.current.clearLayers()
    stopMarkers.current = []
    venueMarkers.current = []
    if (!route || !candidate) return
    L.polyline(route.geometry.coordinates.map(latLng), { color: '#fbf9ef', weight: 13, opacity: 0.95 }).addTo(layers.current)
    route.segments.forEach((segment, index) => {
      const level = candidate.segmentLevels[index]
      L.polyline(segment.coordinates.map(latLng), { color: LEVELS[level].color, weight: 7, opacity: 1, dashArray: level === 'unknown' ? '5 8' : undefined }).addTo(layers.current).on('click', () => onSelect(index))
    })

    ;[{ coordinates: route.geometry.coordinates[0], label: 'A', title: `Start: ${originPlace?.name || 'Origin'}` },
      { coordinates: route.geometry.coordinates.at(-1), label: 'B', title: `Destination: ${destinationPlace?.name || 'Destination'}` }].forEach(point => {
      const label = document.createElement('span'); label.textContent = point.title
      L.marker(latLng(point.coordinates), { icon: L.divIcon({ className: 'route-stop-icon', html: `<span class="route-endpoint-pin">${point.label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }), title: point.title }).bindTooltip(label).addTo(layers.current)
    })
    visibleStopEntries(stops, hiddenStops).forEach(({ stop, index }) => {
      const marker = L.marker(latLng(stop.coordinates), {
        icon: L.divIcon({ className: 'route-stop-icon', html: `<span class="route-stop-pin">S${index + 1}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
        title: stopLabel(stop, index, timeZone),
        zIndexOffset: 1000,
        keyboard: true,
      }).bindPopup(stopPopup(stop, index, timeZone), { maxWidth: 260 }).on('click', () => onStopSelect(index)).addTo(layers.current)
      stopMarkers.current[index] = marker
    })
    places.forEach((place, index) => {
      const marker = L.marker(latLng(place.coordinates), { icon: L.divIcon({ className: 'route-stop-icon', html: `<span class="route-venue-pin">V${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: `Nearby option: ${place.name}`, zIndexOffset: 900 }).bindPopup(venuePopup(place), { maxWidth: 260 })
        .on('click', () => onStopSelect(place.stopIndex, place.id)).addTo(layers.current)
      venueMarkers.current.push(marker)
    })
  }, [route, candidate, stops, onSelect, originPlace, destinationPlace, places, onStopSelect, timeZone, hiddenStops])

  useEffect(() => {
    if (!map.current || !route) return
    stopMarkers.current.forEach((marker, index) => {
      marker.setIcon(L.divIcon({ className: 'route-stop-icon', html: `<span class="route-stop-pin ${focus.stopIndex === index ? 'selected' : ''}">S${index + 1}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }))
      marker.setZIndexOffset(focus.stopIndex === index ? 1500 : 1000)
    })
    const venueIndex = places.findIndex(place => place.id === focus.venueId)
    const stop = stops?.[focus.stopIndex]
    const place = places[venueIndex]
    const marker = place ? venueMarkers.current[venueIndex] : stopMarkers.current[focus.stopIndex]
    if ((place || stop) && marker) {
      map.current.setView(latLng(place?.coordinates || stop.coordinates), 12, { animate: false })
      marker.openPopup()
    } else {
      map.current.closePopup()
      map.current.fitBounds(L.latLngBounds(route.geometry.coordinates.map(latLng)), { padding: [55, 55], maxZoom: 9 })
    }
  }, [route, candidate, stops, places, focus, hiddenStops])

  return (
    <div className="map-wrap">
      <div ref={container} className="route-map" role="region" aria-label="Interactive route map." />
      {stops?.length > 0 && <div className="map-stop-notice">S pins: {stops.length - hiddenStops.length}/{stops.length} visible recommended {stops.length === 1 ? 'stop' : 'stops'} · select a pin for timing</div>}
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
  const handleAuthError = useCallback(() => setAuthError(true), [])

  useEffect(() => {
    return onGoogleMapsAuthFailure(() => setAuthError(true))
  }, [])

  const canUseGoogle = Boolean(mapsKey()) && !authError

  return canUseGoogle ? (
    <GoogleRouteMap {...props} onAuthError={handleAuthError} />
  ) : (
    <LeafletRouteMap {...props} />
  )
}

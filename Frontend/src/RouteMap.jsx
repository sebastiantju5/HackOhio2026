import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LEVELS } from './format.js'
import { loadGoogleMaps, mapsKey } from './googleMaps.js'

const latLng = coordinates => [coordinates[1], coordinates[0]]

function GoogleRouteMap({ route, candidate, onSelect, originPlace, destinationPlace }) {
  const container = useRef(null)
  const map = useRef(null)
  const drawn = useRef([])
  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)

  function clearDrawn() {
    drawn.current.forEach((item) => item.setMap(null))
    drawn.current = []
  }

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps().then((google) => {
      if (cancelled || !container.current) return
      map.current = new google.maps.Map(container.current, {
        center: { lat: 39.96, lng: -82.99 },
        zoom: 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      })
      setMapReady(true)
      setMapError('')
    }).catch((error) => {
      if (!cancelled) setMapError(error.message)
    })
    return () => {
      cancelled = true
      clearDrawn()
      map.current = null
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
    if (!bounds.isEmpty()) map.current.fitBounds(bounds, 55)
  }, [mapReady, route, candidate, onSelect])

  return <div className="map-wrap">
    <div ref={container} className="route-map" role="region" aria-label="Google map of the route." />
    {mapError && <div className="map-empty"><span className="mini-label">GOOGLE MAPS</span><h2>The map needs an API key.</h2><p>{mapError}</p></div>}
    {!mapError && !route && !(originPlace?.coordinates && destinationPlace?.coordinates) && <div className="map-empty"><span className="mini-label">GOOGLE MAPS</span><h2>A little foresight.<br />A better drive.</h2><p>Choose a starting point and a destination anywhere, then analyze the trip.</p></div>}
    <div className="map-legend" aria-label="Exposure legend">{Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}</div>
  </div>
}

function LeafletRouteMap({ route, candidate, onSelect }) {
  const container = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)
  const [tileIssue, setTileIssue] = useState(false)

  useEffect(() => {
    const instance = L.map(container.current, { zoomControl: false, scrollWheelZoom: false }).setView([40.7, -82.4], 7)
    map.current = instance
    L.control.zoom({ position: 'bottomright' }).addTo(instance)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
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

  useEffect(() => {
    if (!layers.current) return
    layers.current.clearLayers()
    if (!route || !candidate) return
    L.polyline(route.geometry.coordinates.map(latLng), { color: '#fbf9ef', weight: 13, opacity: 0.95 }).addTo(layers.current)
    route.segments.forEach((segment, index) => {
      const level = candidate.segmentLevels[index]
      L.polyline(segment.coordinates.map(latLng), { color: LEVELS[level].color, weight: 7, opacity: 1, dashArray: level === 'unknown' ? '5 8' : undefined }).addTo(layers.current).on('click', () => onSelect(index))
    })
  }, [route, candidate, onSelect])

  return <div className="map-wrap">
    <div ref={container} className="route-map" role="region" aria-label="Interactive route map." />
    {!route && <div className="map-empty"><span className="mini-label">OHIO WEATHER CORRIDOR</span><h2>A little foresight.<br />A better drive.</h2><p>Plan a trip to see conditions along the way.</p></div>}
    {tileIssue && <p className="tile-warning" role="status">Some map tiles are unavailable. The route line is still shown.</p>}
    <div className="map-legend" aria-label="Exposure legend">{Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}</div>
  </div>
}

export default function RouteMap(props) {
  return mapsKey() ? <GoogleRouteMap {...props} /> : <LeafletRouteMap {...props} />
}

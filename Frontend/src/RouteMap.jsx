import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LEVELS } from './format.js'
import { loadGoogleMaps, mapsKey } from './googleMaps.js'

const latLng = coordinates => [coordinates[1], coordinates[0]]

function GoogleRouteMap({ route, candidate, selectedPoint, onSelect, origin, destination, originPlace, destinationPlace }) {
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
    route.checkpoints.forEach((point, index) => {
      const level = candidate.checkpoints[index].level
      const endpoint = index === 0 || index === route.checkpoints.length - 1
      const position = { lat: point.coordinates[1], lng: point.coordinates[0] }
      bounds.extend(position)
      const marker = new google.maps.Marker({
        position,
        map: map.current,
        label: endpoint ? (index === 0 ? 'A' : 'B') : String(index + 1),
        title: endpoint ? (index === 0 ? origin : destination) : `Checkpoint ${index + 1}: ${LEVELS[level].label}`,
      })
      marker.addListener('click', () => onSelect(index))
      drawn.current.push(marker)
    })
    const selected = route.checkpoints[selectedPoint]
    if (selected) {
      drawn.current.push(new google.maps.Circle({
        map: map.current,
        center: { lat: selected.coordinates[1], lng: selected.coordinates[0] },
        radius: 1800,
        strokeColor: '#203f31',
        strokeWeight: 2,
        fillOpacity: 0,
        clickable: false,
      }))
    }
    if (!bounds.isEmpty()) map.current.fitBounds(bounds, 55)
  }, [mapReady, route, candidate, selectedPoint, onSelect, origin, destination])

  useEffect(() => {
    const google = window.google
    if (!mapReady || !map.current || !google?.maps || route) return undefined
    if (!originPlace?.coordinates || !destinationPlace?.coordinates) return undefined
    let cancelled = false
    new google.maps.DirectionsService().route({
      origin: { lng: originPlace.coordinates[0], lat: originPlace.coordinates[1] },
      destination: { lng: destinationPlace.coordinates[0], lat: destinationPlace.coordinates[1] },
      travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (cancelled || status !== 'OK' || !result?.routes?.[0]) return
      clearDrawn()
      const path = result.routes[0].overview_path
      drawn.current.push(new google.maps.Polyline({
        path,
        map: map.current,
        strokeColor: '#254d3a',
        strokeWeight: 5,
      }))
      const bounds = new google.maps.LatLngBounds()
      path.forEach((point) => bounds.extend(point))
      map.current.fitBounds(bounds, 55)
    })
    return () => {
      cancelled = true
    }
  }, [mapReady, route, originPlace, destinationPlace])

  return <div className="map-wrap">
    <div ref={container} className="route-map" role="region" aria-label="Google map of the route. Select numbered checkpoints, or use the checkpoint list below." />
    {mapError && <div className="map-empty"><span className="mini-label">GOOGLE MAPS</span><h2>The map needs an API key.</h2><p>{mapError}</p></div>}
    {!mapError && !route && !(originPlace?.coordinates && destinationPlace?.coordinates) && <div className="map-empty"><span className="mini-label">GOOGLE MAPS</span><h2>A little foresight.<br />A better drive.</h2><p>Choose a starting point and a destination anywhere, then analyze the trip.</p></div>}
    <div className="map-legend" aria-label="Exposure legend">{Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}</div>
  </div>
}

function LeafletRouteMap({ route, candidate, selectedPoint, onSelect, origin, destination }) {
  const container = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)
  const highlight = useRef(null)
  const [tileIssue, setTileIssue] = useState(false)

  useEffect(() => {
    const instance = L.map(container.current, { zoomControl: false, scrollWheelZoom: false }).setView([40.7, -82.4], 7)
    map.current = instance
    L.control.zoom({ position: 'bottomright' }).addTo(instance)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18,
    }).on('tileerror', () => setTileIssue(true)).addTo(instance)
    layers.current = L.layerGroup().addTo(instance)
    highlight.current = L.layerGroup().addTo(instance)
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
    route.checkpoints.forEach((point, index) => {
      const level = candidate.checkpoints[index].level
      const endpoint = index === 0 || index === route.checkpoints.length - 1
      const marker = L.marker(latLng(point.coordinates), {
        icon: L.divIcon({ className: 'checkpoint-marker', html: `<span class="map-dot ${level} ${endpoint ? 'endpoint' : ''}">${endpoint ? (index === 0 ? 'A' : 'B') : index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: `Checkpoint ${index + 1}: ${LEVELS[level].label}`, keyboard: true,
      }).on('click', () => onSelect(index)).addTo(layers.current)
      if (endpoint) {
        const label = document.createElement('span')
        label.textContent = index === 0 ? origin : destination
        marker.bindTooltip(label, { permanent: true, direction: index === 0 ? 'left' : 'right', className: 'city-label', offset: [10, 0] })
      }
    })
  }, [route, candidate, onSelect, origin, destination])

  useEffect(() => {
    if (!highlight.current) return
    highlight.current.clearLayers()
    const point = route?.checkpoints[selectedPoint]
    if (point) L.circleMarker(latLng(point.coordinates), { radius: 19, weight: 2, color: '#203f31', fill: false, interactive: false }).addTo(highlight.current)
  }, [selectedPoint, route])

  return <div className="map-wrap">
    <div ref={container} className="route-map" role="region" aria-label="Interactive route map. Select numbered checkpoints, or use the checkpoint list below." />
    {!route && <div className="map-empty"><span className="mini-label">OHIO WEATHER CORRIDOR</span><h2>A little foresight.<br />A better drive.</h2><p>Plan a trip to see conditions along the way.</p></div>}
    {tileIssue && <p className="tile-warning" role="status">Some map tiles are unavailable. Checkpoints and route geometry remain interactive.</p>}
    <div className="map-legend" aria-label="Exposure legend">{Object.entries(LEVELS).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}</span>)}</div>
  </div>
}

export default function RouteMap(props) {
  return mapsKey() ? <GoogleRouteMap {...props} /> : <LeafletRouteMap {...props} />
}

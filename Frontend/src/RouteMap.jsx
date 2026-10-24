import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LEVELS } from './format.js'

const latLng = coordinates => [coordinates[1], coordinates[0]]

export default function RouteMap({ route, candidate, selectedPoint, onSelect, origin, destination }) {
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

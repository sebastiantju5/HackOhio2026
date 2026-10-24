import { useEffect, useRef } from 'react'
import { loadGoogleMaps } from './googleMaps.js'

export default function PlaceField({ hint, value, disabled, onText, onPlace }) {
  const input = useRef(null)
  const widget = useRef(null)
  const onTextRef = useRef(onText)
  const onPlaceRef = useRef(onPlace)
  onTextRef.current = onText
  onPlaceRef.current = onPlace

  useEffect(() => {
    if (input.current && document.activeElement !== input.current && input.current.value !== value) {
      input.current.value = value
    }
  }, [value])

  useEffect(() => {
    if (disabled) return undefined
    let cancelled = false
    loadGoogleMaps().then((google) => {
      if (cancelled || !input.current || widget.current) return
      const autocomplete = new google.maps.places.Autocomplete(input.current, {
        fields: ['formatted_address', 'geometry', 'name'],
        types: ['geocode'],
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const location = place.geometry?.location
        if (!location) return
        const name = (place.formatted_address || place.name || '').slice(0, 180)
        if (input.current) input.current.value = name
        onTextRef.current(name)
        onPlaceRef.current({ name, coordinates: [location.lng(), location.lat()] })
      })
      widget.current = autocomplete
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [disabled])

  return (
    <label className="capsule-input-pair">
      <span className="field-hint">{hint}</span>
      <input
        ref={input}
        type="text"
        defaultValue={value}
        disabled={disabled}
        autoComplete="off"
        placeholder="City, address, or place"
        onChange={(event) => onText(event.target.value)}
      />
    </label>
  )
}

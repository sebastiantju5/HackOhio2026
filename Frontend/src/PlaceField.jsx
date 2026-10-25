import { useEffect, useRef, useState } from 'react'
import { isGoogleMapsAuthFailed, loadGoogleMaps, searchPlaceSuggestions } from './googleMaps.js'

export default function PlaceField({ hint, value, disabled, onText, onPlace }) {
  const input = useRef(null)
  const widget = useRef(null)
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const debounceTimer = useRef(null)
  const containerRef = useRef(null)

  const onTextRef = useRef(onText)
  const onPlaceRef = useRef(onPlace)

  useEffect(() => {
    onTextRef.current = onText
    onPlaceRef.current = onPlace
  }, [onText, onPlace])

  useEffect(() => {
    if (input.current && document.activeElement !== input.current && input.current.value !== value) {
      input.current.value = value
    }
  }, [value])

  // Try Google Maps Autocomplete if key is available and working
  useEffect(() => {
    if (disabled || isGoogleMapsAuthFailed()) return undefined
    let cancelled = false
    loadGoogleMaps().then((google) => {
      if (cancelled || !input.current || widget.current || isGoogleMapsAuthFailed()) return
      try {
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
          setOpen(false)
          onTextRef.current(name)
          onPlaceRef.current({ name, coordinates: [location.lng(), location.lat()] })
        })
        widget.current = autocomplete
      } catch {
        // Legacy autocomplete disabled; fallback suggestions handle search
      }
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [disabled])

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleInputChange(event) {
    const text = event.target.value
    onText(text)
    clearTimeout(debounceTimer.current)

    if (text.trim().length >= 2) {
      debounceTimer.current = setTimeout(async () => {
        const results = await searchPlaceSuggestions(text)
        setSuggestions(results)
        setOpen(results.length > 0)
        setHighlighted(-1)
      }, 250)
    } else {
      setSuggestions([])
      setOpen(false)
    }
  }

  function handleSelectSuggestion(suggestion) {
    const name = suggestion.name
    if (input.current) input.current.value = name
    setOpen(false)
    onText(name)
    if (suggestion.coordinates) {
      onPlace({ name, coordinates: suggestion.coordinates })
    }
  }

  function handleKeyDown(event) {
    if (!open || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((prev) => (prev + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1))
    } else if (event.key === 'Enter') {
      if (highlighted >= 0 && highlighted < suggestions.length) {
        event.preventDefault()
        handleSelectSuggestion(suggestions[highlighted])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="place-field-wrapper">
      <label className="capsule-input-pair">
        <span className="field-hint">{hint}</span>
        <input
          ref={input}
          type="text"
          defaultValue={value}
          disabled={disabled}
          autoComplete="off"
          placeholder="City, address, or place"
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
        />
      </label>

      {open && suggestions.length > 0 && (
        <ul className="place-suggestions-menu" role="listbox">
          {suggestions.map((item, index) => (
            <li
              key={index}
              role="option"
              aria-selected={highlighted === index}
              className={`place-suggestion-item ${highlighted === index ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelectSuggestion(item)
              }}
            >
              <span className="suggestion-marker" aria-hidden="true">📍</span>
              <div className="suggestion-text">
                <span className="suggestion-main">{item.mainText}</span>
                {item.secondaryText && <span className="suggestion-sub">{item.secondaryText}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

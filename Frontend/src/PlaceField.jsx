import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from './googleMaps.js'

function suggestionLabel(suggestion) {
  const prediction = suggestion.placePrediction
  const text = prediction?.text
  return (text?.text || prediction?.mainText?.text || '').trim()
}

export default function PlaceField({ hint, value, disabled, onText, onPlace }) {
  const input = useRef(null)
  const session = useRef(null)
  const requestId = useRef(0)
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (input.current && document.activeElement !== input.current && input.current.value !== value) {
      input.current.value = value
    }
  }, [value])

  useEffect(() => () => {
    requestId.current += 1
  }, [])

  async function search(text) {
    const id = ++requestId.current
    if (text.trim().length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    try {
      const google = await loadGoogleMaps()
      const { AutocompleteSuggestion } = await google.maps.importLibrary('places')
      if (!session.current) session.current = new google.maps.places.AutocompleteSessionToken()
      const { suggestions: next } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        sessionToken: session.current,
      })
      if (id !== requestId.current) return
      setSuggestions(next || [])
      setOpen(Boolean(next?.length))
    } catch {
      if (id === requestId.current) {
        setSuggestions([])
        setOpen(false)
      }
    }
  }

  async function choose(suggestion) {
    const prediction = suggestion.placePrediction
    if (!prediction) return
    const place = prediction.toPlace()
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
    session.current = null
    const location = place.location
    if (!location) return
    const name = (place.formattedAddress || place.displayName || suggestionLabel(suggestion)).slice(0, 180)
    if (input.current) input.current.value = name
    onText(name)
    onPlace({ name, coordinates: [location.lng(), location.lat()] })
    setSuggestions([])
    setOpen(false)
  }

  return (
    <label className="capsule-input-pair place-field">
      <span className="field-hint">{hint}</span>
      <input
        ref={input}
        type="text"
        defaultValue={value}
        disabled={disabled}
        autoComplete="off"
        placeholder="City, address, or place"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(event) => {
          onText(event.target.value)
          window.clearTimeout(input.current._searchTimer)
          input.current._searchTimer = window.setTimeout(() => search(event.target.value), 200)
        }}
        onFocus={(event) => {
          if (suggestions.length) setOpen(true)
          else if (event.target.value.trim().length >= 2) search(event.target.value)
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="place-suggestions" role="listbox">
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestionLabel(suggestion)}-${index}`}>
              <button
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
              >
                {suggestionLabel(suggestion)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  )
}

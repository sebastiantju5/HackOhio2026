import { useEffect, useRef, useState } from 'react'
import './VehicleProfile.css'

const empty = { year: '', make: '', model: '', mpg: '', tankGallons: '', fuelType: 'Regular Gasoline' }

export async function vehicleRequest(token, method = 'GET', body) {
  const response = await fetch('/api/account/vehicle', {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not access your vehicle.')
  return data.vehicle || null
}

export default function VehicleProfile({ session, vehicle, onChange, loadError }) {
  const [form, setForm] = useState(vehicle || empty)
  const [options, setOptions] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const lookup = useRef(0)
  useEffect(() => { setForm(vehicle || empty) }, [vehicle])
  useEffect(() => () => { lookup.current += 1 }, [])

  function edit(field, value) {
    lookup.current += 1
    setError('')
    setMessage('')
    setOptions([])
    setForm(current => ({ ...current, [field]: value, epaId: null, mpg: '', tankGallons: '', configuration: '', tankSource: '' }))
  }

  async function fetchRating(id) {
    const version = ++lookup.current
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/vehicles/estimate/${encodeURIComponent(id)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load the MPG rating.')
      if (version === lookup.current) setForm(current => ({ ...current, ...data.vehicle, tankGallons: data.vehicle.tankGallons || '' }))
    } catch (err) {
      if (version === lookup.current) setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function lookupMpg() {
    const version = ++lookup.current
    setBusy(true)
    setError('')
    setMessage('')
    setOptions([])
    try {
      const query = new URLSearchParams({ year: form.year, make: form.make.trim(), model: form.model.trim() })
      const response = await fetch(`/api/vehicles/options?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'EPA lookup is unavailable.')
      if (version !== lookup.current) return
      if (!data.options.length) throw new Error('No EPA match. Check the year and make, and use the model name without a trim, such as Civic or F150.')
      setOptions(data.options)
      if (data.options.length === 1) await fetchRating(data.options[0].id)
    } catch (err) {
      if (version === lookup.current) setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const saved = await vehicleRequest(session.token, 'PUT', {
        year: Number(form.year),
        make: form.make.trim(),
        model: form.model.trim(),
        fuelType: form.fuelType,
        epaId: form.epaId,
      })
      onChange(saved)
      setMessage('Car saved to your account.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await vehicleRequest(session.token, 'DELETE')
      onChange(null)
      setForm(empty)
      setOptions([])
      setMessage('Car removed.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="vehicle-profile" aria-labelledby="vehicle-title">
    <h3 id="vehicle-title">Your car</h3>
    <p>Used to estimate fuel cost and plan fuel stops.</p>
    {loadError && !vehicle && <p role="status">{loadError}</p>}
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="vehicle-grid">
          <label>Year<input required type="number" min="1984" max={new Date().getFullYear() + 1} value={form.year} onChange={e => edit('year', e.target.value)} placeholder="2020" /></label>
          <label>Make<input required maxLength="100" value={form.make} onChange={e => edit('make', e.target.value)} placeholder="Toyota" /></label>
          <label>Model<input required maxLength="100" value={form.model} onChange={e => edit('model', e.target.value)} placeholder="Camry" /></label>
        </div>
        <button type="button" className="vehicle-secondary" onClick={lookupMpg} disabled={!form.year || !form.make.trim() || !form.model.trim()}>Look up mileage</button>
        {options.length > 1 && <label>Engine & transmission<select aria-label="Engine & transmission" value={form.epaId || ''} onChange={e => fetchRating(e.target.value)}><option value="" disabled>Choose a configuration</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        {options.length > 1 && !form.epaId && <p className="vehicle-source">Choose the engine and transmission to enable saving.</p>}
        {form.mpg && <div className="vehicle-specs" aria-live="polite">
          <p>Highway MPG<strong>{form.mpg}</strong></p>
          <p>Tank size<strong>{form.tankGallons ? `${form.tankGallons} US gal` : 'Not published'}</strong></p>
        </div>}
        {form.mpg && <p className="vehicle-source">{form.configuration} · {form.fuelType}</p>}
        {form.mpg && !form.tankGallons && <p className="vehicle-source">No published driving range for this car, so fuel-range stops stay off.</p>}
        <div className="vehicle-actions"><button className="vehicle-primary" type="submit" disabled={!form.epaId}>{busy ? 'Working…' : 'Save car'}</button>{vehicle && <button className="vehicle-secondary" type="button" onClick={remove}>Remove car</button>}</div>
      </fieldset>
    </form>
    {error && <p className="vehicle-error" role="alert">{error}</p>}
    {message && <p className="vehicle-success" role="status">{message}</p>}
    <p className="vehicle-source">Highway MPG from <a href="https://www.fueleconomy.gov/feg/Find.do?action=sbsSelect" target="_blank" rel="noreferrer">FuelEconomy.gov</a>. Gas and diesel only.</p>
  </section>
}

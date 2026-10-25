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
    setError(''); setMessage('')
    if (['year', 'make', 'model'].includes(field)) {
      setOptions([])
      setForm(current => ({ ...current, [field]: value, epaId: null, mpg: '', configuration: '' }))
    } else setForm(current => ({ ...current, [field]: value }))
  }

  async function fetchRating(id) {
    const version = ++lookup.current
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/vehicles/estimate/${encodeURIComponent(id)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load the MPG rating.')
      if (version === lookup.current) setForm(current => ({ ...current, ...data.vehicle }))
    } catch (err) { if (version === lookup.current) setError(err.message) }
    finally { setBusy(false) }
  }

  async function lookupMpg() {
    const version = ++lookup.current
    setBusy(true); setError(''); setMessage(''); setOptions([])
    try {
      const query = new URLSearchParams({ year: form.year, make: form.make.trim(), model: form.model.trim() })
      const response = await fetch(`/api/vehicles/options?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'EPA lookup is unavailable.')
      if (version !== lookup.current) return
      if (!data.options.length) throw new Error('No EPA match. Check the model name or enter your highway MPG below.')
      setOptions(data.options)
      if (data.options.length === 1) await fetchRating(data.options[0].id)
    } catch (err) { if (version === lookup.current) setError(err.message) }
    finally { setBusy(false) }
  }

  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const saved = await vehicleRequest(session.token, 'PUT', { ...form,
        year: Number(form.year), mpg: Number(form.mpg), tankGallons: Number(form.tankGallons) })
      onChange(saved); setMessage('Car saved to your account.')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError('')
    try { await vehicleRequest(session.token, 'DELETE'); onChange(null); setForm(empty); setOptions([]); setMessage('Car removed.') }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <section className="vehicle-profile" aria-labelledby="vehicle-title">
    <p className="eyebrow">YOUR GARAGE</p><h3 id="vehicle-title">A better plan for your car.</h3>
    <p>Save your car for fuel estimates and weather-aware breaks. Choose the exact engine and transmission for an EPA rating.</p>
    {loadError && !vehicle && <p role="status">{loadError}</p>}
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="vehicle-grid">
          <label>Year<input required type="number" min="1984" max={new Date().getFullYear() + 1} value={form.year} onChange={e => edit('year', e.target.value)} placeholder="2020" /></label>
          <label>Make<input required maxLength="100" value={form.make} onChange={e => edit('make', e.target.value)} placeholder="Toyota" /></label>
          <label>Model<input required maxLength="100" value={form.model} onChange={e => edit('model', e.target.value)} placeholder="Camry" /></label>
        </div>
        <button type="button" className="vehicle-secondary" onClick={lookupMpg} disabled={!form.year || !form.make.trim() || !form.model.trim()}>Look up EPA mileage ↗</button>
        {options.length > 0 && <label>Engine & transmission<select aria-label="Engine & transmission" value={form.epaId || ''} onChange={e => fetchRating(e.target.value)}><option value="" disabled>Choose a configuration</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
        <div className="vehicle-grid vehicle-grid-two">
          <label>Highway MPG<input required type="number" min="5" max="150" step="0.1" value={form.mpg} readOnly={!!form.epaId} onChange={e => edit('mpg', e.target.value)} placeholder="Your estimate" /></label>
          <label>Tank size · US gal<input required type="number" min="1" max="80" step="0.1" value={form.tankGallons} onChange={e => edit('tankGallons', e.target.value)} placeholder="From owner's manual" /></label>
        </div>
        <p className="vehicle-source">{form.epaId ? `${form.mpgSource} · ${form.configuration}` : 'Manual MPG estimate. Tank capacity must come from your vehicle specification.'} {form.epaId && <button type="button" onClick={() => { lookup.current += 1; setForm(current => ({ ...current, epaId: null })); setOptions([]) }}>Use my own MPG</button>}</p>
        {!form.epaId && <label>Fuel<select value={form.fuelType} onChange={e => edit('fuelType', e.target.value)}>{['Regular Gasoline', 'Premium Gasoline', 'Midgrade Gasoline', 'Diesel'].map(fuel => <option key={fuel}>{fuel}</option>)}</select></label>}
        <div className="vehicle-actions"><button className="vehicle-primary" type="submit">{busy ? 'Working…' : 'Save car'}</button>{vehicle && <button className="vehicle-secondary" type="button" onClick={remove}>Remove car</button>}</div>
      </fieldset>
    </form>
    {error && <p className="vehicle-error" role="alert">{error}</p>}
    {message && <p className="vehicle-success" role="status">{message}</p>}
    <p className="vehicle-source"><a href="https://www.fueleconomy.gov/feg/Find.do?action=sbsSelect" target="_blank" rel="noreferrer">EPA / FuelEconomy.gov</a> · Gasoline and diesel only. Real mileage varies.</p>
  </section>
}

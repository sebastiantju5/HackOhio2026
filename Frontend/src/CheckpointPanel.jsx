import { LEVELS, clock, day, miles } from './format.js'

export default function CheckpointPanel({ checkpoint, condition, source, timeZone }) {
  if (!checkpoint || !condition) return null
  const weather = condition.weather
  const number = (value, transform = value => value) => Number.isFinite(value) ? Math.round(transform(value)) : '—'
  return <aside className="checkpoint-panel" aria-label="Selected checkpoint details">
    <span className="mini-label">AT YOUR ARRIVAL</span>
    <div className="checkpoint-heading"><span className="checkpoint-number">{String(checkpoint.index + 1).padStart(2, '0')}</span><div><h2>Mile {miles(checkpoint.distanceMeters)}</h2><p>{day(condition.arrival, timeZone)} · {clock(condition.arrival, timeZone)} ET</p></div></div>
    <span className={`exposure-tag ${condition.level}`}><i />{LEVELS[condition.level].label}</span>
    <dl className="weather-values">
      <div><dt>Rain intensity</dt><dd>{number(weather?.rainMmPerHour)} <small>mm/h</small></dd></div>
      <div><dt>Crosswind gust*</dt><dd>{number(weather?.crosswindGustKph, value => value / 1.609344)} <small>mph</small></dd></div>
      <div><dt>Visibility</dt><dd>{Number.isFinite(weather?.visibilityM) ? (weather.visibilityM / 1609.344).toFixed(1) : '—'} <small>mi</small></dd></div>
      <div><dt>Air temperature</dt><dd>{number(weather?.temperatureC, value => value * 9 / 5 + 32)}<small> °F</small></dd></div>
    </dl>
    <div className="checkpoint-reasons">{condition.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    <p className="data-footnote">*Gust projected across the road using mean wind direction. Not a measurement at road level.</p>
    <details className="provenance"><summary>Forecast source & timing</summary><p>{source?.provider}<br />{source?.model}</p>{weather?.validEnd && <p>Precipitation interval: {clock(weather.validStart, timeZone)}–{clock(weather.validEnd, timeZone)} ET, {day(weather.validEnd, timeZone)}.</p>}<p>{source?.retrievedAt ? `Retrieved ${day(source.retrievedAt, timeZone)}, ${clock(source.retrievedAt, timeZone)} ET.` : 'Authored simulation. No observed or live forecast data.'}</p><p>{source?.note}</p>{checkpoint.forecastGridCoordinates && <p>Forecast grid: {checkpoint.forecastGridCoordinates.map(value => Number(value).toFixed(3)).join(', ')} (lon, lat).</p>}</details>
  </aside>
}

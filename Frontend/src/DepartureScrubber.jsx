import { LEVELS, clock, day } from './format.js'

export default function DepartureScrubber({ candidates, selectedIndex, onChange, recommendedId, timeZone }) {
  const selected = candidates[selectedIndex]
  if (!selected) return null
  return <section className="scrubber" aria-label="Departure comparison">
    <div className="scrubber-title"><div><span className="mini-label">SHIFT YOUR DEPARTURE</span><h2>Find your weather window.</h2></div><div className="departure-value"><span>Leave {day(selected.departure, timeZone)}</span><strong>{clock(selected.departure, timeZone)}</strong></div></div>
    <div className="departure-bars" aria-label="Exposure by departure time">{candidates.map((candidate, index) => <button key={candidate.id} type="button" className={`departure-bar ${candidate.level} ${index === selectedIndex ? 'chosen' : ''}`} onClick={() => onChange(index)} aria-label={`Depart ${clock(candidate.departure, timeZone)}, ${LEVELS[candidate.level].label}, ${candidate.higherMinutes} higher-exposure minutes`} aria-pressed={index === selectedIndex} title={`${clock(candidate.departure, timeZone)} · ${LEVELS[candidate.level].label}`}>
      <span style={{ height: `${24 + Math.min(76, candidate.weightedExposure / 3)}%` }} />{candidate.id === recommendedId && <i aria-hidden="true" />}
    </button>)}</div>
    <label className="sr-only" htmlFor="departure-slider">Departure time, in five-minute steps</label>
    <input id="departure-slider" type="range" min="0" max={Math.max(0, candidates.length - 1)} step="1" value={selectedIndex} disabled={candidates.length === 1} onChange={event => onChange(Number(event.target.value))} aria-valuetext={`${clock(selected.departure, timeZone)}; ${LEVELS[selected.level].label}`} />
    <div className="scrubber-labels"><span>{clock(candidates[0].departure, timeZone)}</span><span>5-minute steps · Eastern time</span><span>{clock(candidates.at(-1).departure, timeZone)}</span></div>
  </section>
}

import { clock } from './format.js'
import { stopKind } from './stopPresentation.js'
import './AddedStops.css'

export default function AddedStops({ entries, timeZone, onShow, onRemove, onClear }) {
  return (
    <section className="added-stops" aria-labelledby="added-stops-title">
      <div className="added-stops-heading">
        <div>
          <span className="journey-kicker">YOUR PICKS</span>
          <h3 id="added-stops-title">Added stops</h3>
        </div>
        {entries.length > 0 && <button type="button" className="added-stops-clear" onClick={onClear}>Clear all</button>}
      </div>
      {entries.length === 0 ? (
        <p className="added-stops-empty">Stops and restaurants you click in the journey agent’s answers will be collected here.</p>
      ) : (
        <ol className="added-stops-list">
          {entries.map(entry => (
            <li key={entry.key}>
              <button type="button" className="added-stop-main" onClick={() => onShow(entry)}>
                <strong>{stopKind(entry.stop)} · Mile {entry.stop.mile}</strong>
                <span>{clock(entry.stop.arrival, timeZone)}–{clock(entry.stop.resume, timeZone)} · {entry.stop.durationMinutes} min</span>
                {['fuel', 'restaurant'].map(kind => entry.places?.[kind] && (
                  <span className="added-stop-place" key={kind}>
                    {kind === 'fuel' ? 'Gas' : 'Food'}: {entry.places[kind].name}{entry.places[kind].address ? ` · ${entry.places[kind].address}` : ''}
                  </span>
                ))}
              </button>
              <button type="button" className="added-stop-remove" aria-label={`Remove stop at mile ${entry.stop.mile}`} onClick={() => onRemove(entry.key)}>×</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

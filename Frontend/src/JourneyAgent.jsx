import { useEffect, useRef, useState } from 'react'
import { clock } from './format.js'
import { journeyPlans, planMatchesSelection, stopLabel } from './stopPresentation.js'
import { defaultFuelGrade, FUEL_GRADES } from './fuelPrices.js'
import './JourneyAgent.css'

const SUGGESTIONS = ['Would a food break help avoid the rain?', 'Can I finish with this fuel?', 'Explain the forecast uncertainty.']

export default function JourneyAgent({ analysis, candidate, session, vehicle, route, onAccount, onApply, onShowStop, appliedPlan }) {
  const [config, setConfig] = useState(null)
  const [question, setQuestion] = useState('')
  const [startingFuel, setStartingFuel] = useState(75)
  const [budget, setBudget] = useState(60)
  const [preferCheaperGas, setPreferCheaperGas] = useState(false)
  const [fuelGradeOverride, setFuelGradeOverride] = useState(null)
  const fuelGrade = fuelGradeOverride || defaultFuelGrade(vehicle)
  const [turns, setTurns] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/journey/config', { signal: controller.signal }).then(r => r.json()).then(setConfig).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    request.current?.abort(); setTurns([]); setError(''); setBusy(false)
    return () => request.current?.abort()
  }, [analysis.analysisId, candidate.id, session?.token, startingFuel, budget, preferCheaperGas, fuelGrade])

  async function ask(event, directQuestion) {
    event?.preventDefault()
    const controller = new AbortController(); request.current = controller
    const prompt = (directQuestion || question).trim()
    if (prompt.length < 3) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/journey/chat', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ analysisId: analysis.analysisId, candidateId: candidate.id, question: prompt,
          startingFuel: startingFuel / 100, maxStopMinutes: Number(budget), preferCheaperGas, fuelGrade }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'The journey agent is unavailable. Please try again.')
      if (!controller.signal.aborted) {
        setTurns(current => [...current.slice(-3), { question: prompt, ...data }])
        setQuestion('')
        const options = journeyPlans(data).filter(plan => planMatchesSelection(plan, analysis.analysisId, candidate, route))
        const selected = data.plan || (options.length === 1 ? options[0] : null)
        if (selected?.stops.length > 0) onApply(selected)
      }
    } catch (err) { if (err.name !== 'AbortError') setError(err.message) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="journey-agent" aria-labelledby="journey-title">
    <div className="journey-heading"><div><span className="journey-kicker">YOUR JOURNEY, WITH CONTEXT</span><h3 id="journey-title">Ask the road ahead.</h3><p>Ask about your {clock(candidate.departure, analysis.timeZone)} departure. Answers use this trip’s forecast, computed stop options and cited travel guidance.</p></div><span className="journey-tag">JOURNEY AGENT · RAG</span></div>
    {!session ? <div className="journey-gate"><p>Sign in to ask the journey agent and use your saved car’s fuel specifications.</p><button type="button" onClick={onAccount}>Sign in to ask ↗</button></div> : config && !config.configured ? <p className="journey-error" role="status">The journey agent is not configured on this server yet. Trip and stop planning remain available.</p> : <>
      <div className="journey-preferences">
        {vehicle ? <label>Starting tank · {startingFuel}%<input aria-label="Journey starting tank percentage" type="range" min="5" max="100" step="5" value={startingFuel} disabled={busy} onChange={e => { if (appliedPlan?.journeyPlanId) onApply(null); setStartingFuel(Number(e.target.value)) }} /></label> : <p>No saved car. Weather and food questions work; fuel estimates need a car in Profile.</p>}
        <label>Maximum total break time<select aria-label="Journey stop budget" value={budget} disabled={busy} onChange={e => { if (appliedPlan?.journeyPlanId) onApply(null); setBudget(Number(e.target.value)) }}>{[0, 15, 30, 45, 60, 90].map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
        <label className="journey-price-choice"><span><input type="checkbox" checked={preferCheaperGas} disabled={busy} onChange={event => { if (appliedPlan?.journeyPlanId) onApply(null); setPreferCheaperGas(event.target.checked) }} /> Prefer cheaper gas</span><small>Compare reported prices at planned fuel stops. Availability varies.</small></label>
        <label>Fuel grade for price comparison<select aria-label="Journey fuel grade" disabled={busy || !preferCheaperGas} value={fuelGrade} onChange={event => { if (appliedPlan?.journeyPlanId) onApply(null); setFuelGradeOverride(event.target.value) }}>{Object.entries(FUEL_GRADES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      <div className="journey-suggestions">{SUGGESTIONS.map(text => <button key={text} type="button" disabled={busy} onClick={() => setQuestion(text)}>{text}</button>)}<button type="button" disabled={busy} onClick={() => { if (appliedPlan?.journeyPlanId) onApply(null); setPreferCheaperGas(true); setQuestion('Plan my needed refueling stops and help me compare cheaper gas options near them.') }}>Find cheaper gas for my trip</button></div>
      <button type="button" disabled={busy || !config?.configured} onClick={event => ask(event, 'Use the existing optimizer to recommend fuel, food or weather stops for this route within my selected break budget. Show the best computed stop plan on the map.')}>Plan stops & show on map →</button>
      <form className="journey-form" onSubmit={ask}>
        <label className="sr-only" htmlFor="journey-question">Your trip question</label>
        <textarea id="journey-question" required minLength="3" maxLength="1200" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} placeholder="Could I take a food break before the heavy rain?" rows="3" />
        <div className="journey-submit"><small>Your question, selected trip and fuel specs are sent to OpenRouter. Account identity is excluded.</small><button type="submit" disabled={busy || !config?.configured || question.trim().length < 3}>{busy ? 'Checking trip & guidance…' : 'Ask journey agent →'}</button></div>
      </form>
    </>}
    {error && <p className="journey-error" role="alert">{error}</p>}
    <div className="journey-conversation" aria-live="polite" aria-busy={busy}>
      {turns.map((turn, index) => <article className="journey-turn" key={`${turn.candidateId}-${index}`}>
        <p className="journey-user-question">{turn.question}</p>
        <p className="journey-answer">{turn.answer}</p>
        <div className="journey-answer-meta">{turn.dataMode === 'demo' ? 'SIMULATED TRIP' : 'LIVE FORECAST SNAPSHOT'} · {turn.model}</div>
        {journeyPlans(turn).map((plan, planIndex) => <div className="journey-computed-plan" key={plan.journeyPlanId}><strong>Computed stop option{journeyPlans(turn).length > 1 ? ` ${planIndex + 1}` : ''}</strong>{plan.status === 'planned' ? <><p>{plan.totalStopMinutes} min of breaks · arrival {clock(plan.arrival, analysis.timeZone)} before detours · {plan.higherMinutes} higher-exposure driving minutes.</p>{plan.stops.length > 0 ? <><p>{appliedPlan?.journeyPlanId === plan.journeyPlanId ? 'Shown on the map above. Select a stop to zoom in.' : 'Select this option to show its computed stops on the map.'}</p><div className="journey-map-stop-list">{plan.stops.map((stop, stopIndex) => <button type="button" key={stopIndex} onClick={() => onShowStop(plan, stopIndex)}>Show {stopLabel(stop, stopIndex, analysis.timeZone)} on map ↑</button>)}</div><button type="button" onClick={() => onApply(appliedPlan?.journeyPlanId === plan.journeyPlanId ? null : plan)}>{appliedPlan?.journeyPlanId === plan.journeyPlanId ? 'Hide agent stops' : 'Show all agent stops on map ↑'}</button></> : <p>The optimizer recommends no stops within this budget. No stop locations have been invented.</p>}<small>Timing is optimized for the selected route and departure. Nearby venue options can be inspected below the map; detours and opening hours are unverified.</small></> : <p>{plan.reason}</p>}</div>)}
        <details className="journey-evidence"><summary>Sources & retrieved evidence ({turn.citations.length})</summary>{turn.citations.map(source => <div key={source.id}><strong>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : source.title}</strong><p>{source.text}</p></div>)}</details>
        <details className="journey-evidence"><summary>Tool activity & retrieval</summary><ol>{turn.trace.map((step, stepIndex) => <li key={stepIndex}><strong>{step.tool}</strong> — {step.detail}</li>)}</ol><p>{turn.retrievalMethod} retrieval · knowledge version {turn.knowledgeVersion} · {turn.usage.total_tokens} model tokens.</p></details>
      </article>)}
    </div>
  </section>
}

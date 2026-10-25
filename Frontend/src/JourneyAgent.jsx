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
  const [pendingTurn, setPendingTurn] = useState(null)
  const [error, setError] = useState('')
  const request = useRef(null)
  const conversationRef = useRef(null)

  const resetKey = `${analysis.analysisId}:${candidate.id}:${session?.token}`
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setTurns([])
    setError('')
    setBusy(false)
    setPendingTurn(null)
  }

  useEffect(() => {
    return () => {
      request.current?.abort()
    }
  }, [resetKey])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/journey/config', { signal: controller.signal })
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }, [turns, pendingTurn, busy])

  function applyComputedPlan(turnData) {
    const options = journeyPlans(turnData).filter(plan => planMatchesSelection(plan, analysis.analysisId, candidate, route))
    const selected = turnData.plan || (options.length === 1 ? options[0] : null)
    if (selected?.status === 'planned' && Array.isArray(selected.stops) && selected.stops.length === 0 && selected.stopsModified) {
      onApply(null)
    } else if (selected?.stops?.length > 0) {
      onApply(selected)
    }
  }

  async function ask(event, directQuestion, overrides = {}) {
    event?.preventDefault()
    const prompt = (directQuestion || question).trim()
    if (prompt.length < 3 || busy) return

    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setQuestion('')
    setPendingTurn({
      question: prompt,
      answer: '',
      phase: 'thinking',
      thinkingStatus: 'Thinking & checking your route…',
    })

    try {
      const response = await fetch('/api/journey/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          analysisId: analysis.analysisId,
          candidateId: candidate.id,
          question: prompt,
          startingFuel: startingFuel / 100,
          maxStopMinutes: Number(budget),
          preferCheaperGas: overrides.preferCheaperGas ?? preferCheaperGas,
          fuelGrade,
          stream: true,
          currentStops: Array.isArray(appliedPlan?.stops)
            ? appliedPlan.stops.map(s => ({
                checkpointIndex: s.checkpointIndex,
                durationMinutes: s.durationMinutes,
                fuel: Boolean(s.fuel),
                food: Boolean(s.food),
                weatherBreak: Boolean(s.weatherBreak),
              }))
            : [],
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'The journey agent is unavailable. Please try again.')
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulatedAnswer = ''
        let finalized = false
        let currentEventType = ''
        let currentDataLines = []

        const scrollBottom = () => {
          if (conversationRef.current) {
            conversationRef.current.scrollTop = conversationRef.current.scrollHeight
          }
        }

        const handleEvent = (parsed) => {
          if (!parsed || finalized) return

          if (parsed.type === 'error' || parsed.error) {
            setError(parsed.error || 'The journey agent encountered an error.')
            setPendingTurn(null)
            finalized = true
            return
          }

          if (parsed.type === 'thinking' || parsed.phase === 'thinking') {
            const status = parsed.message || parsed.status || 'Thinking & checking your route…'
            setPendingTurn(curr => curr ? { ...curr, phase: 'thinking', thinkingStatus: status } : null)
            scrollBottom()
            return
          }

          if (parsed.type === 'tool' || parsed.phase === 'tool') {
            const status = parsed.message || parsed.status || parsed.detail || (parsed.tool ? `Checking ${parsed.tool}…` : 'Checking route options…')
            setPendingTurn(curr => curr ? { ...curr, phase: 'tool', thinkingStatus: status } : null)
            scrollBottom()
            return
          }

          if (parsed.type === 'status' || parsed.status || (parsed.message && !parsed.delta && !parsed.answer)) {
            const statusText = parsed.status || parsed.message
            setPendingTurn(curr => curr ? { ...curr, thinkingStatus: statusText } : null)
            scrollBottom()
            return
          }

          if (parsed.type === 'delta' || parsed.delta !== undefined) {
            const delta = parsed.delta?.content ?? (typeof parsed.delta === 'string' ? parsed.delta : (parsed.choices?.[0]?.delta?.content ?? ''))
            if (delta) {
              accumulatedAnswer += delta
              const currentText = accumulatedAnswer
              setPendingTurn(curr => curr ? { ...curr, answer: currentText, phase: 'answering' } : null)
              scrollBottom()
            }
            return
          }

          if (parsed.type === 'done' || parsed.done === true) {
            finalized = true
            const payload = parsed.result || parsed.data || parsed
            const finalAnswer = payload.answer || parsed.answer || accumulatedAnswer
            const completedTurn = {
              question: prompt,
              candidateId: candidate.id,
              analysisId: analysis.analysisId,
              model: payload.model || parsed.model || config?.model || 'openrouter/free',
              dataMode: payload.dataMode || parsed.dataMode || analysis.dataMode,
              ...payload,
              answer: finalAnswer,
            }
            setTurns(current => [...current, completedTurn])
            setPendingTurn(null)
            applyComputedPlan(completedTurn)
            scrollBottom()
            return
          }
        }

        const dispatchCurrentEvent = () => {
          if (currentDataLines.length === 0) {
            currentEventType = ''
            return
          }
          const rawData = currentDataLines.join('\n')
          currentDataLines = []
          const eventType = currentEventType
          currentEventType = ''

          if (rawData === '[DONE]') {
            handleEvent({ type: 'done' })
            return
          }

          try {
            const parsed = JSON.parse(rawData)
            if (eventType && !parsed.type) {
              parsed.type = eventType
            }
            handleEvent(parsed)
          } catch {
            if (eventType === 'delta') {
              handleEvent({ type: 'delta', delta: rawData })
            } else if (eventType === 'error') {
              handleEvent({ type: 'error', error: rawData })
            }
          }
        }

        const processLine = (line) => {
          if (line === '') {
            dispatchCurrentEvent()
            return
          }
          if (line.startsWith(':')) {
            return
          }
          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim()
            return
          }
          if (line.startsWith('data:')) {
            const content = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
            currentDataLines.push(content)
            const trimmed = content.trim()
            if (trimmed === '[DONE]' || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
              dispatchCurrentEvent()
            }
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newlineIndex
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            let line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            if (line.endsWith('\r')) line = line.slice(0, -1)
            processLine(line)
          }
        }

        buffer += decoder.decode()
        if (buffer.trim()) {
          processLine(buffer.trim())
        }
        dispatchCurrentEvent()

        if (!finalized && accumulatedAnswer && !controller.signal.aborted) {
          finalized = true
          const completedTurn = {
            question: prompt,
            answer: accumulatedAnswer,
            candidateId: candidate.id,
            analysisId: analysis.analysisId,
            model: config?.model || 'openrouter/free',
            dataMode: analysis.dataMode,
          }
          setTurns(current => [...current, completedTurn])
          setPendingTurn(null)
          applyComputedPlan(completedTurn)
        }
      } else {
        const data = await response.json().catch(() => ({}))
        if (!controller.signal.aborted) {
          const completedTurn = {
            question: prompt,
            candidateId: candidate.id,
            analysisId: analysis.analysisId,
            model: data.model || config?.model || 'openrouter/free',
            dataMode: data.dataMode || analysis.dataMode,
            ...data,
          }
          setTurns(current => [...current, completedTurn])
          setPendingTurn(null)
          applyComputedPlan(completedTurn)
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
        setPendingTurn(null)
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
        setPendingTurn(null)
      }
    }
  }

  return (
    <section className="journey-agent" aria-labelledby="journey-title">
      <div className="journey-heading">
        <div>
          <span className="journey-kicker">YOUR JOURNEY, WITH CONTEXT</span>
          <h3 id="journey-title">Ask the road ahead.</h3>
          <p>Ask about your {clock(candidate.departure, analysis.timeZone)} departure. Answers use this trip’s forecast, computed stop options and cited travel guidance.</p>
        </div>
        <span className="journey-tag">JOURNEY AGENT · RAG</span>
      </div>

      {!session ? (
        <div className="journey-gate">
          <p>Sign in to ask the journey agent and use your saved car’s fuel specifications.</p>
          <button type="button" onClick={onAccount}>Sign in to ask ↗</button>
        </div>
      ) : config && !config.configured ? (
        <p className="journey-error" role="status">The journey agent is not configured on this server yet. Trip and stop planning remain available.</p>
      ) : (
        <>
          <div className="journey-preferences">
            {vehicle ? (
              <label>
                Starting tank · {startingFuel}%
                <input
                  aria-label="Journey starting tank percentage"
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={startingFuel}
                  disabled={busy}
                  onChange={e => {
                    if (appliedPlan?.journeyPlanId) onApply(null)
                    setStartingFuel(Number(e.target.value))
                  }}
                />
              </label>
            ) : (
              <p>No saved car. Weather and food questions work; fuel estimates need a car in Profile.</p>
            )}
            <label>
              Maximum total break time
              <select
                aria-label="Journey stop budget"
                value={budget}
                disabled={busy}
                onChange={e => {
                  if (appliedPlan?.journeyPlanId) onApply(null)
                  setBudget(Number(e.target.value))
                }}
              >
                {[0, 15, 30, 45, 60, 90].map(minutes => (
                  <option key={minutes} value={minutes}>{minutes} minutes</option>
                ))}
              </select>
            </label>
            <label className="journey-price-choice">
              <span>
                <input
                  type="checkbox"
                  checked={preferCheaperGas}
                  disabled={busy}
                  onChange={event => {
                    if (appliedPlan?.journeyPlanId) onApply(null)
                    setPreferCheaperGas(event.target.checked)
                  }}
                />
                {' '}Prefer cheaper gas
              </span>
              <small>Compare reported prices at planned fuel stops. Availability varies.</small>
            </label>
            <label>
              Fuel grade for price comparison
              <select
                aria-label="Journey fuel grade"
                disabled={busy || !preferCheaperGas}
                value={fuelGrade}
                onChange={event => {
                  if (appliedPlan?.journeyPlanId) onApply(null)
                  setFuelGradeOverride(event.target.value)
                }}
              >
                {Object.entries(FUEL_GRADES).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="journey-suggestions">
            {SUGGESTIONS.map(text => (
              <button key={text} type="button" disabled={busy} onClick={() => ask(null, text)}>
                {text}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (appliedPlan?.journeyPlanId) onApply(null)
                setPreferCheaperGas(true)
                ask(null, 'Plan my needed refueling stops and help me compare cheaper gas options near them.', { preferCheaperGas: true })
              }}
            >
              Find cheaper gas for my trip
            </button>
          </div>

          <button
            type="button"
            disabled={busy || !config?.configured}
            onClick={event => ask(event, 'Use the existing optimizer to recommend fuel, food or weather stops for this route within my selected break budget. Show the best computed stop plan on the map.')}
          >
            Plan stops & show on map →
          </button>

          <form className="journey-form" onSubmit={ask}>
            <label className="sr-only" htmlFor="journey-question">Your trip question</label>
            <textarea
              id="journey-question"
              required
              minLength={3}
              maxLength={1200}
              value={question}
              disabled={busy}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Could I take a food break before the heavy rain?"
              rows="3"
            />
            <div className="journey-submit">
              <small>Your question, selected trip and fuel specs are sent to OpenRouter. Account identity is excluded.</small>
              <button type="submit" disabled={busy || !config?.configured || question.trim().length < 3}>
                {busy ? 'Checking trip & guidance…' : 'Ask journey agent →'}
              </button>
            </div>
          </form>
        </>
      )}

      {error && <p className="journey-error" role="alert">{error}</p>}

      <div
        className="journey-conversation"
        ref={conversationRef}
        aria-live="polite"
        aria-busy={busy}
      >
        <div className="journey-scroll-header">
          <span>Model · {config?.model || 'openrouter/free'}</span>
          <span>{analysis.dataMode === 'demo' ? 'Simulated Trip' : 'Live Forecast'}</span>
        </div>

        {turns.length === 0 && !busy && !pendingTurn && (
          <div className="journey-empty-state">
            <p>Ask a question above or tap a quick button to plan your stops.</p>
          </div>
        )}

        {turns.map((turn, index) => (
          <article className="journey-turn" key={`${turn.candidateId || candidate.id}-${index}`}>
            <p className="journey-user-question">{turn.question}</p>
            <p className="journey-answer">{turn.answer}</p>
            {journeyPlans(turn).map((plan, planIndex) => (
              <div className="journey-computed-plan" key={plan.journeyPlanId}>
                <strong>
                  Recommended stops on your route ({plan.totalStopMinutes} min total)
                  {journeyPlans(turn).length > 1 ? ` · Option ${planIndex + 1}` : ''}
                </strong>
                {plan.status === 'planned' ? (
                  plan.stops.length === 0 && plan.stopsModified ? (
                    <p>All stops removed from your route. Arrival is now {clock(plan.arrival, analysis.timeZone)}.</p>
                  ) : (
                    <>
                      <p>Estimated arrival at {clock(plan.arrival, analysis.timeZone)} with {plan.totalStopMinutes} min of breaks.</p>
                      {plan.stops.length > 0 ? (
                        <>
                          <p>
                            {appliedPlan?.journeyPlanId === plan.journeyPlanId
                              ? 'These stops are shown on the map above. Tap any stop to zoom in.'
                              : 'Preview these recommended stops on the map.'}
                          </p>
                          <div className="journey-map-stop-list">
                            {plan.stops.map((stop, stopIndex) => (
                              <button
                                type="button"
                                key={stopIndex}
                                onClick={() => onShowStop(plan, stopIndex)}
                              >
                                Zoom to {stopLabel(stop, stopIndex, analysis.timeZone)} ↑
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => onApply(appliedPlan?.journeyPlanId === plan.journeyPlanId ? null : plan)}
                          >
                            {appliedPlan?.journeyPlanId === plan.journeyPlanId ? 'Hide stops on map' : 'Show stops on map ↑'}
                          </button>
                        </>
                      ) : (
                        <p>No stops needed for this trip duration and break budget.</p>
                      )}
                    </>
                  )
                ) : (
                  <p>{plan.reason}</p>
                )}
              </div>
            ))}
          </article>
        ))}

        {pendingTurn && (
          <article className="journey-turn journey-turn-pending" key="pending-turn">
            <p className="journey-user-question">{pendingTurn.question}</p>
            {pendingTurn.answer ? <p className="journey-answer">{pendingTurn.answer}</p> : null}
            {(!pendingTurn.answer || pendingTurn.phase === 'thinking' || pendingTurn.phase === 'tool') && (
              <div className="journey-thinking" role="status">
                <span className="journey-spinner" aria-hidden="true" />
                <span>{pendingTurn.thinkingStatus || 'Thinking & checking your route…'}</span>
              </div>
            )}
          </article>
        )}
      </div>
    </section>
  )
}

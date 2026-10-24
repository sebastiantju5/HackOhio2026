export const TIME_ZONE = 'America/New_York'
export const LEVELS = {
  lower: { label: 'Lower exposure', color: '#48715b' },
  caution: { label: 'Caution', color: '#bb831d' },
  higher: { label: 'Higher exposure', color: '#bc554b' },
  unknown: { label: 'Unknown', color: '#777f86' },
}

export function clock(value, zone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(value))
}

export function day(value, zone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone }).format(new Date(value))
}

export function duration(seconds) {
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

export function miles(meters) {
  return Math.round(meters / 1609.344)
}

export function toWallInput(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

// Reject skipped or ambiguous Eastern times around daylight-saving transitions.
export function fromWallInput(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('Enter both departure dates and times.')
  const approximate = new Date(`${value}Z`).getTime()
  const matches = [-4, -5].map(offset => new Date(approximate - offset * 3600000)).filter(date => toWallInput(date) === value)
  if (matches.length !== 1) throw new Error('This Eastern time is ambiguous or skipped by daylight saving. Choose another time.')
  return matches[0].toISOString()
}

export const FUEL_GRADES = {
  REGULAR_UNLEADED: 'Regular unleaded', MIDGRADE: 'Midgrade', PREMIUM: 'Premium', DIESEL: 'Diesel',
}
export const PRICE_MAX_AGE_MS = 48 * 60 * 60 * 1000

export function defaultFuelGrade(vehicle) {
  const fuel = (vehicle?.fuelType || '').toLowerCase()
  return fuel.includes('diesel') ? 'DIESEL' : fuel.includes('premium') ? 'PREMIUM' : fuel.includes('midgrade') ? 'MIDGRADE' : 'REGULAR_UNLEADED'
}

export function reportedFuelPrice(prices, grade, now = Date.now()) {
  const quotes = (prices || []).filter(item => item.type === grade).flatMap(item => {
    const money = item.price
    if (!money || money.currencyCode !== 'USD' || !['number', 'string'].includes(typeof money.units) || String(money.units).trim() === '') return []
    const units = Number(money.units), nanos = money.nanos ?? 0
    if (!Number.isInteger(units) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return []
    const amount = units + nanos / 1e9
    const updated = item.updateTime instanceof Date ? item.updateTime.getTime() : Date.parse(item.updateTime)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(updated) || updated > now + 15 * 60000) return []
    return [{ amount, currency: 'USD', grade, updatedAt: new Date(updated).toISOString(), recent: now - updated <= PRICE_MAX_AGE_MS }]
  })
  return quotes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null
}

export function compareFuelStations(places, grade, now = Date.now()) {
  return places.map(place => ({ ...place, fuelPrice: reportedFuelPrice(place.fuelPrices, grade, now) }))
    .sort((a, b) => {
      const aPrice = a.fuelPrice?.recent ? a.fuelPrice.amount : Infinity
      const bPrice = b.fuelPrice?.recent ? b.fuelPrice.amount : Infinity
      return aPrice === bPrice ? 0 : aPrice - bPrice
    })
}

export function fuelPriceLabel(place) {
  const quote = place.fuelPrice
  if (!quote) return 'Price unavailable for selected grade'
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: quote.currency, minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(quote.amount)
  return `${amount} reported · ${FUEL_GRADES[quote.grade]}${quote.recent ? '' : ' · Stale, excluded from comparison'}`
}

// Compact Google step geometry without discarding cumulative travel times.
export function compactRoute(steps, totalSeconds, distanceMeters, maximum = 140) {
  const coordinates = [], durations = []
  for (const step of steps) {
    const path = step.path
    if (!path || path.length < 2) continue
    const lengths = path.slice(1).map((p, i) => Math.hypot(
      (p[0] - path[i][0]) * Math.cos(p[1] * Math.PI / 180), p[1] - path[i][1]))
    const length = lengths.reduce((a, b) => a + b, 0)
    if (!coordinates.length) coordinates.push(path[0])
    else if (coordinates.at(-1).some((value, axis) => value !== path[0][axis])) {
      coordinates.push(path[0]); durations.push(0)
    }
    path.slice(1).forEach((p, i) => {
      coordinates.push(p)
      durations.push(length ? step.seconds * lengths[i] / length : step.seconds / lengths.length)
    })
  }
  const sum = durations.reduce((a, b) => a + b, 0)
  if (!sum || coordinates.length < 2 || !Number.isFinite(totalSeconds) || totalSeconds <= 0) throw new Error('Google returned no usable driving steps.')
  const cumulative = [0]
  durations.forEach(seconds => cumulative.push(cumulative.at(-1) + seconds * totalSeconds / sum))
  const count = Math.min(maximum, coordinates.length)
  const indices = Array.from({ length: count }, (_, i) => Math.round(i * (coordinates.length - 1) / (count - 1)))
  return {
    coordinates: indices.map(index => coordinates[index].map(value => +value.toFixed(5))),
    durations: indices.slice(1).map((index, i) => +(cumulative[index] - cumulative[indices[i]]).toFixed(3)),
    distanceMeters: Math.round(distanceMeters),
  }
}

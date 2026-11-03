import { parseCoordinates, parseGeoJSON, lengthFt, offset, distanceToLineFt, nearbyNetwork } from '../engine/geo'
import { buildSeed } from '../seed'

test('parses typed, pasted and Google Maps coordinates', () => {
  expect(parseCoordinates('35.4231, -119.8765')).toEqual([[35.4231, -119.8765]])
  expect(parseCoordinates('-119.8765 35.4231')).toEqual([[35.4231, -119.8765]])
  expect(parseCoordinates('https://www.google.com/maps/@35.42,-119.87,15z')).toEqual([[35.42, -119.87]])
  expect(parseCoordinates('35.1,-119.1\n35.2,-119.2\n35.3,-119.3').length).toBe(3)
})
test('distances and offsets agree', () => {
  const a: [number, number] = [35, -119]
  const b = offset(a, 5280, 90)
  expect(Math.abs(lengthFt([a, b]) - 5280)).toBeLessThan(5)
  expect(distanceToLineFt(offset(a, 100, 0), [a, b]).ft).toBeGreaterThan(90)
})
test('GeoJSON lines are read as lat/lng', () => {
  const g = parseGeoJSON({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-119, 35], [-118.9, 35.1]] } })
  expect(g.lines[0][0]).toEqual([35, -119])
})
test('seed projects sit on or near the demo network', () => {
  const s = buildSeed()
  expect(s.projects.every((p) => p.location.lat && p.location.lng)).toBe(true)
  const p = s.projects.find((x) => x.code === 'PRJ-1001')!
  expect(nearbyNetwork(s, p, 1500)[0]?.ft).toBe(0)
  const v = s.projects.find((x) => x.code === 'PRJ-1024')!
  expect(nearbyNetwork(s, v, 50).length).toBeGreaterThan(0)
})

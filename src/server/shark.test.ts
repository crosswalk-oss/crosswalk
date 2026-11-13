import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { handleShark, toVentures, checkInvestment, type SharkConfig } from './shark'
import type { Exec } from './repo'

const db = new PGlite()
const exec: Exec = async (sql, params) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[]
const env = { exec, passcode: 'pw' }
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await handleShark(new Request('http://x/api/shark/' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env)
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}
const admin = { 'x-crosswalk-passcode': 'pw' }

describe('shark bucks', () => {
  beforeAll(async () => {
    const r = await call('POST', 'config', { title: 'Night', ventures: ['Alpha Co', 'Beta', 'Beta', ' ', 'Gamma'], open: true }, admin)
    expect(r.status).toBe(200)
  })
  it('makes stable unique venture ids', () => {
    expect(toVentures(['Alpha Co', 'Alpha Co!', '']).map((v) => v.id)).toEqual(['alpha-co', 'alpha-co-2'])
  })
  it('checks an allocation', () => {
    const c: SharkConfig = { title: '', budget: 100, step: 5, ventures: toVentures(['A', 'B']), open: true, reveal: false, round: 1 }
    expect(checkInvestment(c, 'a', { a: 10 })).toMatch(/own venture/)
    expect(checkInvestment(c, '', { a: 60, b: 50 })).toMatch(/more than/)
    expect(checkInvestment(c, '', { a: 1.5 })).toMatch(/whole/)
    expect(checkInvestment(c, 'a', { a: 0, b: 100, zzz: 5 })).toEqual({ alloc: { b: 100 }, total: 100 })
  })
  it('refuses config changes without the passcode', async () => {
    expect((await call('POST', 'config', { open: false })).status).toBe(401)
    expect((await call('GET', 'investors')).status).toBe(401)
  })
  it('takes investments, keeps the latest per device, and hides totals until the reveal', async () => {
    expect((await call('POST', 'invest', { device: 'device-one', name: 'Ann Lee', own: 'alpha-co', alloc: { beta: 60000, gamma: 40000 } })).status).toBe(200)
    expect((await call('POST', 'invest', { device: 'device-two', name: 'Bo Diaz', own: '', alloc: { 'alpha-co': 100000 } })).status).toBe(200)
    expect((await call('POST', 'invest', { device: 'device-one', name: 'Ann Lee', own: 'alpha-co', alloc: { beta: 100000 } })).status).toBe(200)
    expect((await call('POST', 'invest', { device: 'device-3xx', name: 'Cy', own: 'beta', alloc: { beta: 5 } })).status).toBe(400)
    expect((await call('POST', 'invest', { device: 'device-3xx', name: 'Cy', own: '', alloc: { beta: 100001 } })).status).toBe(400)
    const pub = await call('GET', 'state', undefined, { 'x-shark-device': 'device-one' })
    expect(pub.body.investors).toBe(2)
    expect(pub.body.totals).toBeNull()
    expect(pub.body.mine.total).toBe(100000)
    const adm = await call('GET', 'state', undefined, admin)
    expect(adm.body.totals).toEqual({ 'alpha-co': { amount: 100000, backers: 1 }, beta: { amount: 100000, backers: 1 }, gamma: { amount: 0, backers: 0 } })
    await call('POST', 'config', { reveal: true }, admin)
    expect((await call('GET', 'state')).body.totals.beta.amount).toBe(100000)
    expect((await call('GET', 'investors', undefined, admin)).body.investors.map((p: any) => p.name)).toEqual(['Ann Lee', 'Bo Diaz'])
  })
  it('stops taking investments when closed, and a new round starts empty', async () => {
    await call('POST', 'config', { open: false }, admin)
    expect((await call('POST', 'invest', { device: 'device-two', name: 'Bo Diaz', own: '', alloc: { beta: 5 } })).status).toBe(409)
    const r = await call('POST', 'reset', undefined, admin)
    expect(r.body.config.round).toBe(2)
    expect((await call('GET', 'state')).body.investors).toBe(0)
  })
})

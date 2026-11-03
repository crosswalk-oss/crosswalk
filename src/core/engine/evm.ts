import type { CostPeriod } from '../types'

export interface EvmPoint { period: string; pv: number; ev: number; ac: number; cumPv: number; cumEv: number; cumAc: number }

/** Cumulative earned value series from monthly cost periods. */
export function evmSeries(periods: CostPeriod[]): EvmPoint[] {
  const sorted = periods.slice().sort((a, b) => a.period.localeCompare(b.period))
  let pv = 0, ev = 0, ac = 0
  return sorted.map((p) => {
    pv += p.planned; ev += p.earned; ac += p.actual
    return { period: p.period, pv: p.planned, ev: p.earned, ac: p.actual, cumPv: pv, cumEv: ev, cumAc: ac }
  })
}

export interface EvmMetrics { bac: number; pv: number; ev: number; ac: number; cpi: number; spi: number; cv: number; sv: number; eac: number; etc: number; vac: number; pctComplete: number; tcpi: number }

/** Standard EVM indices. BAC = control budget excluding contingency. */
export function evmMetrics(periods: CostPeriod[], bac: number): EvmMetrics {
  const s = evmSeries(periods)
  const last = s[s.length - 1] ?? { cumPv: 0, cumEv: 0, cumAc: 0 }
  const pv = last.cumPv, ev = last.cumEv, ac = last.cumAc
  const cpi = ac ? ev / ac : 1
  const spi = pv ? ev / pv : 1
  // VERIFY: EAC = AC + (BAC − EV) / CPI (CPI-based ETC); TCPI = (BAC − EV) / (BAC − AC) to complete at BAC. Confirm the EAC method the controls team uses.
  const eac = cpi ? ac + (bac - ev) / cpi : bac
  const tcpi = bac - ac ? (bac - ev) / (bac - ac) : 1
  return { bac, pv, ev, ac, cpi, spi, cv: ev - ac, sv: ev - pv, eac: Math.round(eac), etc: Math.round(eac - ac), vac: Math.round(bac - eac), pctComplete: bac ? ev / bac : 0, tcpi }
}

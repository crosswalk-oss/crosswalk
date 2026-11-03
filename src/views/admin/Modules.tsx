// Configuration → Modules: phase-2 modules that are off for the pilot. Turning one on shows its navigation and panels.
import type { Settings } from '@/core/types'
import { mutate, useStore } from '@/core/store'
import { Badge, Callout, Panel } from '@/ui/kit'
import { toast } from '@/ui/toast'

type Key = keyof Settings['features']

const MODULES: { key: Key; name: string; what: string; where: string; needs: string }[] = [
  { key: 'fieldTailboard', name: 'Field tailboard', what: 'Phone-first pre-job briefing for crews: hazards and controls from the approved safety plan, crew sign-in, stop-work reminder, observations and near misses, with an offline queue.', where: 'Adds “Field tailboard” to the navigation and the button on Construction safety.', needs: 'Mobile device management for contractor phones; field connectivity plan.' },
  { key: 'portfolioPlanning', name: 'Portfolio planning', what: 'Multi-year capital plan scenarios: rank candidate projects by risk reduction per dollar against funding envelopes, and compare plans side by side.', where: 'Adds “Portfolio planning” to the navigation.', needs: 'Integrity risk model scores from the DIMP / TIMP systems.' },
  { key: 'opQual', name: 'Operator qualification (an operator-qualification provider)', what: 'Checks every crew member on a safety plan against current operator-qualification records for the covered tasks the plan’s hazards require, and flags expired OQs at the tailboard.', where: 'Adds OQ columns, the crew OQ checks in safety plans, and the expiring-OQ list on Construction safety.', needs: 'the OQ provider (or OpQual) feed of contractor OQ records.' },
]

export default function Modules() {
  const features = useStore((s) => s.settings.features)
  const toggle = (k: Key, on: boolean, name: string) => {
    mutate((d) => { d.settings.features = { ...d.settings.features, [k]: on } }, { entity: 'settings', entityId: 'features', action: 'update', summary: `${name} module turned ${on ? 'on' : 'off'}` })
    toast(`${name} ${on ? 'turned on' : 'turned off'}`)
  }
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info" title="Phase 2 modules are off for the pilot">These modules are built but held back so the pilot stays focused on stage gates, estimating, cost and change control. Turning one on affects every user; data already captured is kept either way.</Callout>
      <Panel pad={false} title="Modules">
        <ul className="divide-y divide-line">
          {MODULES.map((m) => {
            const on = !!features?.[m.key]
            return (
              <li key={m.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]">{m.name}</b><Badge tone={on ? 'good' : 'neutral'}>{on ? 'On' : 'Off'}</Badge><Badge>Phase 2</Badge></div>
                  <p className="mt-1 text-[12.5px]">{m.what}</p>
                  <p className="mt-1 text-[12px] text-muted">{m.where}</p>
                  <p className="mt-0.5 text-[12px] text-faint">Before production: {m.needs}</p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] font-semibold">
                  <span className="relative inline-flex h-5 w-9 items-center">
                    <input type="checkbox" role="switch" aria-label={`${m.name} module`} className="peer sr-only" checked={on} onChange={(e) => toggle(m.key, e.target.checked, m.name)} />
                    <span className="absolute inset-0 rounded-full bg-line transition peer-checked:bg-good peer-focus-visible:ring-2 peer-focus-visible:ring-link" />
                    <span className="absolute left-0.5 h-4 w-4 rounded-full bg-surface shadow transition peer-checked:translate-x-4" />
                  </span>
                  {on ? 'On' : 'Off'}
                </label>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}

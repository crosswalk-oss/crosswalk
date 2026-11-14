// Demo data for carry-forward: wherever an open deliverable could take an answer from an earlier, accepted deliverable
// on the same project, that earlier deliverable gets its completed form, so the open one shows "Carried from…".
// Own random stream so the rest of the seed is unchanged. Fictional.
import type { AppState, FormValue, Project } from '../types'
import { rng, addDays } from '../util'
import { FORM_FOR_DEF, FORM_TEMPLATES, type DocFormTemplate } from '../engine/forms'
import { CARRY_LINKS } from '../engine/carry'
import { curated, generic } from './records'

const person = (s: AppState, id?: string) => s.people.find((x) => x.id === id)?.name ?? 'Engineer of record'

/** The answers later deliverables take from this form, written out so what is carried reads like a real answer. */
function sourceAnswers(s: AppState, p: Project, t: DocFormTemplate): Record<string, FormValue> {
  const test = Math.round(p.asset.maopPsig * 1.5)
  const half = Math.round(p.asset.lengthFt / 2)
  const sta = (ft: number) => `${Math.floor(ft / 100)}+${String(ft % 100).padStart(2, '0')}`
  switch (t.id) {
    case 'f-feas': return { alts: [
      { alt: 'Pressure test in place', desc: 'Test the existing pipe and replace only what fails', cost: 2_400_000, risk: 'Medium' },
      { alt: 'Replace by open cut', desc: 'New pipe in the existing alignment', cost: 6_800_000, risk: 'Low' },
      { alt: 'Replace by directional drill', desc: 'New pipe drilled under the crossings', cost: 7_900_000, risk: 'Medium' },
    ] }
    case 'f-bod': case 'f-ifc': return { eor: person(s, p.team.engineer) }
    case 'f-recrev': return { segments: [
      { seg: 'Segment A', stations: `${sta(0)} to ${sta(half)}`, status: 'Complete', basis: 'Pressure test' },
      { seg: 'Segment B', stations: `${sta(half)} to ${sta(p.asset.lengthFt)}`, status: 'Gaps', basis: 'Unknown' },
    ] }
    case 'f-hydro': return { sections: [
      { sec: 'Section 1', from: sta(0), to: sta(half), len: half, psig: test, hrs: 8 },
      { sec: 'Section 2', from: sta(half), to: sta(p.asset.lengthFt), len: p.asset.lengthFt - half, psig: test, hrs: 8 },
    ] }
  }
  return {}
}

export function seedCarryExamples(s: AppState) {
  const R = rng(9917)
  const asOf = s.settings.asOf
  const open = (st: string) => !['submitted', 'accepted', 'waived'].includes(st)
  for (const p of s.projects.filter((x) => x.status === 'active')) {
    const ds = s.deliverables.filter((x) => x.projectId === p.id)
    for (const d of ds.filter((x) => open(x.status))) for (const link of CARRY_LINKS) {
      if (FORM_FOR_DEF[d.defId] !== link.to.slice(0, link.to.indexOf('.'))) continue
      const from = link.from.slice(0, link.from.indexOf('.'))
      const src = ds.find((x) => x.id !== d.id && x.status === 'accepted' && !x.form && x.stageIndex <= d.stageIndex && FORM_FOR_DEF[x.defId] === from)
      const t = FORM_TEMPLATES.find((x) => x.id === from)
      if (!src || !t) continue
      src.form = { templateId: t.id, templateVersion: t.version, data: { ...generic(s, p, t, R), ...curated(p, t, asOf), ...sourceAnswers(s, p, t) }, savedAt: `${addDays(asOf, -R.int(60, 200))}T16:00:00.000Z`, savedById: src.ownerId ?? p.team.pm ?? 'u-me' }
    }
  }
}

// Default process catalog (Module 7). Each is a published, versioned WorkflowDef a client edits in the designer.
import type { Assignee, FormField, RecordType, RoleId, WfEdge, WfNode, WorkflowDef } from '../types'

type Step = { id: string; type: WfNode['type']; label: string; a?: Assignee; sla?: number; rule?: 'any' | 'all'; desc?: string; sys?: WfNode['systemAction'] }

const role = (roleId: RoleId): Assignee => ({ kind: 'role', roleId })
const team = (position: Extract<Assignee, { kind: 'team-position' }>['position']): Assignee => ({ kind: 'team-position', position })
const requester: Assignee = { kind: 'requester' }
const doa: Assignee = { kind: 'doa', field: 'amount' }

let eid = 0
const E = (from: string, to: string, extra: Partial<WfEdge> = {}): WfEdge => ({ id: `e${++eid}`, from, to, ...extra })

/** A straight-line process: start → steps → end. Approvals/reviews get a 'return' edge to the first form step. */
function linear(
  id: string, key: string, name: string, recordType: RecordType, ownerRole: RoleId, description: string, purpose: string, fields: FormField[], steps: Step[],
): WorkflowDef {
  const all: Step[] = [{ id: 'start', type: 'start', label: 'Start' }, ...steps, { id: 'end', type: 'end', label: 'Complete' }]
  const nodes: WfNode[] = all.map((s, i) => ({ id: s.id, type: s.type, label: s.label, x: 60 + i * 170, y: 160, assignee: s.a, slaDays: s.sla, rule: s.rule, description: s.desc, systemAction: s.sys }))
  const edges: WfEdge[] = []
  for (let i = 0; i < all.length - 1; i++) edges.push(E(all[i].id, all[i + 1].id, { outcome: all[i].type === 'approval' || all[i].type === 'review' ? 'approve' : undefined }))
  const firstForm = steps.find((s) => s.type === 'form')
  if (firstForm) for (const s of steps) if ((s.type === 'approval' || s.type === 'review') && s.id !== firstForm.id) edges.push(E(s.id, firstForm.id, { outcome: 'return', label: 'Return for revision' }))
  return { id, key, name, recordType, version: 1, status: 'published', effective: '2026-01-01', description, purpose, nodes, edges, fields, ownerRole }
}

const money = (key: string, label: string): FormField => ({ key, label, type: 'money', required: true })
const text = (key: string, label: string): FormField => ({ key, label, type: 'textarea', required: true })

export function workflowDefs(): WorkflowDef[] {
  eid = 0
  const defs: WorkflowDef[] = []

  // 1 · Change request — condition + DOA routing
  defs.push({
    id: 'wfd-change', key: 'change-request', name: 'Change request (scope, schedule, cost)', recordType: 'change', version: 2, status: 'published', effective: '2026-03-01', ownerRole: 'project-controls',
    description: 'Any change to an approved baseline. Routes by dollar authority; long schedule impacts get a scheduler review.',
    purpose: 'Keep every baseline change traceable to an approved request so recorded costs can be defended in reasonableness review.',
    fields: [money('amount', 'Cost impact'), { key: 'scheduleImpactDays', label: 'Schedule impact (days)', type: 'number', required: true }, { key: 'rootCause', label: 'Root cause', type: 'select', options: [] }, text('justification', 'Justification')],
    nodes: [
      { id: 'start', type: 'start', label: 'Start', x: 40, y: 200 },
      { id: 'prep', type: 'form', label: 'Prepare change request', x: 180, y: 200, assignee: requester, slaDays: 5, description: 'Requester documents scope, cost and schedule impact with root cause.' },
      { id: 'impact', type: 'review', label: 'Impact review', x: 350, y: 200, assignee: team('projectControls'), slaDays: 5, description: 'Project controls validates cost, contingency availability and baseline effect.' },
      { id: 'cond', type: 'condition', label: 'Schedule impact > 30 days?', x: 520, y: 200 },
      { id: 'sched', type: 'review', label: 'Schedule review', x: 690, y: 90, assignee: role('scheduler'), slaDays: 3, description: 'Scheduler confirms critical path effect.' },
      { id: 'approve', type: 'approval', label: 'Approve by dollar authority', x: 860, y: 200, assignee: doa, slaDays: 5, description: 'Approver from the DOA matrix by cost impact.' },
      { id: 'baseline', type: 'system', label: 'Create new Current baseline', x: 1030, y: 200, systemAction: 'create-baseline' },
      { id: 'end', type: 'end', label: 'Complete', x: 1180, y: 200 },
    ],
    edges: [
      E('start', 'prep'), E('prep', 'impact'), E('impact', 'cond', { outcome: 'approve' }), E('impact', 'prep', { outcome: 'return', label: 'Return' }),
      E('cond', 'sched', { label: 'Yes', condition: { field: 'scheduleImpactDays', op: 'gt', value: 30 } }), E('cond', 'approve', { label: 'No' }),
      E('sched', 'approve', { outcome: 'approve' }), E('approve', 'baseline', { outcome: 'approve' }), E('approve', 'prep', { outcome: 'return', label: 'Return' }), E('baseline', 'end'),
    ],
  })

  // 2 · Gate review — parallel reviews then board decision
  defs.push({
    id: 'wfd-gate', key: 'gate-review', name: 'Gate review', recordType: 'gate', version: 1, status: 'published', effective: '2026-01-01', ownerRole: 'pmo',
    description: 'PM submits the gate packet; PMO checks quality; program and controls review in parallel; the board decides.',
    purpose: 'Ensure every project passes each gate with complete deliverables, a qualifying estimate and named decision makers.',
    fields: [text('summary', 'Gate summary'), { key: 'recommendation', label: 'PM recommendation', type: 'select', options: ['Go', 'Go with conditions', 'Recycle', 'Hold'] }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start', x: 40, y: 200 },
      { id: 'submit', type: 'form', label: 'Submit gate packet', x: 180, y: 200, assignee: team('pm'), slaDays: 5 },
      { id: 'qc', type: 'review', label: 'PMO quality check', x: 350, y: 200, assignee: role('pmo'), slaDays: 3, rule: 'any', description: 'Deliverables complete, estimate class meets gate, risks have responses.' },
      { id: 'split', type: 'parallel-split', label: 'Parallel reviews', x: 500, y: 200 },
      { id: 'pgm', type: 'review', label: 'Program review', x: 660, y: 110, assignee: role('program-manager'), slaDays: 5, rule: 'any' },
      { id: 'pc', type: 'review', label: 'Controls review', x: 660, y: 290, assignee: team('projectControls'), slaDays: 5 },
      { id: 'join', type: 'parallel-join', label: 'Reviews complete', x: 820, y: 200 },
      { id: 'board', type: 'approval', label: 'Gate board decision', x: 970, y: 200, assignee: team('sponsor'), slaDays: 10, description: 'Sponsor decides on behalf of the gate board.' },
      { id: 'adv', type: 'system', label: 'Snapshot & advance stage', x: 1120, y: 200, systemAction: 'advance-stage' },
      { id: 'end', type: 'end', label: 'Complete', x: 1260, y: 200 },
    ],
    edges: [
      E('start', 'submit'), E('submit', 'qc'), E('qc', 'split', { outcome: 'approve' }), E('qc', 'submit', { outcome: 'return', label: 'Return' }), E('split', 'pgm'), E('split', 'pc'),
      E('pgm', 'join', { outcome: 'approve' }), E('pc', 'join', { outcome: 'approve' }), E('join', 'board'), E('board', 'adv', { outcome: 'approve' }), E('board', 'submit', { outcome: 'return', label: 'Recycle' }), E('adv', 'end'),
    ],
  })

  defs.push(linear('wfd-estimate', 'estimate-approval', 'Estimate approval', 'estimate', 'estimating-lead',
    'Estimator submits; estimating lead reviews; PM concurs; project controls accepts; the estimate locks.',
    'Every estimate used for a budget or regulatory forecast has a named reviewer and a locked basis.',
    [money('amount', 'Estimate total'), { key: 'cls', label: 'AACE class', type: 'select', options: ['5', '4', '3', '2', '1'] }],
    [
      { id: 'prep', type: 'form', label: 'Prepare estimate & BOE', a: team('estimator'), sla: 10 },
      { id: 'lead', type: 'review', label: 'Estimating lead review', a: role('estimating-lead'), sla: 5 },
      { id: 'pm', type: 'review', label: 'PM concurrence', a: team('pm'), sla: 3 },
      { id: 'pc', type: 'approval', label: 'Project controls acceptance', a: team('projectControls'), sla: 3 },
      { id: 'lock', type: 'system', label: 'Lock estimate version', sys: 'lock-estimate' },
    ]))

  defs.push(linear('wfd-cco', 'commitment-change', 'RFI / contract change order', 'commitment-change', 'project-controls',
    'The single entry point for changing a commitment (call-off): the field question (RFI) and its cost are logged against the commitment, the construction manager confirms the condition, project controls checks the commitment and forecast, and the approver is set by dollar authority.',
    'Every change to what a vendor is paid is tied to a commitment with a defined scope, so variance is measured against something and the forecast moves with it.',
    [money('amount', 'Change amount'), { key: 'scheduleImpactDays', label: 'Schedule impact (days)', type: 'number', required: true }, text('rfi', 'RFI / field condition')],
    [
      { id: 'prep', type: 'form', label: 'Submit RFI / change order', a: team('pm'), sla: 2 },
      { id: 'cm', type: 'review', label: 'Construction manager confirms condition', a: team('constructionManager'), sla: 2 },
      { id: 'pc', type: 'review', label: 'Project controls: commitment & forecast check', a: team('projectControls'), sla: 2 },
      { id: 'appr', type: 'approval', label: 'Approve (dollar authority)', a: doa, sla: 3 },
    ]))

  defs.push(linear('wfd-class5', 'class5-review', 'Class 5 quick estimate review', 'estimate', 'estimating-lead',
    'Requester submits a Class 5 quick estimate built from the historical cost table; a member of the estimating team reviews it, adjusts it with a stated reason if needed, and approves; the estimate locks.',
    'Early screening numbers come from the same historical cost data every time, and an estimator owns each one before it is used for planning or a GRC forecast.',
    [money('amount', 'Quick estimate total'), text('note', 'What the estimate is for')],
    [
      { id: 'prep', type: 'form', label: 'Submit quick estimate', a: { kind: 'requester' }, sla: 2 },
      { id: 'est', type: 'approval', label: 'Estimating team review & adjust', a: role('estimator'), sla: 3, rule: 'any', desc: 'Any estimator can take it: check the historical match, adjust the total with a reason if the project differs from the population, then approve or return.' },
      { id: 'lock', type: 'system', label: 'Lock estimate version', sys: 'lock-estimate' },
    ]))

  defs.push(linear('wfd-factor', 'factor-model-publish', 'Factor model publication', 'factor-model', 'estimating-lead',
    'An estimator submits a draft Class 5 factor model that has passed the backtest gate; the estimating lead reviews the weights, multipliers and backtest and approves; approval publishes the new version and retires the one it replaces.',
    'Every quick estimate is priced on a model version that was backtested against closed projects and approved by a named estimating lead.',
    [text('note', 'What changed and why')],
    [
      { id: 'prep', type: 'form', label: 'Submit model for approval', a: requester, sla: 2 },
      { id: 'lead', type: 'approval', label: 'Estimating lead approval', a: role('estimating-lead'), sla: 5, rule: 'any', desc: 'Check the driver weights and multipliers are physical, legal or logistical, the backtest meets the gate, and the change note explains the move.' },
      { id: 'pub', type: 'system', label: 'Publish; retire prior version' },
    ]))

  defs.push(linear('wfd-budget', 'budget-authorization', 'Budget authorization', 'budget', 'finance',
    'After the authorization gate, project controls prepares the budget, finance reviews, and the approver by dollar authority signs.',
    'Control budgets match an approved Class 3 estimate and are posted to the ERP only after authority sign-off.',
    [money('amount', 'Budget total'), { key: 'wbs', label: 'ERP WBS', type: 'text' }],
    [
      { id: 'prep', type: 'form', label: 'Prepare budget authorization', a: team('projectControls'), sla: 5 },
      { id: 'fin', type: 'review', label: 'Finance review', a: role('finance'), sla: 5 },
      { id: 'approve', type: 'approval', label: 'Approve by dollar authority', a: doa, sla: 7 },
      { id: 'post', type: 'system', label: 'Post budget to ERP', sys: 'post-budget' },
    ]))

  defs.push(linear('wfd-cont', 'contingency-drawdown', 'Contingency drawdown', 'contingency', 'project-controls',
    'PM requests contingency against a named risk; project controls verifies; approver by dollar authority signs.',
    'Contingency is spent only on identified risks, so remaining contingency always reflects real exposure.',
    [money('amount', 'Amount'), { key: 'risk', label: 'Risk realized', type: 'text', required: true }, text('reason', 'Reason')],
    [
      { id: 'prep', type: 'form', label: 'Request drawdown', a: requester, sla: 3 },
      { id: 'pc', type: 'review', label: 'Controls verification', a: team('projectControls'), sla: 3 },
      { id: 'approve', type: 'approval', label: 'Approve by dollar authority', a: doa, sla: 5 },
    ]))

  defs.push(linear('wfd-jssp', 'safety-plan', 'Job-specific safety plan', 'safety-plan', 'safety-advisor',
    'Contractor safety prepares the plan; the construction manager reviews; a safety advisor approves before NTP.',
    'No crew mobilizes without an approved plan that matches the work activities and permits.',
    [{ key: 'workPackage', label: 'Work package', type: 'text', required: true }],
    [
      { id: 'prep', type: 'form', label: 'Prepare safety plan', a: role('contractor-safety'), sla: 5 },
      { id: 'cm', type: 'review', label: 'Construction manager review', a: team('constructionManager'), sla: 3 },
      { id: 'saf', type: 'approval', label: 'Safety advisor approval', a: team('safety'), sla: 3 },
      { id: 'ntp', type: 'system', label: 'Release NTP check', sys: 'release-ntp' },
    ]))

  defs.push(linear('wfd-dlv', 'deliverable-review', 'Deliverable review', 'deliverable', 'pmo',
    'Owner submits a gate deliverable with evidence; the PMO reviewer accepts or returns.',
    'Gate deliverables are accepted against written criteria with evidence attached.',
    [{ key: 'deliverable', label: 'Deliverable', type: 'text' }],
    [
      { id: 'prep', type: 'form', label: 'Submit deliverable', a: requester, sla: 5 },
      { id: 'rev', type: 'approval', label: 'Review against criteria', a: role('pmo'), sla: 5, rule: 'any' },
    ]))

  defs.push({
    id: 'wfd-contract', key: 'contract-award', name: 'Contract award / change order', recordType: 'contract', version: 1, status: 'published', effective: '2026-01-01', ownerRole: 'supply',
    description: 'Supply reviews; legal reviews only when terms are non-standard; approver by dollar authority signs.',
    purpose: 'Contract commitments are made only within authority and with legal review when terms deviate.',
    fields: [money('amount', 'Contract value'), { key: 'nonStandard', label: 'Non-standard terms', type: 'boolean' }, { key: 'vendor', label: 'Vendor', type: 'text' }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start', x: 40, y: 200 },
      { id: 'prep', type: 'form', label: 'Award recommendation', x: 180, y: 200, assignee: team('pm'), slaDays: 5 },
      { id: 'sup', type: 'review', label: 'Supply review', x: 350, y: 200, assignee: role('supply'), slaDays: 5 },
      { id: 'cond', type: 'condition', label: 'Non-standard terms?', x: 520, y: 200 },
      { id: 'legal', type: 'review', label: 'Legal review', x: 690, y: 90, assignee: role('legal'), slaDays: 7 },
      { id: 'approve', type: 'approval', label: 'Approve by dollar authority', x: 860, y: 200, assignee: doa, slaDays: 5 },
      { id: 'end', type: 'end', label: 'Complete', x: 1020, y: 200 },
    ],
    edges: [
      E('start', 'prep'), E('prep', 'sup'), E('sup', 'cond', { outcome: 'approve' }), E('sup', 'prep', { outcome: 'return', label: 'Return' }),
      E('cond', 'legal', { label: 'Yes', condition: { field: 'nonStandard', op: 'truthy' } }), E('cond', 'approve', { label: 'No' }), E('legal', 'approve', { outcome: 'approve' }), E('approve', 'end', { outcome: 'approve' }),
    ],
  })

  defs.push(linear('wfd-var', 'variance-explanation', 'Variance explanation', 'variance', 'project-controls',
    'Triggered when EAC or a milestone crosses its threshold. PM explains; controls validates; program manager accepts.',
    'Every material variance has a root cause and narrative before the month closes.',
    [{ key: 'rootCause', label: 'Root cause', type: 'select', options: [] }, text('narrative', 'Narrative')],
    [
      { id: 'prep', type: 'form', label: 'Write explanation', a: team('pm'), sla: 5 },
      { id: 'pc', type: 'review', label: 'Controls validation', a: team('projectControls'), sla: 3 },
      { id: 'pgm', type: 'approval', label: 'Program manager acceptance', a: role('program-manager'), sla: 5, rule: 'any' },
    ]))

  defs.push(linear('wfd-waiver', 'waiver', 'Deliverable waiver / early start', 'waiver', 'pmo',
    'PM asks to waive a gate deliverable or start early (e.g. long-lead release); PMO reviews; sponsor approves.',
    'Exceptions are rare, approved by the sponsor, and flagged on every later report.',
    [text('reason', 'Reason'), { key: 'permission', label: 'Early-start permission', type: 'select', options: ['', 'long-lead-release', 'po-over-threshold'] }],
    [
      { id: 'prep', type: 'form', label: 'Request exception', a: requester, sla: 2 },
      { id: 'pmo', type: 'review', label: 'PMO review', a: role('pmo'), sla: 3, rule: 'any' },
      { id: 'sp', type: 'approval', label: 'Sponsor approval', a: team('sponsor'), sla: 5 },
    ]))

  defs.push(linear('wfd-init', 'project-initiation', 'Project initiation request', 'initiation', 'program-manager',
    'A new need is submitted, screened by the program, placed in the portfolio plan and approved by a sponsor.',
    'Only screened, funded needs become projects.',
    [{ key: 'need', label: 'Need statement', type: 'textarea', required: true }, money('amount', 'Rough order of magnitude')],
    [
      { id: 'prep', type: 'form', label: 'Submit need', a: requester, sla: 5 },
      { id: 'pgm', type: 'review', label: 'Program screening', a: role('program-manager'), sla: 5, rule: 'any' },
      { id: 'plan', type: 'review', label: 'Portfolio planning', a: role('pmo'), sla: 5, rule: 'any' },
      { id: 'sp', type: 'approval', label: 'Sponsor approval', a: role('sponsor'), sla: 7, rule: 'any' },
    ]))

  defs.push(linear('wfd-forecast', 'forecast-review', 'Monthly forecast review', 'forecast', 'project-controls',
    'PM submits the time-phased forecast spread by WBS function; project controls validates against actuals and commitments; program manager accepts.',
    'Every month the EAC and its spread by function are reviewed and locked, so budget-to-forecast variance is explained before the period closes.',
    [money('amount', 'Forecast EAC'), { key: 'period', label: 'Forecast period', type: 'text' }, text('note', 'Forecast basis')],
    [
      { id: 'prep', type: 'form', label: 'Submit forecast spread', a: team('pm'), sla: 3 },
      { id: 'pc', type: 'review', label: 'Controls validation', a: team('projectControls'), sla: 3, desc: 'Checks ETC against open commitments, schedule and actual burn rate by function.' },
      { id: 'pgm', type: 'approval', label: 'Program manager acceptance', a: role('program-manager'), sla: 3, rule: 'any' },
      { id: 'lock', type: 'system', label: 'Lock forecast version' },
    ]))

  defs.push(linear('wfd-close', 'closeout', 'Project closeout', 'closeout', 'pmo',
    'PM certifies completion; records verifies; plant accounting accepts unitization; PMO freezes the evidence package.',
    'Projects close with complete records, capitalized assets and a frozen reasonableness package.',
    [{ key: 'inService', label: 'In-service date', type: 'date' }],
    [
      { id: 'prep', type: 'form', label: 'Certify completion', a: team('pm'), sla: 10 },
      { id: 'rec', type: 'review', label: 'Records verification', a: role('records'), sla: 10 },
      { id: 'pa', type: 'review', label: 'Unitization acceptance', a: role('plant-accounting'), sla: 10 },
      { id: 'pmo', type: 'approval', label: 'PMO acceptance', a: role('pmo'), sla: 5, rule: 'any' },
    ]))
  return defs
}

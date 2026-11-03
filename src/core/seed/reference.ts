// Reference data shipped with the product: roles, CBS, lifecycle templates, libraries, DOA.
// These are product defaults a client edits in Admin. Fictional org "Arroyo Valley Gas".
import type {
  InfoFieldDef, WbsFunction, CostCategory, DeliverableDef, DoaMatrix, HazardItem, LifecycleTemplate, Person, Program, Role, RiskLibraryItem, UnitCostRate, AssetType, WorkMethod, Terrain,
  ForecastLine, SapMapping, SpreadProfile, HistoricalCost, DiameterBand, HistUnit, Project,
} from '../types'
import { parametricLines } from '../engine/estimates'

export const ROLES: Role[] = [
  { id: 'exec', name: 'Vice President', description: 'Executive approver above director authority' },
  { id: 'sponsor', name: 'Director (Sponsor)', description: 'Accountable executive for a project; approves within director authority' },
  { id: 'program-manager', name: 'Program Manager', description: 'Owns a regulatory program portfolio' },
  { id: 'pm', name: 'Project Manager', description: 'Delivers scope, schedule and budget' },
  { id: 'engineer', name: 'Project Engineer', description: 'Owns design deliverables' },
  { id: 'estimator', name: 'Estimator', description: 'Prepares estimates and basis of estimate' },
  { id: 'estimating-lead', name: 'Estimating Lead', description: 'Reviews and signs estimates' },
  { id: 'project-controls', name: 'Project Controls', description: 'Cost, forecast, change and baseline control' },
  { id: 'scheduler', name: 'Scheduler', description: 'Owns the integrated schedule' },
  { id: 'finance', name: 'Capital Finance', description: 'Budget authorization and ERP posting' },
  { id: 'pmo', name: 'PMO', description: 'Standards, gate quality checks and portfolio reporting' },
  { id: 'gate-board', name: 'Gate Review Board', description: 'Decides gate outcomes' },
  { id: 'safety-advisor', name: 'Safety Advisor', description: 'Approves job-specific safety plans' },
  { id: 'construction-manager', name: 'Construction Manager', description: 'Leads field execution' },
  { id: 'contractor-safety', name: 'Contractor Safety Lead', description: "Prepares the contractor's job safety plan" },
  { id: 'environmental', name: 'Environmental Specialist', description: 'Permits and environmental compliance' },
  { id: 'land', name: 'Land Agent', description: 'Land rights and right-of-way' },
  { id: 'supply', name: 'Supply Management', description: 'Sourcing and contracts' },
  { id: 'legal', name: 'Legal', description: 'Non-standard contract terms' },
  { id: 'records', name: 'Records', description: 'Verifies traceable, verifiable, complete records' },
  { id: 'plant-accounting', name: 'Plant Accounting', description: 'Unitization and capitalization' },
  { id: 'admin', name: 'Administrator', description: 'Configures templates, workflows and libraries' },
]

const P = (id: string, name: string, title: string, roles: Person['roles'], dollarAuthority: number, managerId?: string, company?: string): Person => ({
  id, name, title, roles, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${company ? company.toLowerCase().replace(/[^a-z]+/g, '') + '.com' : 'arroyovalleygas.com'}`, dollarAuthority, managerId, company,
})

export const PEOPLE: Person[] = [
  P('u-vp', 'Dana Whitfield', 'VP, Infrastructure Delivery', ['exec', 'gate-board'], 50_000_000),
  P('u-dir1', 'Marcus Oyelaran', 'Director, Pipeline Delivery', ['sponsor', 'gate-board'], 5_000_000, 'u-vp'),
  P('u-dir2', 'Elena Castañeda', 'Director, Stations & Storage', ['sponsor', 'gate-board'], 5_000_000, 'u-vp'),
  P('u-dir3', 'Raj Patel', 'Director, Delivery Strategy & Controls', ['sponsor', 'gate-board', 'pmo'], 5_000_000, 'u-vp'),
  P('u-pgm1', 'Grace Liu', 'Program Manager, Pipeline Safety', ['program-manager'], 500_000, 'u-dir1'),
  P('u-pgm2', 'Tom Brennan', 'Program Manager, Integrity & Valves', ['program-manager'], 500_000, 'u-dir1'),
  P('u-pgm3', 'Nadia Haddad', 'Program Manager, Stations', ['program-manager'], 500_000, 'u-dir2'),
  P('u-me', 'Avery Morgan', 'Senior PMO Analyst', ['pmo', 'admin'], 0, 'u-dir3'),
  P('u-pmo2', 'Keisha Grant', 'PMO Lead', ['pmo', 'gate-board'], 0, 'u-dir3'),
  P('u-pm1', 'Quinn Ellis', 'Project Manager', ['pm'], 100_000, 'u-pgm1'),
  P('u-pm2', 'Priya Raman', 'Senior Project Manager', ['pm'], 100_000, 'u-pgm1'),
  P('u-pm3', 'Luis Ortega', 'Project Manager', ['pm'], 100_000, 'u-pgm2'),
  P('u-pm4', 'Hannah Kim', 'Project Manager', ['pm'], 100_000, 'u-pgm2'),
  P('u-pm5', 'Samuel Adeyemi', 'Senior Project Manager', ['pm'], 100_000, 'u-pgm3'),
  P('u-pm6', 'Claire Dubois', 'Project Manager', ['pm'], 100_000, 'u-pgm3'),
  P('u-eng1', 'Victor Nguyen', 'Project Engineer', ['engineer'], 0, 'u-pgm1'),
  P('u-eng2', 'Maya Johansson', 'Project Engineer', ['engineer'], 0, 'u-pgm3'),
  P('u-est1', 'Omar Siddiqui', 'Cost Estimator', ['estimator'], 0, 'u-dir3'),
  P('u-est2', 'Brooke Hayes', 'Cost Estimator', ['estimator'], 0, 'u-dir3'),
  P('u-estl', 'Frank Molina', 'Estimating Lead', ['estimating-lead'], 0, 'u-dir3'),
  P('u-pc1', 'Rachel Stein', 'Project Controls Analyst', ['project-controls'], 0, 'u-dir3'),
  P('u-pc2', 'Kofi Owusu', 'Project Controls Analyst', ['project-controls'], 0, 'u-dir3'),
  P('u-sch', 'Ines Barros', 'Lead Scheduler', ['scheduler'], 0, 'u-dir3'),
  P('u-fin', 'Paul Okafor', 'Capital Finance Manager', ['finance'], 0),
  P('u-saf1', 'Teresa Lindqvist', 'Construction Safety Advisor', ['safety-advisor'], 0),
  P('u-saf2', 'Andre Washington', 'Construction Safety Advisor', ['safety-advisor'], 0),
  P('u-cm1', 'Nate Kowalski', 'Construction Manager', ['construction-manager'], 50_000, 'u-dir1'),
  P('u-cm2', 'Rosa Jimenez', 'Construction Manager', ['construction-manager'], 50_000, 'u-dir2'),
  P('u-env', 'Kenji Watanabe', 'Environmental Specialist', ['environmental'], 0),
  P('u-land', 'Sophie Martin', 'Senior Land Agent', ['land'], 0),
  P('u-sup', 'Ahmed Farouk', 'Sourcing Manager', ['supply'], 0),
  P('u-legal', 'Laura Chen', 'Senior Counsel', ['legal'], 0),
  P('u-rec', 'Marco Delgado', 'Records Supervisor', ['records'], 0),
  P('u-pa', 'Susan Park', 'Plant Accounting Lead', ['plant-accounting'], 0),
  P('c-1', 'Ray Hollis', 'Safety Lead', ['contractor-safety'], 0, undefined, 'Thistledown Pipeline Co.'),
  P('c-2', 'Dolores Vega', 'HSE Manager', ['contractor-safety'], 0, undefined, 'Tumbleweed Energy Co.'),
  P('c-3', 'Kurt Jensen', 'Safety Coordinator', ['contractor-safety'], 0, undefined, 'Sandpiper Utility Co.'),
]

export const CONTRACTORS = ['Thistledown Pipeline Co.', 'Tumbleweed Energy Co.', 'Sandpiper Utility Co.']

export const CATEGORIES: CostCategory[] = [
  // CBS categories carry the CBS Level 3 function code they roll up to (see WBS_FUNCTIONS).
  { id: 'cat-pmc', code: '100', name: 'Project management', group: 'direct', erpCostElement: '5800100' },
  { id: 'cat-eng', code: '200', name: 'Engineering & design', group: 'direct', erpCostElement: '5400100' },
  { id: 'cat-pipe', code: '300.1', name: 'Pipe & fittings', group: 'direct', erpCostElement: '5310100' },
  { id: 'cat-valves', code: '300.2', name: 'Valves & actuators', group: 'direct', erpCostElement: '5320100' },
  { id: 'cat-equipment', code: '300.3', name: 'Major equipment', group: 'direct', erpCostElement: '5330100' },
  { id: 'cat-test', code: '390', name: 'Consumable & temporary material (test water, bypasses)', group: 'direct', erpCostElement: '5610100' },
  { id: 'cat-fabrication', code: '400', name: 'Fabrication', group: 'direct', erpCostElement: '5340100' },
  { id: 'cat-contract', code: '500.1', name: 'Contract construction', group: 'direct', erpCostElement: '5200100' },
  { id: 'cat-traffic', code: '500.2', name: 'Traffic control', group: 'direct', erpCostElement: '5710100' },
  { id: 'cat-restore', code: '500.3', name: 'Restoration & paving', group: 'direct', erpCostElement: '5700100' },
  { id: 'cat-inspect', code: '500.4', name: 'Construction inspection & NDE', group: 'direct', erpCostElement: '5600100' },
  { id: 'cat-commission', code: '600', name: 'Commissioning', group: 'direct', erpCostElement: '5620100' },
  { id: 'cat-co-labor', code: '700', name: 'Operations (company labor)', group: 'direct', erpCostElement: '5100100' },
  { id: 'cat-support', code: '800', name: 'Project support services', group: 'direct', erpCostElement: '5810100' },
  { id: 'cat-env', code: '850', name: 'Environmental', group: 'direct', erpCostElement: '5510100' },
  { id: 'cat-land', code: '860', name: 'Land & right-of-way (labor)', group: 'direct', erpCostElement: '5500100' },
  { id: 'cat-land-purchase', code: '870', name: 'Land (purchase)', group: 'direct', erpCostElement: '5520100' },
  { id: 'cat-permit-fees', code: '880', name: 'Permitting fees', group: 'direct', erpCostElement: '5530100' },
  { id: 'cat-loaders', code: '900', name: 'Project overhead (AFUDC, allocations)', group: 'indirect', erpCostElement: '5900100' },
  { id: 'cat-escalation', code: '950', name: 'Escalation', group: 'escalation', erpCostElement: '5950100' },
  { id: 'cat-undiff', code: '999', name: 'Undifferentiated', group: 'direct', erpCostElement: '5980100' },
  { id: 'cat-contingency', code: '990', name: 'Contingency', group: 'contingency', erpCostElement: '5990100' },
]

// ── Unit-cost library (ES-03). p50 values are illustrative 2025$ planning rates.
let rid = 0
function rate(assetType: AssetType, workMethod: WorkMethod, categoryId: string, description: string, unit: string, p50: number, extra: { diameterIn?: number; terrain?: Terrain; n?: number } = {}): UnitCostRate {
  rid++
  return { id: `rate-${rid}`, assetType, workMethod, categoryId, description, unit, p50: Math.round(p50), p10: Math.round(p50 * 0.78), p90: Math.round(p50 * 1.34), diameterIn: extra.diameterIn, terrain: extra.terrain, sampleSize: extra.n ?? 4 + ((rid * 7) % 19), basisYear: 2025 }
}
const DIAS = [12, 16, 20, 24, 30, 36]
const pipeCost: Record<number, number> = { 12: 95, 16: 150, 20: 205, 24: 270, 30: 365, 36: 455 }
const terrains: Terrain[] = ['urban', 'suburban', 'rural']
const tf: Record<Terrain, number> = { urban: 1.55, suburban: 1.0, rural: 0.68 }

export const RATES: UnitCostRate[] = (() => {
  const out: UnitCostRate[] = []
  for (const wm of ['replace-open-trench', 'replace-hdd'] as WorkMethod[]) {
    const hdd = wm === 'replace-hdd' ? 1.45 : 1
    for (const d of DIAS) {
      const df = d / 20
      out.push(rate('transmission-pipeline', wm, 'cat-pipe', `Line pipe & fittings, ${d}" API 5L X65`, 'ft', pipeCost[d], { diameterIn: d }))
      for (const t of terrains) out.push(rate('transmission-pipeline', wm, 'cat-contract', `Pipeline installation, ${d}", ${t}`, 'ft', 820 * df * tf[t] * hdd, { diameterIn: d, terrain: t }))
    }
    for (const t of terrains) {
      out.push(rate('transmission-pipeline', wm, 'cat-restore', `Restoration & paving, ${t}`, 'ft', { urban: 340, suburban: 170, rural: 55 }[t], { terrain: t }))
      out.push(rate('transmission-pipeline', wm, 'cat-traffic', `Traffic control, ${t}`, 'ft', { urban: 125, suburban: 48, rural: 9 }[t], { terrain: t }))
      // 2026 table: traffic control priced by region where city requirements differ
      for (const [region, f] of [['West', 1.35], ['East', 1.1]] as const) out.push({ ...rate('transmission-pipeline', wm, 'cat-traffic', `Traffic control, ${t}`, 'ft', { urban: 125, suburban: 48, rural: 9 }[t] * f, { terrain: t }), region })
      out.push(rate('transmission-pipeline', wm, 'cat-land', `Temporary & permanent land rights, ${t}`, 'ft', { urban: 95, suburban: 60, rural: 30 }[t], { terrain: t }))
    }
    out.push(rate('transmission-pipeline', wm, 'cat-co-labor', 'Company labor (inspection, gas ops, tie-in support)', 'ft', 145))
    out.push(rate('transmission-pipeline', wm, 'cat-eng', 'Engineering, survey & design', 'ft', 128))
    out.push(rate('transmission-pipeline', wm, 'cat-env', 'Environmental review, monitoring & permits', 'ft', 42))
    out.push(rate('transmission-pipeline', wm, 'cat-inspect', 'Weld inspection, X-ray & coating inspection', 'ft', 52))
    out.push(rate('transmission-pipeline', wm, 'cat-test', 'Hydrostatic strength test of new pipe', 'ft', 28))
    out.push(rate('transmission-pipeline', wm, 'cat-valves', 'Mainline valves & tie-in assemblies', 'LS', 1_350_000))
    out.push(rate('transmission-pipeline', wm, 'cat-pmc', 'Project management', 'ft', 62))
    out.push(rate('transmission-pipeline', wm, 'cat-support', 'Project controls, PMO, outreach & closeout support', 'ft', 38))
    out.push(rate('transmission-pipeline', wm, 'cat-permit-fees', 'Permit fees (municipal, environmental, land)', 'ft', 9))
    out.push(rate('transmission-pipeline', wm, 'cat-commission', 'Commissioning & functional checkout', 'ft', 6))
  }
  // Hydrotest
  for (const t of terrains) out.push(rate('transmission-pipeline', 'hydrotest', 'cat-contract', `Test section setup, fill, test & dewater, ${t}`, 'ft', 165 * tf[t], { terrain: t }))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-test', 'Test water acquisition, treatment & disposal', 'ft', 38))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-co-labor', 'Company labor (gas control, blowdown, purge)', 'ft', 62))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-eng', 'Test plan engineering & segmenting', 'ft', 34))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-pipe', 'Short-section replacements & test heads', 'ft', 22))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-env', 'Discharge permit & monitoring', 'ft', 11))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-restore', 'Excavation restoration', 'ft', 31))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-pmc', 'Project management & controls', 'ft', 26))
  out.push(rate('transmission-pipeline', 'hydrotest', 'cat-valves', 'Temporary supply (CNG/LNG) and bypass', 'LS', 420_000))
  // Distribution main
  for (const d of [4, 6, 8]) for (const t of terrains) out.push(rate('distribution-main', 'replace-open-trench', 'cat-contract', `Main & service installation, ${d}" PE, ${t}`, 'ft', (210 + d * 18) * tf[t], { diameterIn: d, terrain: t }))
  for (const d of [4, 6, 8]) out.push(rate('distribution-main', 'replace-open-trench', 'cat-pipe', `PE main & service material, ${d}"`, 'ft', 9 + d * 3.2, { diameterIn: d }))
  out.push(rate('distribution-main', 'replace-open-trench', 'cat-restore', 'Paving restoration (municipal standard)', 'ft', 165))
  out.push(rate('distribution-main', 'replace-open-trench', 'cat-traffic', 'Traffic control', 'ft', 42))
  out.push(rate('distribution-main', 'replace-open-trench', 'cat-co-labor', 'Company labor (tie-overs, abandonment)', 'ft', 58))
  out.push(rate('distribution-main', 'replace-open-trench', 'cat-eng', 'Design & mapping', 'ft', 24))
  out.push(rate('distribution-main', 'replace-open-trench', 'cat-pmc', 'Project management', 'ft', 15))
  // Valve automation (per site)
  out.push(rate('valve-site', 'valve-automation', 'cat-valves', 'Remote-control valve & actuator package', 'ea', 465_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-contract', 'Site construction & installation', 'ea', 640_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-equipment', 'SCADA RTU, power & communications', 'ea', 255_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-eng', 'Engineering & design', 'ea', 210_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-co-labor', 'Company labor & commissioning', 'ea', 140_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-env', 'Permits & environmental', 'ea', 45_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-land', 'Site easement', 'ea', 60_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-pmc', 'Project management', 'ea', 45_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-support', 'Project controls & closeout support', 'ea', 25_000))
  out.push(rate('valve-site', 'valve-automation', 'cat-commission', 'SCADA point-to-point & functional checkout', 'ea', 38_000))
  // Compressor station modernization (lump sum per station)
  for (const wm of ['compressor-replacement', 'station-rebuild'] as WorkMethod[]) {
    const f = wm === 'station-rebuild' ? 0.55 : 1
    out.push(rate('compressor-station', wm, 'cat-equipment', 'Electric-drive compressor units & motors', 'LS', 118_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-contract', 'Mechanical, civil & building construction', 'LS', 142_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-equipment', 'Electrical substation & utility interconnect', 'LS', 46_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-eng', 'EPC engineering & design', 'LS', 39_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-env', 'Air permits, CEQA & mitigation', 'LS', 14_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-co-labor', 'Company labor, commissioning & startup', 'LS', 18_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-pmc', 'Owner PM & oversight', 'LS', 10_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-support', 'Project controls, PMO, regulatory & closeout support', 'LS', 6_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-commission', 'Commissioning & startup support', 'LS', 7_500_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-fabrication', 'Skid & piping spool fabrication', 'LS', 9_000_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-permit-fees', 'Air district & building permit fees', 'LS', 1_200_000 * f, { n: 3 }))
    out.push(rate('compressor-station', wm, 'cat-inspect', 'QA/QC & third-party inspection', 'LS', 7_500_000 * f, { n: 3 }))
  }
  return out
})()

// ── Lifecycle templates (SG-01..03): 5-stage standard, 3-stage condensed for small projects.
const D = (id: string, name: string, kind: DeliverableDef['kind'], ownerRole: DeliverableDef['ownerRole'], reviewerRole: DeliverableDef['reviewerRole'], description: string, acceptance: string, condition?: DeliverableDef['condition']): DeliverableDef => ({ id, name, kind, ownerRole, reviewerRole, description, acceptance, condition })

export const TEMPLATES: LifecycleTemplate[] = [
  {
    id: 'tpl-standard',
    name: 'Standard capital project (5 stages)',
    description: 'Default for pipeline, station and storage projects over $5M. Mirrors a five-stage gas major projects model.',
    stages: [
      {
        id: 'st1', index: 0, name: 'Initiation & Business Case', purpose: 'Confirm the need, driver and funding path; produce a Class 5 estimate and planning budget.',
        gate: {
          id: 'g1', name: 'Gate 1 · Approve business case', decisionRoles: ['sponsor', 'gate-board'], requiredEstimateClass: 5, budgetEvent: 'planning', unlocks: [],
          deliverables: [
            D('d-charter', 'Project charter', 'document', 'pm', 'sponsor', 'Need, driver, regulatory citation, sponsor, high-level scope', 'Driver and citation stated; sponsor named'),
            D('d-feas', 'Feasibility study', 'document', 'engineer', 'program-manager', 'Alternatives screened, constructability, records review', 'At least two alternatives compared'),
            D('d-est5', 'Class 5 estimate', 'estimate', 'estimator', 'estimating-lead', 'Parametric estimate with range', 'Approved estimate at Class 5 or better'),
            D('d-risk1', 'High-level risk assessment', 'risk-register', 'pm', 'project-controls', 'Top risks with owners', 'At least five risks scored'),
            D('d-recovery', 'Revenue recovery strategy', 'document', 'program-manager', 'finance', 'GRC, balancing account or memo account path', 'Mechanism and proceeding named'),
          ],
        },
      },
      {
        id: 'st2', index: 1, name: 'Preliminary Design & Option Selection', purpose: 'Select the preferred option, write the execution plan and set the baseline schedule.',
        gate: {
          id: 'g2', name: 'Gate 2 · Select option', decisionRoles: ['sponsor', 'gate-board'], unlocks: ['long-lead-release'],
          deliverables: [
            D('d-site', 'Site assessment & survey plan', 'document', 'engineer', 'pm', 'Field verification, potholing plan', 'Survey scope approved'),
            D('d-options', 'Option analysis', 'document', 'engineer', 'program-manager', 'Test vs replace or route options with cost and risk', 'Preferred option justified'),
            D('d-pep', 'Project Execution Plan', 'document', 'pm', 'pmo', 'Organization, contracting strategy, controls, quality, safety approach', 'All PEP sections complete'),
            D('d-sched', 'Baseline schedule (Level 3)', 'schedule', 'scheduler', 'project-controls', 'Logic-linked schedule through in-service', 'No open ends; critical path identified'),
            D('d-longlead', 'Long-lead material list', 'checklist', 'engineer', 'pm', 'Pipe, valves, major equipment with need dates', 'Need dates tied to schedule'),
            D('d-ceqa', 'CEQA determination', 'permit', 'environmental', 'pm', 'Exemption or initial study path', 'Determination documented', { field: 'permitsNeeded.ceqa', op: 'truthy' }),
          ],
        },
      },
      {
        id: 'st3', index: 2, name: 'Detailed Design & Procurement', purpose: 'Complete design, secure land and permits, produce the Class 3 estimate and award construction.',
        gate: {
          id: 'g3', name: 'Gate 3 · Authorize construction', decisionRoles: ['sponsor', 'exec', 'gate-board'], requiredEstimateClass: 3, budgetEvent: 'control', unlocks: ['po-over-threshold', 'contract-award', 'construction-ntp'],
          deliverables: [
            D('d-design', 'Issued-for-construction design', 'document', 'engineer', 'engineer', 'IFC drawings, specifications, MAOP basis', 'Stamped IFC package'),
            D('d-est3', 'Class 3 estimate & basis of estimate', 'estimate', 'estimator', 'estimating-lead', 'Line-item estimate with BOE', 'Approved estimate at Class 3 or better'),
            D('d-riskq', 'Quantified risk register', 'risk-register', 'pm', 'project-controls', 'Three-point impacts; contingency tied to exposure', 'Top 10 risks quantified'),
            D('d-land', 'Land rights secured', 'checklist', 'land', 'pm', 'TREs and easements executed or scheduled', 'All parcels at least in negotiation with need dates'),
            D('d-permits', 'Permits issued or scheduled', 'permit', 'environmental', 'pm', 'Encroachment, discharge, air as applicable', 'Permit matrix complete'),
            D('d-award', 'Construction contract award recommendation', 'document', 'pm', 'program-manager', 'Bid tab, target price, award memo', 'Bid within estimate range or explained'),
            D('d-jssp', 'Job-specific safety plan', 'safety-plan', 'construction-manager', 'safety-advisor', 'Approved plan for first work package', 'Plan approved by safety advisor'),
            D('d-hydro', 'Hydrotest plan & discharge permit', 'permit', 'engineer', 'environmental', 'Test sections, water source, discharge', 'Plan approved', { field: 'permitsNeeded.hydrotestDischarge', op: 'truthy' }),
          ],
        },
      },
      {
        id: 'st4', index: 3, name: 'Construction', purpose: 'Execute safely; control scope, cost, schedule and risk; commission and place in service.',
        gate: {
          id: 'g4', name: 'Gate 4 · Place in service', decisionRoles: ['sponsor', 'gate-board'], unlocks: ['place-in-service'],
          deliverables: [
            D('d-commission', 'Commissioning & in-service records', 'records', 'construction-manager', 'records', 'Pressure test charts, weld logs, NDE', 'Records complete for all segments'),
            D('d-notice', 'Notice of operation', 'document', 'pm', 'program-manager', 'Date of operation recorded', 'Signed notice'),
            D('d-training', 'Operations turnover & training', 'checklist', 'pm', 'construction-manager', 'O&M handover', 'Ops sign-off'),
            D('d-demob', 'Demobilization & restoration inspection', 'checklist', 'construction-manager', 'pm', 'Restoration accepted by jurisdiction', 'Final inspection passed'),
          ],
        },
      },
      {
        id: 'st5', index: 4, name: 'Closeout', purpose: 'Turn over records and assets, close costs, capture lessons and freeze the evidence package.',
        gate: {
          id: 'g5', name: 'Gate 5 · Close project', decisionRoles: ['sponsor', 'gate-board'], unlocks: [],
          deliverables: [
            D('d-asbuilt', 'As-builts to GIS', 'records', 'engineer', 'records', 'As-built drawings posted', 'GIS updated'),
            D('d-unitize', 'Unitization to plant accounting', 'checklist', 'project-controls', 'plant-accounting', 'Asset units and costs', 'Accepted by plant accounting'),
            D('d-fincl', 'Financial closeout', 'checklist', 'project-controls', 'finance', 'Final cost, accruals cleared, WBS closed', 'Zero open commitments'),
            D('d-lessons', 'Lessons learned', 'document', 'pm', 'pmo', 'Lessons captured and tagged', 'At least three lessons'),
            D('d-rrpkg', 'Reasonableness-review evidence package', 'document', 'project-controls', 'pmo', 'Baselines, changes, variances, estimate classes', 'Package frozen'),
          ],
        },
      },
    ],
  },
  {
    id: 'tpl-small',
    name: 'Condensed project (3 stages)',
    description: 'For valve automation and projects under $5M: stages combined, fewer deliverables.',
    stages: [
      {
        id: 'sm1', index: 0, name: 'Initiate & Plan', purpose: 'Confirm need, Class 5 estimate, planning budget.',
        gate: {
          id: 'sg1', name: 'Gate A · Approve plan', decisionRoles: ['sponsor'], requiredEstimateClass: 5, budgetEvent: 'planning', unlocks: ['long-lead-release'],
          deliverables: [
            D('ds-charter', 'Project charter', 'document', 'pm', 'program-manager', 'Need, scope, sponsor', 'Driver stated'),
            D('ds-est5', 'Class 5 estimate', 'estimate', 'estimator', 'estimating-lead', 'Parametric estimate', 'Approved'),
            D('ds-sched', 'Milestone schedule', 'schedule', 'pm', 'project-controls', 'Key dates through in-service', 'Dates set'),
          ],
        },
      },
      {
        id: 'sm2', index: 1, name: 'Design, Procure & Authorize', purpose: 'Design, Class 3 estimate, control budget, award.',
        gate: {
          id: 'sg2', name: 'Gate B · Authorize construction', decisionRoles: ['sponsor', 'gate-board'], requiredEstimateClass: 3, budgetEvent: 'control', unlocks: ['po-over-threshold', 'contract-award', 'construction-ntp'],
          deliverables: [
            D('ds-design', 'IFC design', 'document', 'engineer', 'engineer', 'Drawings', 'Stamped'),
            D('ds-est3', 'Class 3 estimate', 'estimate', 'estimator', 'estimating-lead', 'Line-item estimate', 'Approved'),
            D('ds-risk', 'Risk register', 'risk-register', 'pm', 'project-controls', 'Quantified top risks', 'Scored'),
            D('ds-jssp', 'Job-specific safety plan', 'safety-plan', 'construction-manager', 'safety-advisor', 'Approved plan', 'Approved'),
          ],
        },
      },
      {
        id: 'sm3', index: 2, name: 'Construct & Close', purpose: 'Build, place in service, close out.',
        gate: {
          id: 'sg3', name: 'Gate C · Close project', decisionRoles: ['sponsor'], unlocks: ['place-in-service'],
          deliverables: [
            D('ds-records', 'In-service records', 'records', 'construction-manager', 'records', 'Test and weld records', 'Verified'),
            D('ds-fincl', 'Financial closeout', 'checklist', 'project-controls', 'finance', 'Costs closed', 'Closed'),
            D('ds-lessons', 'Lessons learned', 'document', 'pm', 'pmo', 'Lessons', 'Captured'),
          ],
        },
      },
    ],
  },
]

export const DOA: DoaMatrix[] = [
  {
    id: 'doa-std', name: 'Capital delivery authority', version: 3, effective: '2026-01-01',
    rows: [
      { upTo: 250_000, roleId: 'program-manager', label: 'Program Manager' },
      { upTo: 5_000_000, roleId: 'sponsor', label: 'Director' },
      { upTo: 50_000_000, roleId: 'exec', label: 'Vice President' },
      { upTo: 1e13, roleId: 'exec', label: 'VP with officer committee' },
    ],
  },
]

export const PROGRAMS: Program[] = [
  // VERIFY: regulatory driver citations (PU Code sections, 49 CFR 192 parts) are public-law references for the fictional programs; confirm before reuse.
  { id: 'prg-pse', code: 'PSE', name: 'Pipeline Safety Enhancement', description: 'Test or replace transmission pipe lacking sufficient pressure-test records.', regulatoryDriver: 'PU Code §957–958; 49 CFR 192 Subpart J', recovery: 'Balancing account', lifecycleTemplateId: 'tpl-standard', doaMatrixId: 'doa-std' },
  { id: 'prg-tim', code: 'TIM', name: 'Transmission Integrity & MAOP', description: 'MAOP reconfirmation and integrity assessments under the gas transmission safety rule.', regulatoryDriver: '49 CFR 192.624, 192.710', recovery: 'GRC base', lifecycleTemplateId: 'tpl-standard', doaMatrixId: 'doa-std' },
  { id: 'prg-drp', code: 'DRP', name: 'Distribution Main Replacement', description: 'Replace vintage distribution main with modern PE.', regulatoryDriver: 'DIMP, 49 CFR 192 Subpart P', recovery: 'GRC base', lifecycleTemplateId: 'tpl-standard', doaMatrixId: 'doa-std' },
  { id: 'prg-csm', code: 'CSM', name: 'Compressor & Storage Modernization', description: 'Replace aging gas-fired compression with electric drives and modernize storage facilities.', regulatoryDriver: 'Air district rules; reliability', recovery: 'Advice letter', lifecycleTemplateId: 'tpl-standard', doaMatrixId: 'doa-std' },
  { id: 'prg-vap', code: 'VAP', name: 'Valve Automation', description: 'Install remote-control and automatic shutoff valves on transmission lines.', regulatoryDriver: '49 CFR 192.179, 192.634 (Valve Rule)', recovery: 'GRC base', lifecycleTemplateId: 'tpl-small', doaMatrixId: 'doa-std' },
]

const H = (id: string, activity: string, hazard: string, controls: [HazardItem['controls'][number]['type'], string][], permits: string[] = [], oqTasks: string[] = []): HazardItem => ({ id, activity, hazard, controls: controls.map(([type, text]) => ({ type, text })), permits, oqTasks, effective: '2026-01-15' })

export const HAZARDS: HazardItem[] = [
  H('hz-1', 'Excavation', 'Trench collapse / cave-in', [['engineering', 'Shoring, sloping or trench box per soil classification'], ['administrative', 'Competent person inspects daily and after rain'], ['administrative', 'Ladder within 25 ft of workers in trenches 4 ft or deeper']], ['Excavation permit'], ['Excavation & backfill']),
  H('hz-2', 'Excavation', 'Strike of buried facilities', [['administrative', 'Valid 811 ticket; positive response from all members'], ['administrative', 'Hand dig / vacuum within tolerance zone'], ['administrative', 'Pothole and mark substructures before mechanical excavation']], ['811 locate']),
  H('hz-3', 'Excavation', 'Spoil pile and falling objects', [['engineering', 'Spoil set back at least 2 ft from edge'], ['ppe', 'Hard hat and high-visibility vest']]),
  H('hz-4', 'Tie-in / hot tap', 'Gas release and ignition', [['engineering', 'Bypass and pressure control fittings rated for MAOP'], ['administrative', 'Hot tap procedure reviewed at tailboard'], ['administrative', 'Continuous gas monitoring; ignition sources controlled'], ['ppe', 'FR clothing']], ['Hot work permit'], ['Hot tapping', 'Tapping & stopping']),
  H('hz-5', 'Purge & blowdown', 'Flammable atmosphere / noise', [['engineering', 'Blowdown silencer or recompression where feasible'], ['administrative', 'Exclusion zone and wind check'], ['ppe', 'Hearing protection']], [], ['Purging']),
  H('hz-6', 'Welding', 'Burns, fumes, arc flash', [['engineering', 'Local exhaust in pits'], ['administrative', 'Fire watch 30 minutes after hot work'], ['ppe', 'Welding hood, gloves, FR clothing']], ['Hot work permit'], ['Welding (qualified procedure)']),
  H('hz-7', 'Pressure testing', 'Stored energy / test failure', [['engineering', 'Test heads rated and inspected'], ['administrative', 'Restricted zone during pressurization; no one in line of fire'], ['administrative', 'Test procedure and pressure chart recorder calibrated']], [], ['Pressure testing']),
  H('hz-8', 'Pressure testing', 'Test water discharge', [['administrative', 'Discharge per permit; sampling'], ['engineering', 'Dechlorination and energy dissipation']], ['Discharge permit']),
  H('hz-9', 'Traffic control', 'Struck by vehicles', [['engineering', 'Approved traffic control plan; arrow boards'], ['administrative', 'Flaggers certified'], ['ppe', 'Class 3 high-visibility garments at night']], ['Encroachment permit']),
  H('hz-10', 'Confined space', 'Oxygen deficiency / toxic atmosphere', [['administrative', 'Permit-required confined space entry with attendant'], ['engineering', 'Forced-air ventilation and continuous monitoring'], ['administrative', 'Rescue plan on site']], ['Confined space permit']),
  H('hz-11', 'Lifting & rigging', 'Dropped load / crane contact', [['administrative', 'Lift plan for critical lifts'], ['administrative', 'Qualified rigger and signal person'], ['engineering', 'Tag lines; exclusion zone']], ['Lift plan']),
  H('hz-12', 'HDD', 'Inadvertent return / frac-out', [['administrative', 'Frac-out contingency plan'], ['engineering', 'Annular pressure monitoring'], ['administrative', 'Biological monitor near waterways']]),
  H('hz-13', 'Work near energized lines', 'Electrical contact', [['administrative', 'Minimum approach distances; spotter'], ['engineering', 'Insulated barriers where required']]),
  H('hz-14', 'All outdoor work', 'Heat illness', [['administrative', 'Water, shade and rest per heat illness plan above 80°F'], ['administrative', 'High-heat procedures above 95°F; acclimatization']]),
  H('hz-15', 'Station work', 'Hazardous energy release', [['administrative', 'Lockout/tagout with gas control coordination'], ['engineering', 'Double block and bleed']], [], ['Isolation & LOTO']),
  H('hz-16', 'Coating & cleaning', 'Silica / respirable dust', [['engineering', 'Wet methods or vacuum capture'], ['ppe', 'Respirator per exposure assessment']]),
  H('hz-17', 'Heavy equipment', 'Struck-by / caught-between', [['administrative', 'Spotter for backing equipment'], ['engineering', 'Backup alarms and cameras']]),
  H('hz-18', 'Public interface', 'Public entering work zone', [['engineering', 'Fencing and barricades'], ['administrative', 'Notice to residents 72 hours ahead']]),
]

export const RISK_LIBRARY: RiskLibraryItem[] = [
  { id: 'rl-1', title: 'Unknown substructures', category: 'Third-party / substructures', cause: 'Incomplete records of foreign utilities in the alignment', event: 'Conflicts found during excavation', effect: 'Redesign, standby time, crew productivity loss', appliesTo: ['replace-open-trench', 'replace-hdd', 'hydrotest'], typicalCostPct: 4, typicalDays: 25 },
  { id: 'rl-2', title: 'Encroachment permit delay', category: 'Permitting', cause: 'Agency backlog and moratoria on paving', event: 'Permit issued later than need date', effect: 'Construction start slips', appliesTo: ['replace-open-trench', 'replace-hdd', 'hydrotest', 'valve-automation'], typicalCostPct: 2, typicalDays: 45 },
  { id: 'rl-3', title: 'Contaminated soil', category: 'Environmental', cause: 'Historic industrial land use near alignment', event: 'Hazardous soil encountered', effect: 'Disposal cost and handling delays', appliesTo: ['replace-open-trench', 'station-rebuild', 'compressor-replacement'], typicalCostPct: 3, typicalDays: 20 },
  { id: 'rl-4', title: 'Pipe delivery late', category: 'Material', cause: 'Mill capacity and coating lead times', event: 'Line pipe arrives after required-on-site date', effect: 'Critical path slip, crew demob/remob', appliesTo: ['replace-open-trench', 'replace-hdd'], typicalCostPct: 2, typicalDays: 60 },
  { id: 'rl-5', title: 'Outage window lost', category: 'Operations', cause: 'System demand or other outages', event: 'Gas control cannot release the line on plan', effect: 'Tie-in and test delayed to next window', appliesTo: ['replace-open-trench', 'replace-hdd', 'hydrotest', 'valve-automation'], typicalCostPct: 1.5, typicalDays: 90 },
  { id: 'rl-6', title: 'Land rights not secured', category: 'Land / right-of-way', cause: 'Owner negotiations stall', event: 'TRE or easement not executed by need date', effect: 'Reroute or condemnation; delay', appliesTo: ['replace-open-trench', 'replace-hdd', 'valve-automation'], typicalCostPct: 2.5, typicalDays: 75 },
  { id: 'rl-7', title: 'Test failure', category: 'Technical', cause: 'Undetected manufacturing or construction defects', event: 'Section fails hydrostatic test', effect: 'Replacement and retest', appliesTo: ['hydrotest'], typicalCostPct: 6, typicalDays: 35 },
  { id: 'rl-8', title: 'HDD frac-out', category: 'Environmental', cause: 'Unfavorable geology', event: 'Drilling fluid surfaces', effect: 'Cleanup, agency notice, stoppage', appliesTo: ['replace-hdd'], typicalCostPct: 3, typicalDays: 15 },
  { id: 'rl-9', title: 'Contractor productivity below plan', category: 'Productivity', cause: 'Congested urban corridor and work-hour limits', event: 'Footage per day below estimate', effect: 'Labor cost overrun', appliesTo: ['replace-open-trench', 'replace-hdd'], typicalCostPct: 5, typicalDays: 30 },
  { id: 'rl-10', title: 'Electrical interconnect delay', category: 'Third-party / substructures', cause: 'Electric utility interconnection queue', event: 'Service not energized on schedule', effect: 'Commissioning slip', appliesTo: ['compressor-replacement', 'station-rebuild', 'valve-automation'], typicalCostPct: 2, typicalDays: 120 },
  { id: 'rl-11', title: 'Air permit conditions tighten', category: 'Regulatory change', cause: 'Air district rule amendments', event: 'Additional controls required', effect: 'Design change and equipment cost', appliesTo: ['compressor-replacement', 'station-rebuild'], typicalCostPct: 2, typicalDays: 60 },
  { id: 'rl-12', title: 'Weather / rain season', category: 'Weather', cause: 'Winter storms', event: 'Excavation halted', effect: 'Standby cost', appliesTo: ['replace-open-trench', 'hydrotest', 'replace-hdd'], typicalCostPct: 1, typicalDays: 20 },
  { id: 'rl-13', title: 'Records gaps found', category: 'Records', cause: 'Incomplete historic records', event: 'Additional segments need testing', effect: 'Scope growth', appliesTo: ['hydrotest', 'replace-open-trench'], typicalCostPct: 4, typicalDays: 40 },
  { id: 'rl-14', title: 'Bid exceeds estimate', category: 'Market', cause: 'Tight contractor market', event: 'Low bid above Class 3 range', effect: 'Re-bid or self-perform', appliesTo: ['replace-open-trench', 'replace-hdd', 'compressor-replacement', 'station-rebuild', 'valve-automation'], typicalCostPct: 8, typicalDays: 45 },
  { id: 'rl-15', title: 'Favorable steel pricing', category: 'Material', cause: 'Commodity price softening', event: 'Pipe purchased below estimate', effect: 'Material savings', appliesTo: ['replace-open-trench', 'replace-hdd'], typicalCostPct: -2, typicalDays: 0 },
]

// ── WBS functions (CBS Level 3) the forecast is spread against (product default; editable in Configuration).
export const WBS_FUNCTIONS: WbsFunction[] = [
  // Sample WBS functions (CBS level 3) for the fictional utility. Contingency (990) is held separately, not spread to a function.
  { id: 'wbs-100', code: '100', name: 'Project Management', description: 'Owner project management and construction management staff for the life of the project.', categoryIds: ['cat-pmc'], timing: 'flat' },
  { id: 'wbs-200', code: '200', name: 'Engineering and Design', description: 'Design, survey, engineering reviews and engineering documentation.', categoryIds: ['cat-eng'], timing: 'early' },
  { id: 'wbs-300', code: '300', name: 'Material - Permanent', description: 'Material that is installed and stays with the asset.', categoryIds: ['cat-pipe', 'cat-valves', 'cat-equipment'], timing: 'early' },
  { id: 'wbs-390', code: '390', name: 'Material - Consumable & Temporary', description: 'Material used up or removed during the work: test water, temporary facilities, supplies.', categoryIds: ['cat-test'], timing: 'mid' },
  { id: 'wbs-400', code: '400', name: 'Fabrication', description: 'Off-site assembly work.', categoryIds: ['cat-fabrication'], timing: 'early' },
  { id: 'wbs-500', code: '500', name: 'Construction', description: 'Field installation labor, equipment and quality control.', categoryIds: ['cat-contract', 'cat-traffic', 'cat-restore', 'cat-inspect'], timing: 'mid' },
  { id: 'wbs-600', code: '600', name: 'Commissioning', description: 'Checkout and commissioning of installed systems.', categoryIds: ['cat-commission'], timing: 'late' },
  { id: 'wbs-700', code: '700', name: 'Operations', description: 'Operating-crew support to the project, such as isolation, purge and startup.', categoryIds: ['cat-co-labor'], timing: 'mid' },
  { id: 'wbs-800', code: '800', name: 'Project Support Services', description: 'Shared project services: controls, PMO, closeout, regulatory, supply chain, outreach, safety, IT.', categoryIds: ['cat-support'], timing: 'flat' },
  { id: 'wbs-850', code: '850', name: 'Environmental', description: 'Environmental studies, monitoring and closeout.', categoryIds: ['cat-env'], timing: 'early' },
  { id: 'wbs-860', code: '860', name: 'Land & Right of Way', description: 'Land and right-of-way labor and agreements.', categoryIds: ['cat-land'], timing: 'early' },
  { id: 'wbs-870', code: '870', name: 'Land', description: 'Land purchases.', categoryIds: ['cat-land-purchase'], timing: 'early' },
  { id: 'wbs-880', code: '880', name: 'Permitting', description: 'Permit fees.', categoryIds: ['cat-permit-fees'], timing: 'early' },
  { id: 'wbs-900', code: '900', name: 'Project Overhead', description: 'Indirect costs applied to the project, such as overheads and AFUDC.', categoryIds: ['cat-loaders'], timing: 'flat' },
  { id: 'wbs-999', code: '999', name: 'Undifferentiated', description: 'Costs not assigned to a function.', categoryIds: ['cat-undiff'], timing: 'flat' },
]

export const INFO_SECTIONS = ['Identification', 'Need & justification', 'Scope & asset', 'Location', 'Regulatory & funding', 'Operations & customers', 'Constraints & stakeholders', 'Closeout']

const F = (section: string, key: string, label: string, type: InfoFieldDef['type'], extra: Partial<InfoFieldDef> = {}): InfoFieldDef => ({ section, key, label, type, ...extra })
export const INFO_FIELDS: InfoFieldDef[] = [
  F('Identification', 'name', 'Project name', 'text', { bind: 'name', requiredAtStage: 0 }),
  F('Identification', 'program', 'Program', 'text', { readOnly: true }),
  F('Identification', 'projectType', 'Project type', 'select', { options: ['Pipe replacement', 'Pressure test', 'Abandonment', 'New installation', 'Station modernization', 'Valve automation', 'Main replacement'], requiredAtStage: 0 }),
  F('Identification', 'erpWbs', 'ERP WBS element', 'text', { bind: 'erpWbs', requiredAtStage: 0 }),
  F('Identification', 'workOrder', 'Work order authorization (WOA) no.', 'text', { requiredAtStage: 2, help: 'Phase 2 WOA approved before execution' }),
  F('Identification', 'scheduleId', 'Schedule (P6) ID', 'text', { bind: 'scheduleId', requiredAtStage: 1 }),
  F('Identification', 'pm', 'Project manager', 'text', { readOnly: true }),
  F('Identification', 'sponsor', 'Sponsor', 'text', { readOnly: true }),
  F('Need & justification', 'problemStatement', 'Problem statement', 'textarea', { requiredAtStage: 0, help: 'What condition exists today and why it must be addressed' }),
  F('Need & justification', 'driver', 'Primary driver', 'select', { bind: 'driver', options: ['Safety / compliance', 'Reliability', 'Capacity', 'Customer / new business', 'Relocation', 'Environmental'], requiredAtStage: 0 }),
  F('Need & justification', 'regulatoryCitation', 'Regulatory citation', 'text', { bind: 'regulatoryCitation', requiredAtStage: 0 }),
  F('Need & justification', 'consequence', 'Consequence of not doing the work', 'textarea', { requiredAtStage: 0 }),
  F('Need & justification', 'alternatives', 'Alternatives considered', 'textarea', { requiredAtStage: 1 }),
  F('Need & justification', 'selectedRationale', 'Why the selected alternative', 'textarea', { requiredAtStage: 1 }),
  F('Need & justification', 'benefits', 'Benefits and risk reduced', 'textarea', { requiredAtStage: 1 }),
  F('Scope & asset', 'scopeSummary', 'Scope summary', 'textarea', { bind: 'scope.summary', requiredAtStage: 0 }),
  F('Scope & asset', 'lineId', 'Line / facility ID', 'text', { bind: 'asset.lineId', requiredAtStage: 0 }),
  F('Scope & asset', 'diameter', 'Diameter (in)', 'number', { bind: 'asset.diameterIn' }),
  F('Scope & asset', 'length', 'Length (ft)', 'number', { bind: 'asset.lengthFt' }),
  F('Scope & asset', 'maop', 'MAOP (psig)', 'number', { bind: 'asset.maopPsig', requiredAtStage: 0 }),
  F('Scope & asset', 'material', 'Material / grade', 'text', { bind: 'asset.material' }),
  F('Scope & asset', 'vintage', 'Vintage (year installed)', 'number', { bind: 'asset.vintage' }),
  F('Scope & asset', 'records', 'Pressure-test records status', 'select', { bind: 'asset.recordsStatus', options: ['complete', 'gaps', 'unknown'], requiredAtStage: 0 }),
  F('Location', 'city', 'City', 'text', { bind: 'location.city', requiredAtStage: 0 }),
  F('Location', 'county', 'County', 'text', { bind: 'location.county' }),
  F('Location', 'district', 'Operating district', 'text', { bind: 'location.district', requiredAtStage: 0 }),
  F('Location', 'classLocation', 'Class location', 'select', { bind: 'location.classLocation', options: ['1', '2', '3', '4'] }),
  F('Location', 'hca', 'High consequence area', 'boolean', { bind: 'location.hca' }),
  F('Location', 'dac', 'Disadvantaged community', 'boolean', { bind: 'location.dac' }),
  F('Location', 'lat', 'Latitude (WGS84)', 'number', { bind: 'location.lat', requiredAtStage: 0, help: 'Decimal degrees, e.g. 35.4231 — set on the Map tab by clicking, pasting or importing KML' }),
  F('Location', 'lng', 'Longitude (WGS84)', 'number', { bind: 'location.lng', requiredAtStage: 0, help: 'Decimal degrees, e.g. -119.8765' }),
  F('Location', 'crossings', 'Major crossings (freeway, rail, water)', 'textarea', { requiredAtStage: 1 }),
  F('Regulatory & funding', 'recovery', 'Cost recovery mechanism', 'text', { readOnly: true }),
  F('Regulatory & funding', 'proceeding', 'Proceeding / funding source', 'text', { bind: 'fundingProceeding', requiredAtStage: 0 }),
  F('Regulatory & funding', 'grcWorkpaper', 'GRC workpaper reference', 'text'),
  F('Regulatory & funding', 'ceqaPath', 'CEQA path', 'select', { options: ['Exempt', 'Initial study / MND', 'EIR', 'Not applicable'], requiredAtStage: 1 }),
  F('Regulatory & funding', 'cpcn', 'CPCN required', 'select', { options: ['No', 'Yes', 'Under review'], requiredAtStage: 1 }),
  F('Operations & customers', 'outage', 'Outage / clearance requirements', 'textarea', { requiredAtStage: 2, help: 'Windows, gas control constraints, bypass' }),
  F('Operations & customers', 'customersAffected', 'Customers affected by service interruption', 'number', { requiredAtStage: 2 }),
  F('Operations & customers', 'temporarySupply', 'Temporary supply plan (CNG/LNG/bypass)', 'textarea'),
  F('Operations & customers', 'communityImpact', 'Community and traffic impact', 'textarea', { requiredAtStage: 2 }),
  F('Constraints & stakeholders', 'constraints', 'Key constraints', 'textarea', { requiredAtStage: 1 }),
  F('Constraints & stakeholders', 'workWindows', 'Work-hour and seasonal windows', 'text'),
  F('Constraints & stakeholders', 'agencies', 'Agencies and jurisdictions', 'textarea', { requiredAtStage: 1 }),
  F('Constraints & stakeholders', 'stakeholders', 'External stakeholders', 'textarea'),
  F('Closeout', 'inService', 'In-service date', 'date', { bind: 'dates.inService', requiredAtStage: 3 }),
  F('Closeout', 'assetUnits', 'Asset units placed in service', 'textarea', { requiredAtStage: 4 }),
  F('Closeout', 'gisUpdated', 'GIS updated with as-builts', 'select', { options: ['No', 'Yes'], requiredAtStage: 4 }),
]

// ── Forecast line items (FC-10): each rolls up to one WBS function; SAP actuals land here via the mapping table.
const FL = (id: string, code: string, name: string, functionId: string, categoryIds: string[], note?: string): ForecastLine => ({ id, code, name, functionId, categoryIds, active: true, note })
export const FORECAST_LINES: ForecastLine[] = [
  FL('fl-100', '100.10', 'Project management', 'wbs-100', ['cat-pmc']),
  FL('fl-200', '200.10', 'Engineering, survey & design', 'wbs-200', ['cat-eng'], 'Outside engineering plus company engineering labor charged to the .02 sub-WBS'),
  FL('fl-300-10', '300.10', 'Pipe & fittings', 'wbs-300', ['cat-pipe']),
  FL('fl-300-20', '300.20', 'Valves & actuators', 'wbs-300', ['cat-valves']),
  FL('fl-300-30', '300.30', 'Major equipment', 'wbs-300', ['cat-equipment']),
  FL('fl-390', '390.10', 'Test water, consumables & temporary bypasses', 'wbs-390', ['cat-test']),
  FL('fl-400', '400.10', 'Fabrication', 'wbs-400', ['cat-fabrication']),
  FL('fl-500-10', '500.10', 'Contract construction', 'wbs-500', ['cat-contract']),
  FL('fl-500-20', '500.20', 'Traffic control', 'wbs-500', ['cat-traffic']),
  FL('fl-500-30', '500.30', 'Restoration & paving', 'wbs-500', ['cat-restore']),
  FL('fl-500-40', '500.40', 'Construction inspection & NDE', 'wbs-500', ['cat-inspect']),
  FL('fl-600', '600.10', 'Commissioning', 'wbs-600', ['cat-commission']),
  FL('fl-700', '700.10', 'Operations (safe-out, safe-in, startup)', 'wbs-700', ['cat-co-labor']),
  FL('fl-800', '800.10', 'Project support services', 'wbs-800', ['cat-support'], 'Project controls, PMO, closeout, regulatory, supply management, outreach'),
  FL('fl-850', '850.10', 'Environmental', 'wbs-850', ['cat-env']),
  FL('fl-860', '860.10', 'Land & right-of-way labor', 'wbs-860', ['cat-land']),
  FL('fl-870', '870.10', 'Land purchase', 'wbs-870', ['cat-land-purchase']),
  FL('fl-880', '880.10', 'Permitting fees', 'wbs-880', ['cat-permit-fees']),
  FL('fl-900', '900.10', 'Project overhead (AFUDC, allocations)', 'wbs-900', ['cat-loaders'], 'Overhead, benefits and AFUDC settlements from SAP'),
  FL('fl-999', '999.10', 'Undifferentiated', 'wbs-999', ['cat-undiff']),
]

// ── SAP cost element → forecast line mapping (FC-11). Lower priority number runs first; first match wins.
const M = (id: string, priority: number, from: string, to: string, target: SapMapping['target'], lineId: string | undefined, note: string, extra: Partial<SapMapping> = {}): SapMapping => ({ id, priority, costElementFrom: from, costElementTo: to, target, lineId, note, active: true, ...extra })
export const SAP_MAPPINGS: SapMapping[] = [
  M('map-01', 10, '5100000', '5199999', 'line', 'fl-200', 'Company labor charged to the engineering sub-WBS is engineering, not operations', { wbsSuffix: '.02' }),
  M('map-02', 20, '5100000', '5199999', 'line', 'fl-700', 'Company labor — operations support (safe-out, safe-in, startup)'),
  M('map-03', 30, '5200000', '5209999', 'line', 'fl-500-10', 'Contract services — construction, equipment rental, change orders'),
  M('map-04', 40, '5310000', '5319999', 'line', 'fl-300-10', 'Material — line pipe, fittings, coating'),
  M('map-05', 41, '5320000', '5329999', 'line', 'fl-300-20', 'Material — valves & actuators'),
  M('map-06', 42, '5330000', '5339999', 'line', 'fl-300-30', 'Material — major equipment'),
  M('map-07', 43, '5340000', '5349999', 'line', 'fl-400', 'Fabrication — shop assembly'),
  M('map-08', 50, '5400000', '5409999', 'line', 'fl-200', 'Outside engineering services'),
  M('map-09', 55, '5500000', '5509999', 'line', 'fl-860', 'Land & right-of-way labor, appraisal, title'),
  M('map-10', 56, '5510000', '5519999', 'line', 'fl-850', 'Environmental consultants, monitoring, water treatment'),
  M('map-11', 57, '5520000', '5529999', 'line', 'fl-870', 'Land purchase'),
  M('map-12', 58, '5530000', '5539999', 'line', 'fl-880', 'Permit fees (municipal, environmental, land)'),
  M('map-13', 60, '5600000', '5609999', 'line', 'fl-500-40', 'Construction inspection — weld, NDE, coating'),
  M('map-14', 61, '5610000', '5619999', 'line', 'fl-390', 'Test water, consumables, temporary bypasses'),
  M('map-15', 62, '5620000', '5629999', 'line', 'fl-600', 'Commissioning services'),
  M('map-16', 70, '5700000', '5709999', 'line', 'fl-500-30', 'Paving & restoration'),
  M('map-17', 71, '5710000', '5719999', 'line', 'fl-500-20', 'Traffic control services'),
  M('map-18', 80, '5800000', '5809999', 'line', 'fl-100', 'Project management services'),
  M('map-19', 81, '5810000', '5819999', 'line', 'fl-800', 'Project support services — controls, PMO, closeout, outreach'),
  M('map-20', 90, '5900000', '5949999', 'line', 'fl-900', 'Overhead, benefits and AFUDC settlements'),
  M('map-21', 91, '5980000', '5989999', 'line', 'fl-999', 'Costs not tied to a specific function'),
  M('map-22', 95, '1400000', '1499999', 'exclude', undefined, 'Balance-sheet inventory transfers are not project cost'),
]

// ── Custom spread profiles (FC-12) beyond the built-in curves.
export const SPREAD_PROFILES: SpreadProfile[] = [
  { id: 'prof-material', name: 'Material order: deposit + delivery', description: '20% deposit at order, balance on delivery near the end of the window', weights: [20, 0, 0, 0, 0, 0, 10, 70] },
  { id: 'prof-mobilize', name: 'Mobilize, produce, demobilize', description: 'Ramp up over the first quarter, steady production, short tail', weights: [3, 8, 12, 14, 14, 14, 14, 12, 6, 3] },
  { id: 'prof-retention', name: 'Progress with 5% retention', description: 'Steady progress billing; retention released in the last month', weights: [9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 5] },
  { id: 'prof-moratorium', name: 'Paving — holiday moratorium', description: 'Even, with no paving in November–January (city moratorium)', weights: [1], zeroMonths: [11, 12, 1] },
  { id: 'prof-closeout', name: 'Closeout tail', description: 'Most cost in the last two months: as-builts, records, final invoices', weights: [1, 1, 1, 2, 6, 10] },
]

export const REGION_FACTORS: Record<string, number> = { West: 1.12, East: 1.0, South: 0.94, North: 0.97 }
export const REGIONS = ['North', 'West', 'South', 'East']

export const TAX_RATES = [
  { county: 'Coastline County', rate: 7.75 },
  { county: 'Arroyo County', rate: 9.5 },
  { county: 'Sierra Mesa County', rate: 8.25 },
]

export const UNITS = [
  { id: 'ft', label: 'Feet' }, { id: 'mi', label: 'Miles' }, { id: 'ea', label: 'Each' }, { id: 'site', label: 'Sites' },
  { id: 'hp', label: 'Horsepower' }, { id: 'LS', label: 'Lump sum' }, { id: 'day', label: 'Days' }, { id: 'hr', label: 'Hours' },
  { id: 'ton', label: 'Tons' }, { id: 'cy', label: 'Cubic yards' }, { id: 'sf', label: 'Square feet' },
]

export const QUANTITY_TYPES = [
  { id: 'qt-pipe', label: 'Pipe installed', unit: 'ft', feeds: 'lengthFt' as const },
  { id: 'qt-tested', label: 'Pipe tested', unit: 'ft', feeds: 'lengthFt' as const },
  { id: 'qt-abandon', label: 'Pipe abandoned in place', unit: 'ft' },
  { id: 'qt-tieins', label: 'Tie-ins', unit: 'ea', feeds: 'tieIns' as const },
  { id: 'qt-services', label: 'Services transferred', unit: 'ea', feeds: 'services' as const },
  { id: 'qt-sections', label: 'Test sections', unit: 'ea' },
  { id: 'qt-short', label: 'Short-section replacements', unit: 'ea' },
  { id: 'qt-valves', label: 'Valve sites automated', unit: 'site', feeds: 'sites' as const },
  { id: 'qt-units', label: 'Compressor units', unit: 'ea' },
  { id: 'qt-hp', label: 'Station capacity', unit: 'hp', feeds: 'hp' as const },
  { id: 'qt-reg', label: 'Regulator stations', unit: 'ea' },
]

export const SCOPE_LIBRARY = {
  inScope: [
    'Engineering, survey and design', 'Land rights and permits', 'Construction and inspection', 'Tie-ins and gas handling', 'Restoration',
    'Hydrostatic strength test', 'Abandonment of existing pipe in place', 'Valve and actuator installation', 'SCADA RTU and communications',
    'Site civil work', 'Commissioning with gas control', 'Compressor units and motors', 'Substation and interconnect', 'Station piping and controls',
    'Demolition of legacy units', 'Air permit compliance', 'Service transfers', 'Traffic control', 'Environmental monitoring',
  ],
  outOfScope: [
    'Customer meter work', 'Unrelated leak repairs', 'Third-party relocations', 'Paving beyond trench restoration limits', 'Land acquisition by condemnation',
    'Unknown contamination remediation', 'Distribution system reinforcement', 'Permanent landscaping',
  ],
  assumptions: [
    'Outage windows available October–April', 'Work hours 7 AM–6 PM weekdays in residential areas', 'No groundwater dewatering beyond 2 ft',
    'Night work not required', 'Existing easements are sufficient', 'Pipe available from stock within 12 weeks', 'Single mobilization',
  ],
}

// ── Historical cost table (ES-20): direct $/unit from closed projects, base-year dollars.
// Built from the unit-rate library so the demo's Class 5 quick estimates agree with its parametric estimates.
export function buildHistoricalCosts(rates: UnitCostRate[]): HistoricalCost[] {
  const out: HistoricalCost[] = []
  let k = 0
  const codes = ['PRJ-0871', 'PRJ-0904', 'PRJ-0912', 'PRJ-0933', 'PRJ-0957', 'PRJ-0968', 'PRJ-0981', 'PRJ-0995', 'PRJ-1003', 'PRJ-1011', 'PRJ-1017', 'PRJ-1024']
  const add = (assetType: AssetType, workMethod: WorkMethod, diameterBand: DiameterBand, terrain: Terrain | 'any', unit: HistUnit, rep: { dia: number; terrain: Terrain; len: number; qty: number; sites?: number }) => {
    const proj = { asset: { type: assetType, diameterIn: rep.dia, lengthFt: rep.len }, workMethod, location: { terrain: rep.terrain }, scope: { quantities: [{ label: 'Valve sites', qty: rep.sites ?? 1, unit: 'ea' }] } } as unknown as Project
    const lines = parametricLines(proj, rates)
    if (!lines.length) return
    const byCat: Record<string, number> = {}
    for (const l of lines) byCat[l.categoryId] = (byCat[l.categoryId] || 0) + l.qty * l.unitCost
    const tot = Object.values(byCat).reduce((a, b) => a + b, 0)
    const per = tot / rep.qty
    k++
    const wob = 0.94 + ((k * 37) % 13) / 100 // history is never exactly the library
    const n = 3 + ((k * 7) % 11)
    out.push({
      id: `hc-${k}`, assetType, workMethod, diameterBand, terrain, unit,
      p50: Math.round(per * wob), p10: Math.round(per * wob * (0.7 + (k % 3) * 0.03)), p90: Math.round(per * wob * (1.38 + (k % 4) * 0.06)),
      n, baseYear: k % 3 ? 2025 : 2024,
      mix: Object.fromEntries(Object.entries(byCat).map(([c, v]) => [c, +(v / tot).toFixed(4)])),
      sources: codes.filter((_, i) => (i + k) % 3 === 0).slice(0, Math.min(n, 5)),
      updatedAt: '2026-07-15', updatedById: 'u-estl', active: true,
      note: n < 5 ? 'Small sample — confirm with the estimating lead' : undefined,
    })
  }
  const bands: [DiameterBand, number][] = [['10-16', 16], ['20-24', 24], ['26-36', 30]]
  for (const wm of ['replace-open-trench', 'replace-hdd'] as WorkMethod[])
    for (const [b, d] of bands) for (const t of ['urban', 'suburban', 'rural'] as Terrain[]) add('transmission-pipeline', wm, b, t, 'ft', { dia: d, terrain: t, len: 15_000, qty: 15_000 })
  for (const t of ['urban', 'suburban', 'rural'] as Terrain[]) add('transmission-pipeline', 'hydrotest', 'n/a', t, 'ft', { dia: 20, terrain: t, len: 25_000, qty: 25_000 })
  for (const t of ['urban', 'suburban', 'rural'] as Terrain[]) add('distribution-main', 'replace-open-trench', 'le-8', t, 'ft', { dia: 6, terrain: t, len: 8_000, qty: 8_000 })
  add('valve-site', 'valve-automation', 'n/a', 'any', 'site', { dia: 24, terrain: 'suburban', len: 0, qty: 3, sites: 3 })
  add('compressor-station', 'compressor-replacement', 'n/a', 'any', 'hp', { dia: 0, terrain: 'rural', len: 0, qty: 22_000 })
  add('compressor-station', 'station-rebuild', 'n/a', 'any', 'hp', { dia: 0, terrain: 'rural', len: 0, qty: 9_000 })
  k++
  out.push({ id: `hc-${k}`, assetType: 'regulator-station', workMethod: 'station-rebuild', diameterBand: 'n/a', terrain: 'any', unit: 'station', p10: 1_900_000, p50: 2_750_000, p90: 4_100_000, n: 9, baseYear: 2025, mix: { 'cat-equipment': 0.24, 'cat-contract': 0.38, 'cat-eng': 0.12, 'cat-co-labor': 0.1, 'cat-land': 0.04, 'cat-env': 0.03, 'cat-inspect': 0.03, 'cat-pmc': 0.06 }, sources: ['PRJ-0912', 'PRJ-0968', 'PRJ-1011'], updatedAt: '2026-07-15', updatedById: 'u-estl', active: true })
  return out
}

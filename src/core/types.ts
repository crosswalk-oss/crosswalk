// Crosswalk domain model. Every module reads and writes these shapes through the store.
// Rules: records are never hard-deleted; approved estimates, snapshots, gate decisions
// and workflow history are immutable (create a new version instead of editing).

export type ID = string
export type ISODate = string // 'YYYY-MM-DD'
export type ISODateTime = string // full ISO timestamp
export type Money = number // whole US dollars
export type RAG = 'green' | 'amber' | 'red'
export type AaceClass = 1 | 2 | 3 | 4 | 5

// ───────────────────────────── People & organization
export type RoleId =
  | 'exec' | 'sponsor' | 'program-manager' | 'pm' | 'engineer' | 'estimator' | 'estimating-lead'
  | 'project-controls' | 'scheduler' | 'finance' | 'pmo' | 'gate-board' | 'safety-advisor'
  | 'construction-manager' | 'contractor-safety' | 'environmental' | 'land' | 'supply' | 'legal'
  | 'records' | 'plant-accounting' | 'admin'

export interface Role { id: RoleId; name: string; description: string }

export interface Person {
  id: ID
  name: string
  title: string
  roles: RoleId[]
  email: string
  managerId?: ID
  dollarAuthority: Money // max $ this person may approve under the DOA matrix
  company?: string // set for contractor staff
  outOfOffice?: { from: ISODate; to: ISODate; delegateId: ID }
}

export type TeamPosition =
  | 'sponsor' | 'pm' | 'engineer' | 'estimator' | 'projectControls' | 'scheduler'
  | 'constructionManager' | 'safety' | 'environmental' | 'land'

// ───────────────────────────── Programs, funding, lifecycle templates
export type RecoveryMechanism = 'GRC base' | 'Balancing account' | 'Memorandum account' | 'Customer-funded' | 'Advice letter'

export interface Program {
  id: ID
  code: string // e.g. 'PSE'
  name: string
  description: string
  regulatoryDriver: string
  recovery: RecoveryMechanism
  lifecycleTemplateId: ID
  doaMatrixId: ID
}

export interface FundingEnvelope {
  id: ID
  programId: ID
  year: number
  authorized: Money
  proceeding: string // e.g. 'AV-PUC-2026-06 (fictional) (TY2028 GRC)'
}

export type ConditionOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'truthy' | 'falsy'
/** A rule evaluated against a flat object (project attributes or workflow form data). `field` may be a dotted path. */
export interface Condition { field: string; op: ConditionOp; value?: unknown }

export type DeliverableKind = 'document' | 'estimate' | 'risk-register' | 'safety-plan' | 'schedule' | 'checklist' | 'permit' | 'records'

export interface DeliverableDef {
  id: ID
  name: string
  description: string
  kind: DeliverableKind
  ownerRole: RoleId
  reviewerRole: RoleId
  condition?: Condition // only required when the condition holds for the project
  acceptance: string // acceptance criteria shown to reviewer
}

export type StagePermission = 'po-over-threshold' | 'contract-award' | 'construction-ntp' | 'long-lead-release' | 'place-in-service'

export interface GateDef {
  id: ID
  name: string // e.g. 'Gate 3 · Authorize construction'
  decisionRoles: RoleId[]
  requiredEstimateClass?: AaceClass // minimum class (numerically <=) the approved estimate must reach
  budgetEvent?: 'planning' | 'control' // approval converts the approved estimate into this budget kind
  deliverables: DeliverableDef[]
  unlocks: StagePermission[] // permissions granted once the gate is passed
}

export interface StageDef {
  id: ID
  index: number
  name: string
  purpose: string
  gate: GateDef // the gate at the END of this stage
}

export interface LifecycleTemplate {
  id: ID
  name: string
  description: string
  stages: StageDef[]
}

// ───────────────────────────── Projects
export type AssetType = 'transmission-pipeline' | 'distribution-main' | 'compressor-station' | 'valve-site' | 'storage-field' | 'regulator-station'
export type WorkMethod = 'replace-open-trench' | 'replace-hdd' | 'hydrotest' | 'abandon' | 'valve-automation' | 'station-rebuild' | 'compressor-replacement' | 'inline-inspection'
export type Terrain = 'urban' | 'suburban' | 'rural'
export type ProjectStatus = 'active' | 'on-hold' | 'cancelled' | 'closed'
export type Driver = 'Safety / compliance' | 'Reliability' | 'Capacity' | 'Customer / new business' | 'Relocation' | 'Environmental'

export interface Milestone { id: ID; name: string; baseline: ISODate; forecast: ISODate; actual?: ISODate }

export interface ScopeStatement {
  summary: string
  inScope: string[]
  outOfScope: string[]
  quantities: { label: string; qty: number; unit: string; typeId?: ID }[] // typeId → settings.estimating.quantityTypes
  assumptions: string[]
  capitalPct?: number // % of the work that is capital; the rest is O&M (placeholder split until IOs exist)
}

export interface Project {
  id: ID
  code: string // 'PRJ-1042'
  name: string
  programId: ID
  sizeTier: 'S' | 'M' | 'L' // <$5M, $5–50M, >$50M
  driver: Driver
  regulatoryCitation: string
  fundingProceeding: string
  location: {
    district: string
    city: string
    county: string
    x: number // 0–1000 on the schematic territory map
    y: number // 0–600
    classLocation: 1 | 2 | 3 | 4
    hca: boolean
    dac: boolean // disadvantaged community
    terrain: Terrain
    lat?: number // WGS84 latitude of the project point (site, valve, station or route midpoint)
    lng?: number // WGS84 longitude
    route?: [number, number][] // pipeline alignment as [lat, lng] vertices
    routeSource?: string // how the geometry was captured: 'Drawn', 'Imported KML', 'GIS', …
  }
  asset: {
    type: AssetType
    lineId: string
    diameterIn: number
    lengthFt: number
    maopPsig: number
    material: string
    vintage: number
    recordsStatus: 'complete' | 'gaps' | 'unknown'
  }
  workMethod: WorkMethod
  team: Partial<Record<TeamPosition, ID>>
  contractor?: string
  stageIndex: number // 0-based index into the template's stages
  status: ProjectStatus
  health: { scope: RAG; schedule: RAG; cost: RAG; risk: RAG; safety: RAG }
  scope: ScopeStatement
  milestones: Milestone[]
  dates: { initiated: ISODate; inService?: ISODate; closed?: ISODate }
  erpWbs: string
  scheduleId: string
  gisIds: string[]
  permitsNeeded: { ceqa: boolean; encroachment: boolean; hydrotestDischarge: boolean }
  customFields: Record<string, string>
  lastStatusNote?: string
  info: Record<string, string> // Project Information record values for fields without a `bind`
  /** Financial accounts: the WOA and internal orders (IOs) that charges land on. Key facts display them; the Finance tab manages them. */
  finance?: { woa?: string; ios: InternalOrder[] }
  /** Counties the work sits in, with the share of the work in each (drives sales tax on material in estimates). */
  counties?: { county: string; pct: number }[]
  /** Physical, legal and logistical cost drivers the Class 5 factor model reads (fictional demo values). */
  drivers?: ProjectDrivers
}

export interface InternalOrder {
  id: ID
  number: string // SAP internal order
  description: string
  type: 'capital' | 'om'
  status: 'requested' | 'open' | 'closed'
  opened?: ISODate
  functionIds: ID[] // WBS functions (estimate buckets) this IO carries
  note?: string
}

/** Definition of one Project Information field. `bind` stores the value on the project itself (dotted path). */
export interface InfoFieldDef {
  key: string
  label: string
  section: string
  type: 'text' | 'textarea' | 'select' | 'date' | 'money' | 'number' | 'boolean'
  options?: string[]
  help?: string
  bind?: string
  readOnly?: boolean
  requiredAtStage?: number // required before passing the gate at the end of this stage index
}

export interface InfoRevision {
  id: ID
  projectId: ID
  at: ISODateTime
  byId: ID
  note: string
  changes: { key: string; label: string; from: string; to: string }[]
}

export type DeliverableStatus = 'not-started' | 'in-progress' | 'submitted' | 'accepted' | 'returned' | 'waived'

export interface Evidence { id: ID; name: string; sizeKb: number; uploadedAt: ISODateTime; byId: ID }

export interface Deliverable {
  id: ID
  projectId: ID
  stageIndex: number
  defId: ID
  status: DeliverableStatus
  ownerId?: ID
  reviewerId?: ID
  due?: ISODate
  version: number
  evidence: Evidence[]
  notes?: string
  waiverReason?: string
  updatedAt: ISODateTime
}

export type GateOutcome = 'go' | 'go-with-conditions' | 'recycle' | 'hold' | 'cancel'

export interface GateDecision {
  id: ID
  projectId: ID
  stageIndex: number
  gateName: string
  date: ISODate
  outcome: GateOutcome
  decidedBy: ID[]
  readiness: number // 0–100 at decision time
  deliverableVersions: Record<ID, number> // deliverable id -> version reviewed
  estimateId?: ID
  snapshotId?: ID
  conditions: ID[] // Action ids
  notes: string
}

export interface Action {
  id: ID
  projectId: ID
  title: string
  ownerId: ID
  due: ISODate
  status: 'open' | 'done'
  source: 'gate' | 'risk' | 'safety' | 'review' | 'closeout'
  sourceId?: ID
}

export interface GateReview { id: ID; projectId: ID; stageIndex: number; scheduled: ISODate; board: ID[]; status: 'scheduled' | 'held' | 'cancelled' }

// ───────────────────────────── Estimating
export type CostGroup = 'direct' | 'indirect' | 'escalation' | 'contingency'
export interface CostCategory { id: ID; code: string; name: string; group: CostGroup; erpCostElement: string }

export interface UnitCostRate {
  id: ID
  assetType: AssetType
  workMethod: WorkMethod
  categoryId: ID
  description: string
  unit: string // 'ft', 'ea', 'LS', 'test section'
  diameterIn?: number
  terrain?: Terrain
  region?: string // region-specific rate; when absent the base rate × the region factor applies
  p10: number
  p50: number
  p90: number
  sampleSize: number // closed projects behind the rate
  basisYear: number
}

export type EstimateStatus = 'draft' | 'in-review' | 'approved' | 'superseded' | 'rejected'
export type LineSource = 'library' | 'quote' | 'analog' | 'judgment'

export interface EstimateLine {
  id: ID
  categoryId: ID
  workPackage: string
  description: string
  qty: number
  unit: string
  unitCost: number
  source: LineSource
  rateId?: ID
  confidence: 'low' | 'medium' | 'high'
  /** Unit cost comes from the rate table and is locked; only the estimating team may override it, with a reason. */
  override?: { byId: ID; at: ISODateTime; reason: string; fromUnitCost: number }
}

export interface BasisOfEstimate {
  scopeBasis: string
  assumptions: string[]
  exclusions: string[]
  contingencyRationale: string
  classJustification: string
}

/** Maturity checklist drives the AACE class (ES-04). Keys in MATURITY_ITEMS (engine/estimates.ts). */
export type MaturityChecklist = Record<string, boolean>

export interface Estimate {
  id: ID
  projectId: ID
  version: number
  title: string
  cls: AaceClass // computed from maturity at save time; never typed by hand
  status: EstimateStatus
  method: 'parametric' | 'line-item' | 'quick'
  quick?: QuickEstimate // Class 5 quick estimate from the historical cost table
  factor?: FactorEstimateRecord // set when the quick estimate was priced with the Class 5 factor model
  parametric?: ParametricRecord // set when the quick estimate was priced from the rate table + risk items (PM request)
  createdAt: ISODateTime
  createdById: ID
  approvedAt?: ISODateTime
  approvedById?: ID
  lines: EstimateLine[]
  maturity: MaturityChecklist
  loaders: { name: string; pct: number }[] // applied to direct cost
  escalationPct: number // applied to direct + loaders
  contingency: { method: 'deterministic' | 'risk-based'; pct: number; confidence?: 'P50' | 'P80' }
  basis: BasisOfEstimate
  workflowInstanceId?: ID
  /** Rate table version (settings.estimating.rateTableVersion) the unit costs were priced on. Absent on older records: inferred from createdAt. */
  rateTableVersion?: number
  /** Region whose rates and factor priced the estimate (project.location.district at pricing time). */
  region?: string
  /** Sales tax stamped at pricing: weighted % from the project's county split, applied to the taxable categories. */
  salesTax?: { pct: number; counties: { county: string; share: number; rate: number }[]; categoryIds: ID[] }
  /** Set when a bulk rate-table update created this version from an earlier one. */
  repricedFrom?: { estimateId: ID; fromVersion: number; fromRateTable: number; toRateTable: number }
}

export type DiameterBand = 'le-8' | '10-16' | '20-24' | '26-36' | 'n/a'
export type HistUnit = 'ft' | 'site' | 'hp' | 'station'

/** Historical unit cost from closed projects: direct cost per unit in base-year dollars (no loaders, escalation or contingency). */
export interface HistoricalCost {
  id: ID
  assetType: AssetType
  workMethod: WorkMethod
  diameterBand: DiameterBand
  terrain: Terrain | 'any'
  unit: HistUnit
  p10: number
  p50: number
  p90: number
  n: number // closed projects behind the figure
  baseYear: number
  mix: Record<ID, number> // share of direct cost by CBS category (sums to 1)
  sources: string[] // project codes or benchmark notes
  updatedAt: ISODate
  updatedById: ID
  note?: string
  active: boolean
}

export interface QuickInputs {
  assetType: AssetType
  workMethod: WorkMethod
  diameterBand: DiameterBand
  terrain: Terrain
  district: string
  qty: number
  unit: HistUnit
  midpointYear: number // year most of the spend happens
}

export interface QuickEstimate {
  inputs: QuickInputs
  historicalCostId: ID
  basis: 'p10' | 'p50' | 'p90'
  baseRate: number // $/unit from the table at `basis`
  regionFactor: number
  escalationFactor: number // base year → midpoint year
  direct: Money // qty × rate × region × escalation (before adjustment)
  range: { low: Money; high: Money } // P10 and P90 total incl. loaders/contingency
  requestNote: string
  needBy?: ISODate
  adjustment?: { pct: number; reason: string; byId: ID; at: ISODateTime; fromTotal: Money; toTotal: Money }
  reviewNote?: string
}

// ───────────────────────────── Class 5 factor model
// Factors may only bind to physical, legal or logistical cost drivers (AGENT_RULES 13–14). Demographic or wealth
// attributes of the community are deliberately NOT part of DriverValues, so no factor can be bound to them.
export type SoilClass = 'normal' | 'cobble' | 'rock'
export type PermitComplexity = 'ministerial' | 'discretionary' | 'major'
export type TrafficLevel = 'low' | 'moderate' | 'heavy'
export type WorkHours = 'standard' | 'restricted' | 'night'
export type Remoteness = 'local' | 'regional' | 'remote'

/** Cost drivers recorded on a project. */
export interface ProjectDrivers {
  soil: SoilClass
  permitComplexity: PermitComplexity
  traffic: TrafficLevel
  workHours: WorkHours
  crossings: number // road, rail and water crossings in the alignment
  remoteness: Remoteness // access, haul distance and crew travel
}

/** Site drivers an estimate is priced with: the project drivers plus class location and HCA from the location record. */
export interface SiteDrivers extends ProjectDrivers { classLocation: 1 | 2 | 3 | 4; hca: boolean }

/** Every value a factor can bind to (site drivers plus terrain). */
export interface DriverValues extends SiteDrivers { terrain: Terrain }
export type DriverKey = keyof DriverValues
export type FactorKind = 'physical' | 'legal' | 'logistical'

export interface FactorLevel { value: string; label: string; multiplier: number }

export interface ModelFactor {
  id: ID
  name: string
  kind: FactorKind
  driver: DriverKey
  levels: FactorLevel[] // one level per driver value; the baseline level has multiplier 1
  weight: number // 0–1: scales the effect, effective multiplier = 1 + weight × (multiplier − 1)
  cv: number // coefficient of variation of the factor's effect when the driver is off its baseline level
  appliesTo?: AssetType[] // absent = every asset type
  note?: string
}

/** Base direct $/unit for an asset type × work method × diameter band, at the reference quantity, base-year dollars. */
export interface ModelBaseRate {
  id: ID
  assetType: AssetType
  workMethod: WorkMethod
  diameterBand: DiameterBand
  unit: HistUnit
  rate: number
  refQty: number // quantity the rate was observed at (the size scale is 1 there)
  baseYear: number
  n: number
  mix: Record<ID, number> // share of direct cost by CBS category
  sourceRowId?: ID // historical cost row it was started from
}

export interface BacktestSummary {
  at: ISODateTime
  n: number
  mape: number // %
  medianApe: number // %
  bias: number // mean signed % error (+ = model over-predicts)
  coverage: number // % of actuals inside P10–P90
  passed: boolean
}

export interface FactorModel {
  id: ID
  name: string
  version: number
  status: 'draft' | 'in-review' | 'published' | 'retired'
  baseRates: ModelBaseRate[]
  scaleExponent: number // cost ∝ qty^scale around the reference quantity
  baseCv: number // coefficient of variation of the base rate
  factors: ModelFactor[]
  notes: string
  createdById: ID
  createdAt: ISODateTime
  parentVersion?: number // version this draft was copied from
  submittedAt?: ISODateTime
  approvedById?: ID
  approvedAt?: ISODateTime
  retiredAt?: ISODateTime
  workflowInstanceId?: ID
  backtest?: BacktestSummary // stored at submission
}

export interface PublishGate { maxMape: number; minCoverage: number; maxCoverage: number; maxAbsBias: number }

export interface FactorModelSettings {
  overrideReasons: string[] // estimator adjustments must cite one of these
  gate: PublishGate
  iterations: number // Monte Carlo draws
}

/** A closed project in the backtest set (fictional). Actual = final cost excluding contingency, midpoint-year dollars. */
export interface BacktestProject {
  id: ID
  code: string
  name: string
  assetType: AssetType
  workMethod: WorkMethod
  diameterBand: DiameterBand
  unit: HistUnit
  qty: number
  district: string
  midpointYear: number
  taxPct: number
  drivers: DriverValues
  actual: Money
}

/** Inputs to a factor-model estimate (the quick-estimate inputs plus the site drivers and sales tax). */
export interface FactorInputs extends QuickInputs { site: SiteDrivers; taxPct: number }

export interface FactorItem {
  id: string // factor id, or 'scale' | 'region' | 'escalation' | 'adjustment'
  label: string
  kind: FactorKind | 'size' | 'region' | 'escalation' | 'adjustment'
  level: string
  multiplier: number // effective multiplier applied
  weight?: number
  effect: Money // $ change in direct cost attributed to this driver
}

/** What a factor-model quick estimate was priced with, kept on the estimate. */
export interface FactorEstimateRecord {
  modelId: ID
  modelVersion: number
  baseRateId: ID
  baseline: Money // base rate × quantity, before any driver
  items: FactorItem[]
  sigma: number // lognormal sigma of the total
  p10: Money
  p50: Money
  p90: Money
  rateTable?: Money // Class 5 rate-table estimate for the same project at pricing time
  adjustment?: { pct: number; reason: string; note?: string; basis: 'p10' | 'p50' | 'p90' }
}

export interface BudgetVersion {
  id: ID
  projectId: ID
  kind: 'planning' | 'control'
  estimateId: ID
  createdAt: ISODate
  byCategory: Record<ID, Money> // excludes contingency
  contingency: Money
  total: Money
  byYear: Record<string, Money>
  postedToErp: boolean
}

// ───────────────────────────── Baselines & snapshots
export type SnapshotType = 'original' | 'current' | 'forecast' | 'period-close' | 'gate' | 'regulatory'

export interface Snapshot {
  id: ID
  projectId: ID
  type: SnapshotType
  label: string
  date: ISODate
  createdById: ID
  proceeding?: string
  changeId?: ID
  stageIndex: number
  scope: ScopeStatement
  milestones: Milestone[]
  budget: {
    byCategory: Record<ID, Money> // budget excluding contingency
    contingencyRemaining: Money
    total: Money // budget incl. contingency
    eac: Money
    actualToDate: Money
  }
  riskExposure: Money
}

export const ROOT_CAUSES = [
  'Scope growth', 'Design maturity', 'Permitting', 'Land / right-of-way', 'Material price',
  'Productivity', 'Weather', 'Third-party / substructures', 'Regulatory change', 'Safety stand-down', 'Estimate error', 'Opportunity realized',
] as const
export type RootCause = (typeof ROOT_CAUSES)[number]

export type ChangeStatus = 'draft' | 'in-review' | 'approved' | 'rejected'

export interface Change {
  id: ID
  projectId: ID
  code: string // 'CR-1042-03'
  title: string
  type: 'scope' | 'schedule' | 'cost' | 'trend'
  rootCause: RootCause
  description: string
  costImpact: Money
  scheduleImpactDays: number
  scopeImpact: string
  categoryId: ID // cost category affected
  fundedFrom: 'contingency' | 'new-funding' | 'none'
  status: ChangeStatus
  requestedById: ID
  requestedAt: ISODate
  decidedAt?: ISODate
  baselineSnapshotId?: ID
  resultingSnapshotId?: ID
  workflowInstanceId?: ID
  riskId?: ID
  contractIds?: ID[] // commitments the change affects
  scheduleNotice?: { schedulerId: ID; actionId?: ID; sentAt: ISODateTime; status: 'sent' | 'done' } // P6 is not written back; the scheduler gets a task
}

// ───────────────────────────── Cost control
/** One month of cost data per project. Values are for that month (not cumulative). */
export interface CostPeriod {
  id: ID
  projectId: ID
  period: string // 'YYYY-MM'
  planned: Money // planned value (budgeted cost of work scheduled)
  earned: Money // earned value
  actual: Money // actual cost from ERP
  commitments: Money // open POs/contracts at month end
  byFunction?: Record<ID, Money> // actuals split by WBS function (sums to actual)
  byLine?: Record<ID, Money> // actuals by forecast line item (sums to actual) — from SAP via the mapping table
  source?: 'sap' | 'summary' // 'sap' = built from posted SAP transactions; 'summary' = pre-system history
}

/** A forecast line item. Each line rolls up to exactly one WBS function; SAP actuals land on lines. */
export interface ForecastLine {
  id: ID
  code: string // '06.10'
  name: string
  functionId: ID
  categoryIds: ID[] // CBS categories whose budget belongs to this line (a category belongs to one line)
  active: boolean
  note?: string
}

/**
 * SAP → forecast line mapping rule. Rules run in priority order (lowest first); the first match wins.
 * target 'allocate' spreads the amount over the project's direct lines pro-rata to that period's mapped actuals
 * (used for overhead/loader settlements); 'exclude' keeps the row out of project actuals (e.g. balance-sheet items).
 */
export interface SapMapping {
  id: ID
  priority: number
  costElementFrom: string // inclusive, e.g. '5200000'
  costElementTo: string // inclusive, e.g. '5209999'
  wbsSuffix?: string // only SAP WBS elements ending with this (e.g. '.02' for the engineering sub-WBS)
  textContains?: string // case-insensitive match on posting text or vendor
  target: 'line' | 'allocate' | 'exclude'
  lineId?: ID
  note: string
  active: boolean
}

export type TxnStatus = 'mapped' | 'allocated' | 'unmapped' | 'excluded' | 'no-project'
/** One SAP actual-cost line item as imported. */
export interface ActualTxn {
  id: ID
  importId: ID
  projectId?: ID
  period: string // 'YYYY-MM' fiscal period
  postingDate: ISODate
  sapWbs: string
  costElement: string
  costElementName: string
  docNo: string
  vendor: string
  text: string
  amount: Money
  status: TxnStatus
  lineId?: ID // mapped line (status 'mapped')
  allocation?: Record<ID, Money> // line → amount (status 'allocated')
  ruleId?: ID
  manual?: { byId: ID; at: ISODateTime; note: string } // exception resolved by hand
}

export interface ActualsImport {
  id: ID
  fileName: string
  source: 'SAP extract' | 'history'
  period: string
  importedAt: ISODateTime
  byId: ID
  status: 'staged' | 'posted' | 'discarded'
  rows: number
  total: Money
  mapped: Money
  unmapped: Money
  excluded: Money
  noProject: Money
  projectIds: ID[]
  postedAt?: ISODateTime
  postedById?: ID
  note?: string
}

/** A reusable time-phasing shape. Weights are resampled to the number of months; zeroMonths blacks out calendar months. */
export interface SpreadProfile {
  id: ID
  name: string
  description: string
  weights: number[]
  zeroMonths?: number[] // 1–12, e.g. [11, 12, 1] for a holiday paving moratorium
}

/** The profile chosen for one WBS function in a forecast version. Cells stay editable after it is applied. */
export interface FnProfile {
  profileId: string // built-in SpreadMethod id or a SpreadProfile id
  start: string // 'YYYY-MM'
  end: string // 'YYYY-MM'
  adjusted: boolean // true once someone edits cells by hand after applying the profile
  appliedAt?: ISODateTime
}

/** One function of the standard work breakdown structure the forecast is spread against. */
export interface WbsFunction {
  id: ID
  code: string // '01'…'09'
  name: string
  description: string
  categoryIds: ID[] // cost categories (CBS) that roll up to this function
  timing: 'early' | 'mid' | 'late' | 'flat' // typical spend timing, used by the default spread
}

/**
 * A monthly forecast version. `spread` is the time-phased ETC (estimate to complete) by WBS function
 * by month ('YYYY-MM'), future months only. EAC = actuals to date + sum(spread) (+ contingency held).
 */
export interface Forecast {
  id: ID
  projectId: ID
  date: ISODate
  eac: Money
  byYear: Record<string, Money>
  note: string
  byId: ID
  locked: boolean
  spread?: Record<ID, Record<string, Money>>
  contingencyHeld?: Money // contingency kept in EAC but not spread to a function
  actualsThrough?: string // 'YYYY-MM' — last closed actuals period when the forecast was made
  status?: 'draft' | 'submitted' | 'approved' | 'returned'
  workflowInstanceId?: ID
  /** ETC by forecast line item by month. When present it is authoritative and `spread` is its roll-up by function. */
  lineSpread?: Record<ID, Record<string, Money>>
  profiles?: Record<ID, FnProfile> // keyed by WBS function id
}

export interface Variance {
  id: ID
  projectId: ID
  date: ISODate
  metric: 'eac' | 'milestone'
  description: string // what crossed the threshold
  amount: number // $ for eac, days for milestone
  rootCause?: RootCause
  narrative: string
  status: 'required' | 'submitted' | 'accepted' | 'returned'
  changeIds: ID[]
  riskIds: ID[]
  authorId?: ID
  workflowInstanceId?: ID
}

// ───────────────────────────── Risk
export type RiskStatus = 'open' | 'mitigating' | 'closed' | 'realized'
export type ConsequenceDim = 'Safety' | 'Reliability' | 'Environmental' | 'Financial' | 'Schedule' | 'Reputational'

export interface RiskResponse { id: ID; action: string; ownerId: ID; due: ISODate; status: 'open' | 'done'; cost: Money }

export interface Risk {
  id: ID
  projectId: ID
  code: string // 'R-1042-05'
  title: string
  cause: string
  event: string
  effect: string
  category: string
  kind: 'threat' | 'opportunity'
  ownerId: ID
  status: RiskStatus
  likelihood: 1 | 2 | 3 | 4 | 5
  consequence: 1 | 2 | 3 | 4 | 5
  consequenceDim: ConsequenceDim
  probability: number // 0–1 for quantitative analysis
  cost: { min: Money; ml: Money; max: Money }
  scheduleDays: { min: number; ml: number; max: number }
  responses: RiskResponse[]
  residual: { likelihood: 1 | 2 | 3 | 4 | 5; consequence: 1 | 2 | 3 | 4 | 5 }
  libraryId?: ID
  createdAt: ISODate
  closedAt?: ISODate
  lesson?: string
}

export interface RiskLibraryItem { id: ID; title: string; category: string; cause: string; event: string; effect: string; appliesTo: WorkMethod[]; typicalCostPct: number; typicalDays: number }

export interface ContingencyDraw {
  id: ID
  projectId: ID
  riskId?: ID
  changeId?: ID
  amount: Money
  date: ISODate
  reason: string
  status: 'in-review' | 'approved' | 'rejected'
  workflowInstanceId?: ID
}

export interface MonteCarloResult { id: ID; projectId: ID; date: ISODate; iterations: number; costP: Record<'P10' | 'P50' | 'P80' | 'P90', Money>; scheduleP: Record<'P10' | 'P50' | 'P80' | 'P90', number>; baseCost: Money; histogram: { x: number; n: number }[] }

// ───────────────────────────── Safety
export type ControlType = 'engineering' | 'administrative' | 'ppe'
export interface HazardItem {
  id: ID
  activity: string // e.g. 'Excavation'
  hazard: string
  controls: { type: ControlType; text: string }[]
  permits: string[]
  oqTasks: string[]
  effective: ISODate
}

export type TicketType = '811 locate' | 'Excavation permit' | 'Encroachment permit' | 'Hot work permit' | 'Confined space permit' | 'Lift plan'

export interface SafetyPlan {
  id: ID
  projectId: ID
  workPackage: string
  version: number
  status: 'draft' | 'in-review' | 'approved' | 'superseded'
  contractor: string
  activities: string[]
  hazardIds: ID[]
  extraControls: { hazardId: ID; text: string }[]
  site: { address: string; hospital: string; hospitalRoute: string; musterPoint: string; contacts: { name: string; role: string; phone: string }[] }
  tickets: { id: ID; type: TicketType; number: string; expires: ISODate }[]
  crew: { id: ID; name: string; company: string; role: string; oqTasks: string[]; oqExpires: ISODate; prequal: 'Compliant' | 'Conditional' | 'Non-compliant' }[]
  heatPlan: boolean
  trafficPlan: boolean
  createdAt: ISODate
  approvedAt?: ISODate
  workflowInstanceId?: ID
  libraryVersion: string
}

export interface Tailboard {
  id: ID
  planId: ID
  projectId: ID
  date: ISODate
  leader: string
  attendees: string[]
  hazardsDiscussed: ID[]
  notes: string
  stopWorkReminder: boolean
  offlineCaptured?: boolean
}

export interface SafetyEvent {
  id: ID
  projectId: ID
  planId?: ID
  date: ISODate
  type: 'observation' | 'near-miss' | 'incident'
  description: string
  sifPotential: boolean
  correctiveAction: string
  status: 'open' | 'closed'
  contractor?: string
}

// ───────────────────────────── Workflows
export type WfNodeType = 'start' | 'form' | 'review' | 'approval' | 'parallel-split' | 'parallel-join' | 'condition' | 'notify' | 'system' | 'end'

export type Assignee =
  | { kind: 'role'; roleId: RoleId }
  | { kind: 'person'; personId: ID }
  | { kind: 'team-position'; position: TeamPosition }
  | { kind: 'manager-of-requester' }
  | { kind: 'doa'; field: string } // approver chosen from the program DOA matrix by the $ value in form field `field`
  | { kind: 'requester' }

export interface WfNode {
  id: ID
  type: WfNodeType
  label: string
  x: number
  y: number
  lane?: string // swimlane label for documentation (defaults from assignee)
  assignee?: Assignee
  rule?: 'any' | 'all' // for multi-assignee approval/review
  slaDays?: number
  description?: string
  systemAction?: 'create-baseline' | 'post-budget' | 'advance-stage' | 'lock-estimate' | 'notify-erp' | 'release-ntp' | 'none'
}

export interface WfEdge {
  id: ID
  from: ID
  to: ID
  label?: string
  outcome?: 'approve' | 'reject' | 'return' | 'default' // which actor decision follows this edge
  condition?: Condition // for edges leaving a condition node; first match wins, else the edge with no condition
}

export interface FormField { key: string; label: string; type: 'text' | 'money' | 'number' | 'date' | 'select' | 'boolean' | 'textarea'; options?: string[]; required?: boolean }

export type RecordType = 'forecast' | 'estimate' | 'change' | 'gate' | 'safety-plan' | 'contingency' | 'variance' | 'deliverable' | 'initiation' | 'closeout' | 'budget' | 'contract' | 'waiver' | 'commitment-change' | 'factor-model'

export interface WorkflowDef {
  id: ID
  key: string // stable process key, e.g. 'change-request'
  name: string
  recordType: RecordType
  version: number
  status: 'draft' | 'published' | 'retired'
  effective: ISODate
  description: string
  purpose: string // for SOP export
  nodes: WfNode[]
  edges: WfEdge[]
  fields: FormField[]
  ownerRole: RoleId
}

export interface DoaMatrix { id: ID; name: string; version: number; effective: ISODate; rows: { upTo: Money; roleId: RoleId; label: string }[] }

export interface WfEvent {
  id: ID
  at: ISODateTime
  nodeId: ID
  actorId: ID
  action: 'start' | 'submit' | 'approve' | 'reject' | 'return' | 'comment' | 'escalate' | 'delegate' | 'system' | 'complete' | 'recall'
  comment?: string
  signature?: { method: 'password-reauth'; hash: string }
}

export interface WorkflowInstance {
  id: ID
  defId: ID
  defKey: string
  defVersion: number
  title: string
  recordType: RecordType
  recordId: ID
  projectId?: ID
  status: 'running' | 'approved' | 'rejected' | 'returned' | 'cancelled'
  /** active nodes; each holds who must act and who already acted (for 'all' rules) */
  active: { nodeId: ID; since: ISODateTime; assigneeIds: ID[]; actedIds: ID[]; due?: ISODate }[]
  startedAt: ISODateTime
  startedById: ID
  completedAt?: ISODateTime
  data: Record<string, unknown>
  history: WfEvent[]
}

// ───────────────────────────── Supporting records
export interface Permit { id: ID; projectId: ID; agency: string; type: string; number: string; status: 'not-applied' | 'applied' | 'issued' | 'expired'; applied?: ISODate; issued?: ISODate; expires?: ISODate; conditions: { id: ID; text: string; due?: ISODate; status: 'open' | 'met' }[] }
export interface LandRight { id: ID; projectId: ID; parcel: string; owner: string; type: 'Temporary right of entry' | 'Permanent easement' | 'Fee purchase' | 'License'; status: 'identified' | 'negotiating' | 'acquired'; needBy: ISODate; cost: Money }
/**
 * A commitment ("call-off") against a vendor PO for this project. Blanket POs serve many projects, so the project
 * records the share of the PO it intends to use and the scope of work that share buys.
 */
export interface Contract {
  id: ID; projectId: ID; number: string; vendor: string
  type: 'Construction' | 'Engineering' | 'Materials' | 'Inspection' | 'Environmental'
  value: Money // committed amount for this project (original)
  changeOrders: Money // approved RFI / CCO changes
  invoiced: Money
  status: 'rfp' | 'awarded' | 'active' | 'closed'
  awarded?: ISODate
  workflowInstanceId?: ID
  poNumber?: string // SAP PO (often a blanket PO)
  poTotal?: Money // total PO value across all projects
  pctOfPo?: number // share of the PO this project intends to use
  scope?: string // scope of work this commitment buys
  lineIds?: ID[] // forecast line items it covers
  ioId?: ID // internal order it charges
}

/** RFI / contract change order — the single entry point for changing a commitment. */
export interface CommitmentChange {
  id: ID
  projectId: ID
  contractId: ID
  code: string // 'CCO-1001-03'
  rfi: string // the question or field condition that triggered it
  description: string
  amount: Money
  scheduleImpactDays: number
  status: 'draft' | 'in-review' | 'approved' | 'rejected'
  requestedById: ID
  requestedAt: ISODate
  decidedAt?: ISODate
  changeId?: ID // project change request it rolls into, if any
  workflowInstanceId?: ID
}
export interface LongLeadItem { id: ID; projectId: ID; item: string; qty: string; vendor: string; requiredOnSite: ISODate; eta: ISODate; status: 'requested' | 'ordered' | 'shipped' | 'received' }
export interface RecordItem { id: ID; projectId: ID; type: 'Weld log' | 'NDE report' | 'Pressure test chart' | 'Material test report' | 'As-built drawing' | 'Coating inspection' | 'MAOP validation'; segment: string; status: 'missing' | 'attached' | 'verified'; fileName?: string; verifiedById?: ID }
export interface DecisionLogEntry { id: ID; projectId: ID; date: ISODate; decision: string; byId: ID; alternatives: string; evidence: string }
export interface OutreachEntry { id: ID; projectId: ID; date: ISODate; type: 'Notification' | 'Meeting' | 'Complaint' | 'Commitment'; stakeholder: string; summary: string; status: 'open' | 'closed' }
export interface Lesson { id: ID; projectId: ID; date: ISODate; title: string; category: string; text: string; workMethods: WorkMethod[] }
export interface DocumentRec { id: ID; projectId: ID; name: string; type: string; version: number; updated: ISODate; byId: ID; sizeKb: number }
export interface CloseoutItem { id: ID; projectId: ID; item: string; ownerRole: RoleId; status: 'open' | 'done' | 'n/a'; done?: ISODate }

export interface AuditEntry { id: ID; at: ISODateTime; actorId: ID; entity: string; entityId: ID; projectId?: ID; action: string; summary: string }

export interface Notification { id: ID; at: ISODateTime; toId: ID; text: string; link: string; read: boolean; kind?: 'task' | 'reminder' | 'escalation' | 'message' | 'info' }

/** In-app messaging: a project channel or a direct conversation. */
export interface Channel { id: ID; kind: 'project' | 'direct'; projectId?: ID; memberIds: ID[]; name: string }
export interface Message { id: ID; channelId: ID; fromId: ID; at: ISODateTime; text: string; readBy: ID[] }

/** An Esri (or GeoJSON) layer drawn on maps — typically the utility's pipe network from its GIS. */
export interface MapLayer {
  id: ID
  name: string
  kind: 'arcgis-feature' | 'arcgis-mapimage' | 'arcgis-tile' | 'demo'
  url: string // e.g. https://gis.utility.com/arcgis/rest/services/Gas/Transmission/FeatureServer/0
  color: string // CSS color for vector layers
  visible: boolean // on by default
  where?: string // feature layer filter, e.g. "MAOP > 60"
  token?: string // ArcGIS token for secured services (kept in this browser only)
  minZoom?: number
  note?: string
}

export interface GisSettings {
  /** Off by default: the app makes no calls to outside map services (tiles, Esri layers, Google links) until an administrator turns this on for internal hosting. */
  allowExternal?: boolean
  basemap: 'imagery' | 'streets' | 'topo' | 'gray' | 'none'
  center: [number, number]
  zoom: number
  layers: MapLayer[]
  demoNetwork: { id: string; name: string; maopPsig: number; diameterIn: number; coords: [number, number][] }[] // fictional pipe network for the demo utility
}

export interface Settings {
  orgName: string
  asOf: ISODate // the demo's "today"
  varianceThresholds: { eacPct: number; eacAbs: Money; milestoneDays: number }
  fieldDefs: { key: string; label: string; programIds: ID[]; requiredAtStage?: number }[]
  loaderRates: { year: number; name: string; pct: number }[]
  escalationByYear: Record<string, number> // % per year
  wbsFunctions: WbsFunction[]
  infoFields: InfoFieldDef[]
  infoSections: string[]
  gis: GisSettings
  forecastLines: ForecastLine[]
  sapMappings: SapMapping[]
  spreadProfiles: SpreadProfile[]
  quickEstimate: { regionFactors: Record<string, number>; contingencyPct: number; reviewerRole: ID }
  estimating: EstimatingConfig
  factorModel: FactorModelSettings
  workflow: { reminderDays: number; escalateAfterDays: number } // reminder before/at due; escalate to the assignee's manager this many days overdue
  features: { fieldTailboard: boolean; portfolioPlanning: boolean; opQual: boolean } // phase-2 modules, off for the pilot
  ai: AiSettings
}

/** Estimating administration: the tables the estimating team maintains; every estimate reads them. */
export interface EstimatingConfig {
  regions: string[]
  regionFactors: Record<string, number> // applied to base rates without a region-specific row
  contingencyByClass: Record<string, number> // AACE class → default contingency %
  taxRates: { county: string; rate: number }[] // sales tax % on taxable categories
  taxableCategoryIds: ID[] // e.g. permanent and consumable material
  units: { id: string; label: string }[] // allowed units on estimate lines and scope quantities
  quantityTypes: { id: ID; label: string; unit: string; feeds?: 'lengthFt' | 'sites' | 'hp' | 'tieIns' | 'services' }[]
  scopeLibrary: { inScope: string[]; outOfScope: string[]; assumptions: string[] }
  maturityItems: { key: string; label: string; forClass: AaceClass; hint: string }[]
  rateTableVersion: number
  rateTableHistory: { version: number; at: ISODateTime; byId: ID; note: string }[]
  /** Risk items a PM rates Low/Medium/High on a Class 5 request (defaults in engine/parametric.ts when absent). */
  riskItems?: RiskItemDef[]
}

// ───────────────────────────── Class 5 parametric request (rate table + risk items + Monte Carlo)
export type RiskLevel = 'low' | 'medium' | 'high'
/** Cost impact of a risk item at one level: triangular % of rate-table direct cost, and what the level means. */
export interface RiskImpact { label: string; min: number; mode: number; max: number }
/** A physical, legal or logistical risk to the cost of pipeline work (never a demographic or wealth attribute). */
export interface RiskItemDef { id: string; name: string; help: string; levels: Record<RiskLevel, RiskImpact> }
/** What a PM enters: the pipe and work from the project record, length, location, and a level per risk item. */
export interface ParametricInputs {
  assetType: AssetType
  workMethod: WorkMethod
  diameterIn: number
  lengthFt: number
  region: string
  midpointYear: number
  risks: Record<string, RiskLevel>
  taxPct?: number // used only when there is no project (else the project's county split)
}
export interface ParametricMonteCarlo {
  iterations: number
  seed: number
  p: { P10: Money; P50: Money; P80: Money; P90: Money }
  mean: Money
  histogram: { x: number; n: number }[]
  scurve: { pct: number; value: Money }[]
  tornado: { id: string; label: string; low: Money; high: Money; swing: Money; share: number }[]
}
export interface ParametricRecord {
  inputs: ParametricInputs
  rateTableVersion: number
  rateDirect: Money // rate-table direct cost at P50 (region-adjusted), before risk allowances
  rateSpread: { p10: Money; p90: Money } // the same lines at the rows' P10 and P90
  risks: { id: string; name: string; level: RiskLevel; pct: number; amount: Money }[] // most-likely allowance per item
  base: Money // deterministic total before contingency
  mc: Omit<ParametricMonteCarlo, 'histogram' | 'scurve' | 'tornado'>
  contingencyPct: number // risk-based: P80 − base, as % of base
  adjustment?: { pct: number; reason: string; byId: ID; at: ISODateTime; fromTotal: Money; toTotal: Money; changed: string[] }
}

/** Optional AI assist via the organization's approved LLM gateway (OpenAI-compatible chat completions). Off by default. */
export interface AiSettings {
  enabled: boolean
  endpoint: string // e.g. https://api.yourutility.com/llm/v1/chat/completions
  model: string
  apiKey?: string // demo only; production authenticates through the gateway with the user's SSO token
}

export interface AppState {
  schemaVersion: number
  currentUserId: ID
  settings: Settings
  roles: Role[]
  people: Person[]
  programs: Program[]
  funding: FundingEnvelope[]
  templates: LifecycleTemplate[]
  projects: Project[]
  deliverables: Deliverable[]
  gateDecisions: GateDecision[]
  gateReviews: GateReview[]
  actions: Action[]
  categories: CostCategory[]
  rates: UnitCostRate[]
  estimates: Estimate[]
  budgets: BudgetVersion[]
  snapshots: Snapshot[]
  changes: Change[]
  costPeriods: CostPeriod[]
  forecasts: Forecast[]
  infoRevisions: InfoRevision[]
  historicalCosts: HistoricalCost[]
  factorModels: FactorModel[]
  backtestProjects: BacktestProject[]
  commitmentChanges: CommitmentChange[]
  channels: Channel[]
  messages: Message[]
  actualTxns: ActualTxn[]
  actualsImports: ActualsImport[]
  variances: Variance[]
  risks: Risk[]
  riskLibrary: RiskLibraryItem[]
  contingencyDraws: ContingencyDraw[]
  monteCarlo: MonteCarloResult[]
  hazards: HazardItem[]
  safetyPlans: SafetyPlan[]
  tailboards: Tailboard[]
  safetyEvents: SafetyEvent[]
  workflowDefs: WorkflowDef[]
  doaMatrices: DoaMatrix[]
  workflows: WorkflowInstance[]
  permits: Permit[]
  landRights: LandRight[]
  contracts: Contract[]
  longLead: LongLeadItem[]
  records: RecordItem[]
  decisions: DecisionLogEntry[]
  outreach: OutreachEntry[]
  lessons: Lesson[]
  documents: DocumentRec[]
  closeout: CloseoutItem[]
  audit: AuditEntry[]
  notifications: Notification[]
}

export type CollectionKey = { [K in keyof AppState]: AppState[K] extends Array<{ id: ID }> ? K : never }[keyof AppState]

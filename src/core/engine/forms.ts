// Deliverable forms: one fillable template per gate deliverable, pre-filled from the project, completed in Crosswalk,
// reviewed through the deliverable-review workflow, and filed to the records system as a PDF + metadata.
// Pure: templates are data; helpers read state and return values. Fictional demo content only.
import type { AppState, Deliverable, DeliverableDef, FormValue, Project } from '../types'
import { activeBudget, position } from './position'
import { estimateTotals } from './estimates'
import { latestEstimate } from './finance'
import { CLASS_RANGES } from './estimates'

export type DocFieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'boolean' | 'checklist' | 'table'
export interface DocColumn { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' | 'select'; options?: string[] }
export interface DocField {
  key: string
  label: string
  type: DocFieldType
  help?: string
  required?: boolean
  options?: string[] // select
  items?: string[] // checklist rows
  choices?: string[] // checklist answers (default Yes / No / N/A)
  columns?: DocColumn[] // table
  unit?: string
  prefill?: string // a key from prefillValue()
  readOnly?: boolean // always taken from Crosswalk (the record of the module that owns it)
}
export interface DocSection { title: string; note?: string; fields: DocField[] }
export interface DocFormTemplate { id: string; name: string; version: number; purpose: string; sections: DocSection[] }

export type ChecklistValue = Record<string, { v: string; note?: string }>
export type TableValue = Record<string, string | number>[]

// ── field helpers
const T = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'text', ...o })
const A = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'textarea', ...o })
const N = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'number', ...o })
const M = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'money', ...o })
const Dt = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'date', ...o })
const S = (key: string, label: string, options: string[], o: Partial<DocField> = {}): DocField => ({ key, label, type: 'select', options, ...o })
const B = (key: string, label: string, o: Partial<DocField> = {}): DocField => ({ key, label, type: 'boolean', ...o })
const C = (key: string, label: string, items: string[], o: Partial<DocField> = {}): DocField => ({ key, label, type: 'checklist', items, ...o })
const TB = (key: string, label: string, columns: DocColumn[], o: Partial<DocField> = {}): DocField => ({ key, label, type: 'table', columns, ...o })
const col = (key: string, label: string, type: DocColumn['type'] = 'text', options?: string[]): DocColumn => ({ key, label, type, options })
const RO = (key: string, label: string, prefill: string, type: DocFieldType = 'text'): DocField => ({ key, label, type, prefill, readOnly: true })

/** The project block at the top of every form (always from Crosswalk). */
const PROJECT: DocSection = {
  title: 'Project',
  fields: [RO('code', 'Project number', 'code'), RO('name', 'Project name', 'name'), RO('program', 'Program', 'program'), RO('wbs', 'ERP WBS', 'erpWbs'), RO('location', 'Location', 'location'), RO('asset', 'Asset', 'asset')],
}
const RAG = ['Low', 'Medium', 'High']
const YNNA = ['Yes', 'No', 'N/A']

// VERIFY: form contents are a starting point drafted for the demo; the PMO and each discipline owner confirm them.
const DRAFT_TEMPLATES: DocFormTemplate[] = [
  { id: 'f-charter', name: 'Project charter', version: 1, purpose: 'Why the project exists, what it will deliver and who decides.', sections: [
    PROJECT,
    { title: 'Need', fields: [RO('driver', 'Driver', 'driver'), RO('citation', 'Regulatory citation', 'citation'), A('problem', 'Problem statement', { required: true, help: 'What happens if we do nothing?' }), A('objectives', 'Objectives', { required: true })] },
    { title: 'Scope', fields: [A('summary', 'Scope summary', { prefill: 'scopeSummary', required: true }), A('inScope', 'In scope', { prefill: 'inScope' }), A('outOfScope', 'Out of scope', { prefill: 'outOfScope' }), A('assumptions', 'Key assumptions', { prefill: 'assumptions' })] },
    { title: 'Governance', fields: [RO('sponsor', 'Sponsor', 'sponsor'), RO('pm', 'Project manager', 'pm'), TB('stakeholders', 'Key stakeholders', [col('name', 'Stakeholder'), col('role', 'Role or interest')], { required: true })] },
    { title: 'Funding', fields: [RO('estimate', 'Current estimate', 'est.summary'), RO('proceeding', 'Funding proceeding', 'proceeding'), S('mechanism', 'Recovery mechanism', ['General rate case', 'Balancing account', 'Memorandum account', 'Other'], { required: true })] },
  ] },
  { id: 'f-feas', name: 'Feasibility study', version: 1, purpose: 'Alternatives screened before committing to design.', sections: [
    PROJECT,
    { title: 'Alternatives', fields: [TB('alts', 'Alternatives compared', [col('alt', 'Alternative'), col('desc', 'Description'), col('cost', 'Rough cost', 'money'), col('risk', 'Risk', 'select', RAG)], { required: true, help: 'At least two.' })] },
    { title: 'Findings', fields: [RO('records', 'Records status', 'recordsStatus'), A('constructability', 'Constructability notes'), A('recommendation', 'Recommendation', { required: true })] },
  ] },
  { id: 'f-estimate', name: 'Estimate record', version: 1, purpose: 'The approved estimate of record, produced in Crosswalk Estimating. The basis of estimate is attached.', sections: [
    PROJECT,
    { title: 'Estimate of record', note: 'Taken from Crosswalk Estimating; not editable here.', fields: [RO('cls', 'Estimate class', 'est.class'), RO('ver', 'Version', 'est.version'), RO('total', 'Total', 'est.total', 'money'), RO('range', 'Expected range', 'est.range'), RO('status', 'Status', 'est.status'), RO('approved', 'Approved', 'est.approved')] },
    { title: 'Estimator notes', fields: [A('notes', 'Notes for the gate board')] },
  ] },
  { id: 'f-risk', name: 'Risk register record', version: 1, purpose: 'The project risk register at the gate, produced in Crosswalk Risk.', sections: [
    PROJECT,
    { title: 'Register', note: 'Taken from Crosswalk Risk; not editable here.', fields: [RO('count', 'Open risks', 'risks.count'), RO('top', 'Top risks', 'risks.top', 'table'), RO('cont', 'Contingency remaining', 'contingency', 'money')] },
    { title: 'Commentary', fields: [A('notes', 'What changed since the last gate')] },
  ] },
  { id: 'f-recovery', name: 'Revenue recovery strategy', version: 1, purpose: 'How the cost will be recovered in rates.', sections: [
    PROJECT,
    { title: 'Recovery', fields: [S('mechanism', 'Mechanism', ['General rate case', 'Balancing account', 'Memorandum account', 'Other'], { required: true }), RO('proceeding', 'Proceeding', 'proceeding'), T('testYear', 'Test year', { required: true }), S('costType', 'Cost type', ['Capital', 'O&M', 'Mixed'], { required: true }), RO('citation', 'Regulatory citation', 'citation'), A('rationale', 'Rationale', { required: true })] },
  ] },
  { id: 'f-recrev', name: 'Pipeline records review', version: 1, purpose: 'Confirms the records behind the MAOP are traceable, verifiable and complete, and plans for any gaps.', sections: [
    PROJECT,
    { title: 'Segments', fields: [RO('maop', 'Current MAOP', 'maop'), RO('vintage', 'Vintage', 'vintage'), TB('segments', 'Segments reviewed', [col('seg', 'Segment'), col('stations', 'Stations (from–to)'), col('status', 'Records', 'select', ['Complete', 'Gaps', 'Missing']), col('basis', 'MAOP basis', 'select', ['Pressure test', 'Prior operation', 'Engineering assessment', 'Unknown'])], { required: true })] },
    { title: 'Records located', fields: [C('found', 'Records located', ['Pressure test records', 'Material test reports (MTRs)', 'Design and class location records', 'Construction and weld records'], { required: true }), A('gapPlan', 'Plan for gaps', { help: 'Write "None" if every segment is complete.' })] },
  ] },
  { id: 'f-screen', name: 'Environmental, land & permit screen', version: 1, purpose: 'An early look at what could slow the project down.', sections: [
    PROJECT,
    { title: 'Screen', fields: [C('topics', 'Topics', ['Biological resources', 'Cultural resources', 'Waters and wetlands', 'Hazardous materials', 'Air quality', 'Noise and traffic', 'Land rights (parcels)', 'Jurisdictions and encroachment', 'Rail or highway crossings'], { required: true, choices: ['Clear', 'Watch', 'Issue'] }), A('permits', 'Permits likely needed', { required: true }), A('notes', 'Notes')] },
  ] },
  { id: 'f-site', name: 'Site assessment & survey plan', version: 1, purpose: 'What we will verify in the field before design.', sections: [
    PROJECT,
    { title: 'Survey', fields: [C('surveys', 'Surveys planned', ['Topographic survey', 'Utility locate (811)', 'Potholing', 'Geotechnical borings', 'Cathodic protection survey'], { required: true }), N('potholes', 'Pothole locations', { unit: 'locations' }), Dt('fieldDate', 'Field verification date', { required: true }), A('findings', 'Findings so far')] },
  ] },
  { id: 'f-options', name: 'Option analysis', version: 1, purpose: 'Compares options on cost, schedule, risk and benefit and picks one.', sections: [
    PROJECT,
    { title: 'Options', fields: [TB('options', 'Options', [col('opt', 'Option'), col('cost', 'Cost', 'money'), col('months', 'Schedule (months)', 'number'), col('risk', 'Risk', 'select', RAG), col('benefit', 'Safety / reliability benefit')], { required: true })] },
    { title: 'Decision', fields: [T('preferred', 'Preferred option', { required: true }), A('why', 'Justification', { required: true })] },
  ] },
  { id: 'f-pep', name: 'Project Execution Plan', version: 1, purpose: 'How the project will be organized, contracted, controlled and built safely.', sections: [
    PROJECT,
    { title: 'Organization', fields: [RO('pm', 'Project manager', 'pm'), RO('engineer', 'Project engineer', 'engineer'), RO('cm', 'Construction manager', 'constructionManager'), A('org', 'Roles and responsibilities', { required: true })] },
    { title: 'Approach', fields: [S('contracting', 'Contracting strategy', ['Design-bid-build', 'Design-build', 'Target price', 'Unit-price master agreement'], { required: true }), A('controls', 'Cost and schedule controls', { required: true }), A('quality', 'Quality approach', { required: true }), A('safety', 'Safety approach', { required: true }), A('outage', 'Outage and gas-control coordination'), A('comms', 'Communication plan')] },
  ] },
  { id: 'f-schedule', name: 'Schedule record', version: 1, purpose: 'The baseline milestones at the gate, from the project schedule.', sections: [
    PROJECT,
    { title: 'Milestones', note: 'Taken from the project schedule; not editable here.', fields: [RO('ms', 'Milestones', 'milestones', 'table'), RO('sched', 'Schedule ID', 'scheduleId')] },
    { title: 'Scheduler notes', fields: [A('critical', 'Critical path and float', { required: true })] },
  ] },
  { id: 'f-longlead', name: 'Long-lead material list', version: 1, purpose: 'Materials that drive the schedule, with need dates.', sections: [
    PROJECT,
    { title: 'Materials', fields: [TB('items', 'Long-lead items', [col('item', 'Item'), col('spec', 'Specification'), col('qty', 'Qty', 'number'), col('need', 'Need date', 'date'), col('lead', 'Lead time (weeks)', 'number'), col('status', 'Status', 'select', ['Not ordered', 'RFQ', 'Ordered', 'Received'])], { required: true })] },
  ] },
  { id: 'f-ceqa', name: 'CEQA determination', version: 1, purpose: 'The environmental review path and its basis.', sections: [
    PROJECT,
    { title: 'Determination', fields: [S('det', 'Determination', ['Statutory exemption', 'Categorical exemption', 'Negative declaration', 'Mitigated negative declaration', 'Environmental impact report'], { required: true }), T('cite', 'Exemption class or citation'), T('agency', 'Lead agency', { required: true }), Dt('date', 'Determination date', { required: true }), B('mitigation', 'Mitigation required'), A('basis', 'Basis', { required: true })] },
  ] },
  { id: 'f-bod', name: 'Basis of design', version: 1, purpose: 'The design criteria the engineer of record signs.', sections: [
    PROJECT,
    { title: 'Design criteria', fields: [RO('dia', 'Diameter', 'diameter'), RO('len', 'Length', 'lengthFt'), RO('cls', 'Class location', 'classLocation'), N('designPsig', 'Design pressure', { unit: 'psig', required: true }), N('maopPsig', 'Proposed MAOP', { unit: 'psig', required: true, prefill: 'maopNum' }), S('grade', 'Pipe grade', ['Grade B', 'X42', 'X52', 'X60', 'X65', 'X70'], { required: true }), N('wall', 'Wall thickness', { unit: 'in', required: true }), S('coating', 'Coating', ['Fusion-bonded epoxy', 'FBE + abrasion-resistant overcoat', 'Three-layer polyethylene'], { required: true }), T('designCode', 'Design code', { prefill: 'designCode' })] },
    { title: 'Concept', fields: [A('tieins', 'Tie-in and isolation concept', { required: true }), A('route', 'Route or layout notes'), T('eor', 'Engineer of record', { required: true })] },
  ] },
  { id: 'f-constr', name: 'Constructability review', version: 1, purpose: 'Construction looks at the design before it is final.', sections: [
    PROJECT,
    { title: 'Review', fields: [C('topics', 'Topics reviewed', ['Access and staging', 'Traffic control', 'Outage windows', 'Crossing methods (HDD, bore, open cut)', 'Spoils and dewatering', 'Existing utility conflicts', 'Work-hour limits'], { required: true }), TB('findings', 'Findings', [col('finding', 'Finding'), col('owner', 'Owner'), col('due', 'Due', 'date')])] },
  ] },
  { id: 'f-outreach', name: 'Stakeholder & customer outreach plan', version: 1, purpose: 'Who hears what, when, and from whom.', sections: [
    PROJECT,
    { title: 'Plan', fields: [TB('plan', 'Notices', [col('who', 'Stakeholder'), col('type', 'Type', 'select', ['Agency', 'Customer', 'Community', 'Business']), col('how', 'Method'), col('when', 'Timing'), col('owner', 'Owner')], { required: true }), A('notes', 'Notes')] },
  ] },
  { id: 'f-ifc', name: 'Issued-for-construction design', version: 1, purpose: 'The stamped design package released for construction.', sections: [
    PROJECT,
    { title: 'Package', fields: [N('drawings', 'Drawings in package', { required: true }), T('specs', 'Specification sections'), T('rev', 'Revision', { required: true }), T('eor', 'Engineer of record', { required: true }), Dt('stamp', 'Stamp date', { required: true }), RO('maop', 'MAOP', 'maop'), C('contents', 'Package contents', ['IFC drawings', 'Specifications', 'MAOP calculation', 'Tie-in procedures', 'Material list'], { required: true })] },
  ] },
  { id: 'f-dreview', name: 'Design review sign-off', version: 1, purpose: 'Formal reviews at each design milestone, with comments closed.', sections: [
    PROJECT,
    { title: 'Reviews', fields: [TB('reviews', 'Reviews', [col('ms', 'Milestone', 'select', ['30%', '60%', '90%', 'IFC']), col('disc', 'Discipline', 'select', ['Operations', 'Integrity', 'Construction', 'Safety', 'Environmental']), col('reviewer', 'Reviewer'), col('comments', 'Comments', 'number'), col('open', 'Still open', 'number'), col('date', 'Date', 'date')], { required: true })] },
  ] },
  { id: 'f-itp', name: 'Inspection & test plan', version: 1, purpose: 'Hold and witness points, NDE and pressure testing.', sections: [
    PROJECT,
    { title: 'Inspection points', fields: [TB('points', 'Hold and witness points', [col('activity', 'Activity'), col('type', 'Type', 'select', ['Hold', 'Witness', 'Review']), col('criteria', 'Acceptance criteria'), col('who', 'Responsible')], { required: true }), N('nde', 'Welds receiving NDE', { unit: '%', required: true })] },
    { title: 'Pressure test', fields: [S('medium', 'Test medium', ['Water', 'Air', 'Nitrogen'], { required: true }), N('testPsig', 'Test pressure', { unit: 'psig', required: true }), N('hours', 'Duration', { unit: 'hours', required: true })] },
  ] },
  { id: 'f-land', name: 'Land rights', version: 1, purpose: 'Every parcel the work touches and the right needed.', sections: [
    PROJECT,
    { title: 'Parcels', fields: [TB('parcels', 'Parcels', [col('parcel', 'Parcel'), col('owner', 'Owner type', 'select', ['Private', 'Public agency', 'Railroad', 'Utility']), col('right', 'Right', 'select', ['Easement', 'Temporary right of entry', 'Permit', 'License']), col('status', 'Status', 'select', ['Not started', 'In negotiation', 'Executed']), col('need', 'Need date', 'date')], { required: true })] },
  ] },
  { id: 'f-permits', name: 'Permit matrix', version: 1, purpose: 'Every permit, who issues it, and where it stands.', sections: [
    PROJECT,
    { title: 'Permits', fields: [TB('permits', 'Permits', [col('permit', 'Permit'), col('agency', 'Agency'), col('need', 'Needed by', 'date'), col('status', 'Status', 'select', ['Not applied', 'Applied', 'Issued', 'Not required']), col('number', 'Permit number')], { required: true })] },
  ] },
  { id: 'f-award', name: 'Contract award recommendation', version: 1, purpose: 'Bid results against the estimate and the recommended award.', sections: [
    PROJECT,
    { title: 'Bids', note: 'Use generic bidder labels in this demo.', fields: [TB('bids', 'Bids received', [col('bidder', 'Bidder'), col('price', 'Price', 'money'), col('tech', 'Technical score', 'number'), col('safety', 'Safety score', 'number')], { required: true }), RO('estimate', 'Class 3 estimate', 'est.summary')] },
    { title: 'Recommendation', fields: [T('award', 'Recommended bidder', { required: true }), M('amount', 'Award amount', { required: true }), A('variance', 'Explanation if outside the estimate range'), RO('doa', 'Approval authority', 'doa')] },
  ] },
  { id: 'f-safety', name: 'Safety plan record', version: 1, purpose: 'The approved job-specific safety plan, from Crosswalk Safety.', sections: [
    PROJECT,
    { title: 'Plan', note: 'Taken from Crosswalk Safety; not editable here.', fields: [RO('plan', 'Safety plan', 'safety.plan'), RO('status', 'Status', 'safety.status')] },
  ] },
  { id: 'f-hydro', name: 'Hydrotest plan', version: 1, purpose: 'Test sections, water source and discharge.', sections: [
    PROJECT,
    { title: 'Test sections', fields: [TB('sections', 'Sections', [col('sec', 'Section'), col('from', 'From station'), col('to', 'To station'), col('len', 'Length (ft)', 'number'), col('psig', 'Test pressure (psig)', 'number'), col('hrs', 'Duration (h)', 'number')], { required: true })] },
    { title: 'Water', fields: [T('source', 'Water source', { required: true }), N('gallons', 'Volume', { unit: 'gal' }), T('discharge', 'Discharge location', { required: true }), T('permitNo', 'Discharge permit number')] },
  ] },
  { id: 'f-precon', name: 'Pre-construction readiness', version: 1, purpose: 'Everything in place before crews mobilize.', sections: [
    PROJECT,
    { title: 'Readiness', fields: [C('ready', 'Ready to mobilize', ['Permits on hand', 'Materials received', 'Crews operator-qualified for covered tasks', 'Outage or clearance approved', 'Customer and agency notices sent', 'Job-specific safety plan approved', 'Traffic control plan approved', 'Emergency contacts posted', 'Inspector assigned'], { required: true }), Dt('mob', 'Mobilization date', { required: true })] },
  ] },
  { id: 'f-commission', name: 'Commissioning & in-service records', version: 1, purpose: 'The records that prove the facility was built and tested to the design.', sections: [
    PROJECT,
    { title: 'Records', fields: [C('records', 'Records complete', ['Pressure test charts', 'Weld logs', 'NDE reports', 'Coating inspection reports', 'Material test reports'], { required: true }), Dt('testDate', 'Strength test date', { required: true }), N('testPsig', 'Test pressure', { unit: 'psig', required: true }), Dt('gasIn', 'Gas-in date', { required: true }), T('custodian', 'Records custodian', { required: true })] },
  ] },
  { id: 'f-notice', name: 'Notice of operation', version: 1, purpose: 'Formal notice that the facility is in service.', sections: [
    PROJECT,
    { title: 'Notice', fields: [Dt('date', 'Date of operation', { required: true, prefill: 'inService' }), T('segments', 'Segments placed in service', { required: true }), N('maop', 'Operating MAOP', { unit: 'psig', required: true, prefill: 'maopNum' }), RO('district', 'Operating district', 'district'), T('signer', 'Signed by', { required: true })] },
  ] },
  { id: 'f-training', name: 'Operations turnover & training', version: 1, purpose: 'Operations is ready to run what we built.', sections: [
    PROJECT,
    { title: 'Turnover', fields: [TB('training', 'Training delivered', [col('topic', 'Topic'), col('audience', 'Audience'), col('date', 'Date', 'date')], { required: true }), B('procedures', 'O&M procedures updated', { required: true }), B('spares', 'Spare parts list delivered'), T('opsSignoff', 'Operations sign-off', { required: true })] },
  ] },
  { id: 'f-demob', name: 'Demobilization & restoration', version: 1, purpose: 'The site is restored and the jurisdiction has signed off.', sections: [
    PROJECT,
    { title: 'Restoration', fields: [C('done', 'Complete', ['Site restored', 'Paving complete', 'Equipment and materials removed', 'Storm water controls closed', 'Jurisdiction final inspection passed'], { required: true }), T('inspector', 'Jurisdiction inspector'), Dt('date', 'Final inspection date', { required: true })] },
  ] },
  { id: 'f-mc', name: 'Mechanical completion & punch list', version: 1, purpose: 'Built per the IFC design, with the remaining items listed.', sections: [
    PROJECT,
    { title: 'Completion', fields: [Dt('mcDate', 'Mechanical completion date', { required: true }), TB('punch', 'Punch list', [col('item', 'Item'), col('pri', 'Priority', 'select', ['A', 'B', 'C']), col('owner', 'Owner'), col('status', 'Status', 'select', ['Open', 'Closed'])])] },
  ] },
  { id: 'f-pssr', name: 'Pre-start-up safety review', version: 1, purpose: 'Confirms it is safe to introduce gas.', sections: [
    PROJECT,
    { title: 'Review', fields: [C('items', 'Confirmed', ['Built per the IFC design', 'Operating procedures written', 'Operators trained', 'Hazard review recommendations closed', 'Relief devices set and tagged', 'Emergency shutdown tested', 'Management of change closed'], { required: true }), T('lead', 'Review lead', { required: true }), Dt('date', 'Review date', { required: true })] },
  ] },
  { id: 'f-maop', name: 'MAOP validation record', version: 1, purpose: 'Shows the test and design support the MAOP for each segment.', sections: [
    PROJECT,
    { title: 'Validation', fields: [TB('segments', 'Segments', [col('seg', 'Segment'), col('testPsig', 'Test pressure (psig)', 'number'), col('cls', 'Class location', 'select', ['1', '2', '3', '4']), col('factor', 'Test factor', 'number'), col('maop', 'MAOP (psig)', 'number')], { required: true }), S('basis', 'MAOP basis', ['Pressure test', 'Design', 'Prior operation'], { required: true }), T('engineer', 'Engineer', { required: true })] },
  ] },
  { id: 'f-asbuilt', name: 'As-builts & GIS update', version: 1, purpose: 'The as-built record is in GIS.', sections: [
    PROJECT,
    { title: 'As-builts', fields: [N('drawings', 'As-built drawings', { required: true }), T('gisRequest', 'GIS edit request number', { required: true }), Dt('posted', 'Posted to GIS', { required: true }), B('redlines', 'Field redlines reconciled', { required: true })] },
  ] },
  { id: 'f-unitize', name: 'Unitization', version: 1, purpose: 'Costs assigned to the assets placed in service.', sections: [
    PROJECT,
    { title: 'Asset units', fields: [RO('final', 'Final cost to date', 'actual', 'money'), TB('units', 'Units', [col('unit', 'Asset unit'), col('desc', 'Description'), col('qty', 'Qty', 'number'), col('cost', 'Cost', 'money')], { required: true }), Dt('inService', 'In-service date', { prefill: 'inService', required: true })] },
  ] },
  { id: 'f-fincl', name: 'Financial closeout', version: 1, purpose: 'All costs in, commitments closed, WBS closed.', sections: [
    PROJECT,
    { title: 'Costs', fields: [RO('budget', 'Current budget', 'budget.total', 'money'), RO('actual', 'Actual cost', 'actual', 'money'), M('open', 'Open commitments', { required: true }), B('accruals', 'Accruals cleared', { required: true }), Dt('wbsClose', 'WBS close date', { required: true }), A('variance', 'Final variance explanation')] },
  ] },
  { id: 'f-lessons', name: 'Lessons learned', version: 1, purpose: 'What the next project should do differently.', sections: [
    PROJECT,
    { title: 'Lessons', fields: [TB('lessons', 'Lessons', [col('what', 'What happened'), col('impact', 'Impact', 'select', ['Cost', 'Schedule', 'Safety', 'Quality', 'Stakeholders']), col('rec', 'Recommendation')], { required: true })] },
  ] },
  { id: 'f-rrpkg', name: 'Reasonableness-review evidence package', version: 1, purpose: 'The frozen evidence a regulator would ask for.', sections: [
    PROJECT,
    { title: 'Contents', note: 'Counts taken from Crosswalk.', fields: [RO('estimates', 'Estimates of record', 'est.count'), RO('baselines', 'Budget versions', 'budget.count'), RO('changes', 'Changes', 'changes.count'), RO('variances', 'Variance explanations', 'variances.count'), Dt('frozen', 'Package frozen', { required: true }), A('index', 'Package index')] },
  ] },
  { id: 'f-permitclose', name: 'Permit & environmental closeout', version: 1, purpose: 'Every permit closed and every commitment met.', sections: [
    PROJECT,
    { title: 'Closeout', fields: [TB('permits', 'Permits', [col('permit', 'Permit'), col('agency', 'Agency'), col('closed', 'Closed', 'date'), col('report', 'Final report filed', 'select', ['Yes', 'No', 'Not required'])], { required: true }), B('mitigation', 'Mitigation complete', { required: true })] },
  ] },
  { id: 'f-turnover', name: 'Permanent records turnover', version: 1, purpose: 'The project file, indexed and handed to records management.', sections: [
    PROJECT,
    { title: 'Index', fields: [TB('series', 'Record series', [col('series', 'Series', 'select', ['Design', 'Construction', 'Testing', 'Land', 'Environmental', 'Financial', 'Correspondence']), col('count', 'Items', 'number'), col('where', 'Where filed')], { required: true }), Dt('accepted', 'Accepted by records management', { required: true })] },
  ] },
]

/**
 * Every answer on a deliverable form is required; read-only fields come from Crosswalk. Yes/no questions are explicit
 * Yes / No choices so an unanswered question can't pass as "No". Where nothing applies, the owner writes "None" or "N/A".
 */
export const FORM_TEMPLATES: DocFormTemplate[] = DRAFT_TEMPLATES.map((t) => ({
  ...t,
  sections: t.sections.map((sec) => ({
    ...sec,
    fields: sec.fields.map((f): DocField => (f.readOnly ? f : f.type === 'boolean' ? { ...f, type: 'select', options: ['Yes', 'No'], required: true } : { ...f, required: true })),
  })),
}))

/** Which template each deliverable uses. */
export const FORM_FOR_DEF: Record<string, string> = {
  'd-charter': 'f-charter', 'ds-charter': 'f-charter', 'd-feas': 'f-feas', 'd-est5': 'f-estimate', 'd-est3': 'f-estimate', 'ds-est5': 'f-estimate', 'ds-est3': 'f-estimate',
  'd-risk1': 'f-risk', 'd-riskq': 'f-risk', 'ds-risk': 'f-risk', 'd-recovery': 'f-recovery', 'd-recrev': 'f-recrev', 'd-screen': 'f-screen',
  'd-site': 'f-site', 'd-options': 'f-options', 'd-pep': 'f-pep', 'd-sched': 'f-schedule', 'ds-sched': 'f-schedule', 'd-longlead': 'f-longlead', 'd-ceqa': 'f-ceqa',
  'd-bod': 'f-bod', 'd-constr': 'f-constr', 'd-outreach': 'f-outreach', 'd-design': 'f-ifc', 'ds-design': 'f-ifc', 'd-dreview': 'f-dreview', 'd-itp': 'f-itp',
  'd-land': 'f-land', 'd-permits': 'f-permits', 'd-award': 'f-award', 'd-jssp': 'f-safety', 'ds-jssp': 'f-safety', 'd-hydro': 'f-hydro', 'd-precon': 'f-precon',
  'd-commission': 'f-commission', 'ds-records': 'f-commission', 'd-notice': 'f-notice', 'd-training': 'f-training', 'd-demob': 'f-demob', 'd-mc': 'f-mc', 'ds-mc': 'f-mc',
  'd-pssr': 'f-pssr', 'd-maop': 'f-maop', 'd-asbuilt': 'f-asbuilt', 'd-unitize': 'f-unitize', 'd-fincl': 'f-fincl', 'ds-fincl': 'f-fincl', 'd-lessons': 'f-lessons',
  'ds-lessons': 'f-lessons', 'd-rrpkg': 'f-rrpkg', 'd-permitclose': 'f-permitclose', 'd-turnover': 'f-turnover',
}

export const formFor = (defId: string): DocFormTemplate | undefined => FORM_TEMPLATES.find((t) => t.id === FORM_FOR_DEF[defId])
export const allFields = (t: DocFormTemplate) => t.sections.flatMap((x) => x.fields)

const person = (s: AppState, id?: string) => s.people.find((x) => x.id === id)?.name ?? ''
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const ASSET: Record<string, string> = { 'transmission-pipeline': 'Transmission pipeline', 'distribution-main': 'Distribution main', 'compressor-station': 'Compressor station', 'valve-site': 'Valve site', 'storage-field': 'Storage field', 'regulator-station': 'Regulator station' }

/** A value Crosswalk already knows, for pre-filling a field. */
export function prefillValue(s: AppState, p: Project, key: string): FormValue | undefined {
  const est = latestEstimate(s, p.id)
  const pos = (() => { try { return position(s, p.id) } catch { return undefined } })()
  switch (key) {
    case 'code': return p.code
    case 'name': return p.name
    case 'program': { const g = s.programs.find((x) => x.id === p.programId); return g ? `${g.code} · ${g.name}` : '' }
    case 'erpWbs': return p.erpWbs
    case 'scheduleId': return p.scheduleId
    case 'location': return `${p.location.city}, ${/county$/i.test(p.location.county) ? p.location.county : `${p.location.county} County`} · ${p.location.district} district`
    case 'district': return p.location.district
    case 'asset': return `${ASSET[p.asset.type] ?? p.asset.type} · ${p.asset.lineId} · ${p.asset.diameterIn} in · ${p.asset.lengthFt.toLocaleString('en-US')} ft`
    case 'diameter': return `${p.asset.diameterIn} in`
    case 'lengthFt': return `${p.asset.lengthFt.toLocaleString('en-US')} ft`
    case 'classLocation': return `Class ${p.location.classLocation}`
    case 'maop': return `${p.asset.maopPsig} psig`
    case 'maopNum': return p.asset.maopPsig
    case 'vintage': return String(p.asset.vintage)
    case 'recordsStatus': return { complete: 'Complete', gaps: 'Gaps', unknown: 'Unknown' }[p.asset.recordsStatus]
    case 'designCode': return '49 CFR Part 192'
    case 'driver': return p.driver
    case 'citation': return p.regulatoryCitation
    case 'proceeding': return p.fundingProceeding
    case 'scopeSummary': return p.scope.summary
    case 'inScope': return p.scope.inScope.join('\n')
    case 'outOfScope': return p.scope.outOfScope.join('\n')
    case 'assumptions': return p.scope.assumptions.join('\n')
    case 'sponsor': return person(s, p.team.sponsor)
    case 'pm': return person(s, p.team.pm)
    case 'engineer': return person(s, p.team.engineer)
    case 'constructionManager': return person(s, p.team.constructionManager)
    case 'inService': { const m = p.milestones.find((x) => /In service/.test(x.name)); return p.dates.inService ?? m?.actual ?? m?.forecast ?? '' }
    case 'est.summary': return est ? `Class ${est.cls} v${est.version} · ${usd(estimateTotals(est).total)} · ${est.status}` : 'No estimate yet'
    case 'est.class': return est ? `Class ${est.cls}` : ''
    case 'est.version': return est ? `v${est.version}` : ''
    case 'est.total': return est ? estimateTotals(est).total : 0
    case 'est.range': { if (!est) return ''; const r = CLASS_RANGES[est.cls]; const t = estimateTotals(est).total; return `${usd(t * (1 + r.low))} – ${usd(t * (1 + r.high))}` }
    case 'est.status': return est?.status ?? ''
    case 'est.approved': return est?.approvedAt ? String(est.approvedAt).slice(0, 10) : 'Not yet approved'
    case 'est.count': return String(s.estimates.filter((e) => e.projectId === p.id && e.status === 'approved').length)
    case 'budget.total': return pos?.currentBudget ?? 0
    case 'budget.count': return String(s.budgets.filter((b) => b.projectId === p.id).length)
    case 'actual': return pos?.actualToDate ?? 0
    case 'contingency': return pos?.contingencyRemaining ?? 0
    case 'changes.count': return String(s.changes.filter((c) => c.projectId === p.id).length)
    case 'variances.count': return String(s.variances.filter((v) => v.projectId === p.id).length)
    case 'risks.count': return String(s.risks.filter((r) => r.projectId === p.id && r.status !== 'closed').length)
    case 'risks.top': return s.risks.filter((r) => r.projectId === p.id && r.status !== 'closed').sort((a, b) => b.likelihood * b.consequence - a.likelihood * a.consequence).slice(0, 5).map((r) => ({ code: r.code, title: r.title, score: r.likelihood * r.consequence, owner: person(s, r.ownerId) }))
    case 'milestones': return p.milestones.map((m) => ({ milestone: m.name, baseline: m.baseline, forecast: m.forecast ?? '', actual: m.actual ?? '' }))
    case 'safety.plan': { const sp = s.safetyPlans.filter((x) => x.projectId === p.id).sort((a, b) => b.version - a.version)[0]; return sp ? `${sp.workPackage} v${sp.version} · ${sp.contractor}` : 'No plan yet' }
    case 'safety.status': return s.safetyPlans.filter((x) => x.projectId === p.id).sort((a, b) => b.version - a.version)[0]?.status ?? ''
    case 'doa': { const b = activeBudget(s, p.id); const row = s.doaMatrices[0]?.rows.find((r) => (b?.total ?? 0) <= r.upTo); return row ? row.label : 'Per delegation of authority' }
    case 'today': return s.settings.asOf
  }
  return undefined
}

/** The form's values: saved answers, with read-only fields always from Crosswalk and empty fields pre-filled. */
export function formValues(s: AppState, p: Project, t: DocFormTemplate, saved: Record<string, FormValue> = {}): Record<string, FormValue> {
  const out: Record<string, FormValue> = {}
  for (const f of allFields(t)) {
    if (f.readOnly && f.prefill) { out[f.key] = prefillValue(s, p, f.prefill) ?? ''; continue }
    if (typeof saved[f.key] === 'boolean' && f.type === 'select') { out[f.key] = saved[f.key] ? 'Yes' : 'No'; continue } // answers saved before yes/no became a choice
    if (saved[f.key] !== undefined && saved[f.key] !== '') { out[f.key] = saved[f.key]; continue }
    if (f.prefill) { const v = prefillValue(s, p, f.prefill); if (v !== undefined) { out[f.key] = v; continue } }
    out[f.key] = f.type === 'table' ? [] : f.type === 'checklist' ? {} : f.type === 'boolean' ? false : ''
  }
  return out
}

const empty = (v: FormValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.some((r) => Object.values(r).some((x) => x !== '' && x != null)))

/** Required answers that are still missing. */
export function missingFields(t: DocFormTemplate, v: Record<string, FormValue>): string[] {
  const out: string[] = []
  for (const f of allFields(t)) {
    if (!f.required || f.readOnly) continue
    if (f.type === 'checklist') { const c = (v[f.key] ?? {}) as ChecklistValue; if ((f.items ?? []).some((i) => !c[i]?.v)) out.push(f.label); continue }
    if (f.type === 'boolean') continue
    if (empty(v[f.key])) out.push(f.label)
  }
  return out
}

/** Plain text for a value (PDF, CSV, metadata). */
export function fieldText(f: DocField, v: FormValue | undefined): string {
  if (v === undefined || v === null || v === '') return ''
  if (f.type === 'money' || typeof v === 'number' && f.type !== 'number') return typeof v === 'number' ? usd(v) : String(v)
  if (f.type === 'number') return `${(v as number).toLocaleString?.('en-US') ?? v}${f.unit ? ` ${f.unit}` : ''}`
  if (f.type === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function deliverableDef(s: AppState, d: Pick<Deliverable, 'defId'>): DeliverableDef | undefined {
  for (const t of s.templates) for (const st of t.stages) { const x = st.gate.deliverables.find((y) => y.id === d.defId); if (x) return x }
  return undefined
}

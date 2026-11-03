# Contributing to Crosswalk

Thanks for helping. Read [AGENT_RULES.md](AGENT_RULES.md) first. It binds people and AI agents alike.

- **Fictional data only.** Use the Arroyo Valley Gas seed or data you generate. Never commit a real
  utility's projects, estimates, actuals, exports, mapping tables, people, vendors or screenshots.
- **No proprietary vendor code or screens.** Use public standards (AACE, GAO) instead.
- **No new dependency** unless it is MIT, Apache-2.0, BSD or ISC. Run `npm run licenses` after adding one.
- **No outside calls** from the running app (no CDNs, fonts, telemetry or analytics). AI assist stays off by
  default.
- **Fair estimating.** Factors are physical, legal or logistical drivers only, never demographic or wealth
  attributes.

## Workflow

1. One feature per branch, small commits with plain-English messages.
2. Before opening a pull request, run all of these and paste the results into the PR:
   - `npm run typecheck`
   - `npm test`
   - `npm run build` (it must still produce the single self-contained `dist/index.html`)
3. Every engine change ships with vitest tests next to the code (`*.test.ts`). `buildSeed()` from
   `@/core/seed` gives you the full demo dataset.
4. Mark anything a human must check (formulas, regulatory text, BOE wording) with `// VERIFY:` and list
   those lines in the PR.
5. Keep `src/core/engine` pure: it imports only `../types`, `../util` and sibling engine files. All storage
   goes through `src/core/data`. `src/agent-rules.test.ts` enforces both.

Imports use the `@/` alias for `src/`.

## Data and mutations

- Types: `src/core/types.ts` (read it first — every record shape is there).
- Read: `const s = useStore()` (whole state) or `useStore(s => s.projects)`. Helpers: `useMe()`,
  `personName(s, id)`, `categoryName(s, id)`.
- Write: `mutate(d => { ...mutate the immer draft... }, { entity, entityId, action, summary, projectId })`.
  The second arg appends an audit entry — include it for every user action that changes data.
- New ids: `uid('prefix')`. "Today" is `s.settings.asOf` (the demo clock, 2026-10-28). Timestamps: `nowISO()`.
- Records are immutable once approved: create a new version instead of editing an approved estimate,
  snapshot, gate decision or workflow history.

## Engine (use it, don't re-implement)

- `engine/gates.ts`: `templateFor`, `requiredDefs`, `ensureDeliverables`, `readiness(s,p)` (pct, blockers),
  `permissions`, `ntpBlockers`, `decideGate(d, pid, outcome, deciderIds, notes, conditions)`.
- `engine/estimates.ts`: `MATURITY_ITEMS`, `computeClass`, `missingFor`, `CLASS_RANGES`, `estimateTotals`,
  `parametricLines`, `ratesFor`, `approveEstimate`, `createBudgetFromEstimate`, `benchmark`, `estimateBridge`,
  category ids `LOADER_CAT`, `ESC_CAT`, `CONT_CAT`.
- `engine/position.ts`: `position(s,pid)` → budget/EAC/actual/contingency/exposure; `activeBudget`;
  `takeSnapshot(d,pid,type,label,opts)`; `snapshotsFor`; `latestOf`; `compareSnapshots(a,b)`;
  `thresholdBreaches(s,p)`; `nextMilestone`.
- `engine/risk.ts`: `riskScore`, `riskBand`, `pert`, `expectedCost`, `exposure`, `isActive`, `monteCarlo`,
  `LIKELIHOOD_LABELS`, `CONSEQUENCE_LABELS`.
- `engine/evm.ts`: `evmSeries(periods)`, `evmMetrics(periods, bac)`.
- `engine/workflow.ts`: `startWorkflow(d, key, {title, recordType, recordId, projectId, data})` — pass
  `data.amount` for anything routed by dollar authority; `actOnWorkflow`, `recallWorkflow`, `tasksFor`,
  `simulate`, `resolveAssignees`, `laneOf`, `latestDef`, `doaRoleFor`. Starting a workflow sets the
  record's status (estimate → in-review, etc.) and completion applies the outcome (see `onComplete`).
  Process keys: change-request, gate-review, estimate-approval, budget-authorization, contingency-drawdown,
  safety-plan, deliverable-review, contract-award, variance-explanation, waiver, project-initiation, closeout.
- `engine/wbs.ts` (forecast spread against the WBS functions — CBS Level 3 codes 100–999, `s.settings.wbsFunctions`): `toFunctions(s, byCategory)`
  (loaders/escalation allocated pro-rata, contingency separate), `budgetByFunction`, `actualsByFunctionMonth`,
  `actualsByFunction`, `actualsThrough`, `forecastMonths(s,p)`, `SPREAD_METHODS`, `curve`, `spreadAmount(total, months, method)`,
  `defaultSpread(s,p,etcTotal?)`, `spreadTotal/ByFunction/ByMonth/ByYear`, `latestForecast`, `eacOf`, `functionRows`.
  Forecast record: `spread[fnId][YYYY-MM]` = ETC; `contingencyHeld`; `actualsThrough`; `status` draft/submitted/approved/returned;
  process key `forecast-review` (recordType 'forecast'; completion sets status and locks it). CostPeriod.byFunction = actuals split.
- `engine/info.ts` (Project Information record, `s.settings.infoFields` + `infoSections`): `infoValue(p, def, s)`,
  `setInfoValue`, `missingInfo(s,p)` (required-at-stage fields that are empty — also a gate blocker in `readiness`),
  `infoCompleteness`, `reviseInfo(d, pid, edits, note)` (writes field-level revision to `s.infoRevisions` + audit).
- `util.ts`: `money()` ($1.2M), `moneyDelta`, `pct`, `fmtDate`, `fmtMonth`, `addDays`, `daysBetween`,
  `monthRange`, `groupBy`, `sum`, `cx`, `evalCondition`, `describeCondition`.

## Forecast line items, SAP actuals, profiles (engine/lines.ts, engine/sap.ts)

- `s.settings.forecastLines` — line items (code '06.10'), each rolls up to ONE WBS function (`functionId`)
  and owns CBS categories (`categoryIds`). `forecastLines(s)`, `linesOfFunction(s, fnId)`, `lineById`.
- Budget/actuals by line: `budgetByLine(s, pid)` → `{byLine, contingency}`, `actualsByLine(s, pid)`,
  `actualsByLineMonth(s, pid)` (Grid = key → 'YYYY-MM' → $). `linesToFunctions(s, byLine)`, `rollupGrid(s, lineGrid)`.
- Forecast: `f.lineSpread` (line × month ETC) is authoritative; `f.spread` is its roll-up by function. After
  editing `lineSpread` inside `mutate`, call `syncForecast(d, f)` (re-derives spread, eac, byYear).
  `lineGridOf(s, p, f)` reads any version at line level (old versions only had `spread`).
- Profiles per WBS function: `f.profiles[fnId] = {profileId, start, end, adjusted, appliedAt}`. Built-in ids
  are the SPREAD_METHODS ('even','scurve','front','back','bell'); custom ones live in
  `s.settings.spreadProfiles` (weights resampled to the window, optional `zeroMonths` black-outs).
  `applyProfile(s, p, f, fnId, {profileId,start,end}, fnTotal?)` → new line grid for that function's lines.
  After a profile is applied, cells stay editable; any hand edit sets `profiles[fnId].adjusted = true`.
  `allProfiles(s)`, `profileName(s, id)`, `profileWeights`, `spreadByWeights`, `splitExact`, `allocate`.
- ETC/EAC by function: `etcEacByFunction(s, p, f)` → `{rows: FunctionRow[] (with nested `lines: LineRow[]`),
  contingencyHeld, totals}`; each row has budget, actual, etc, eac, vac (= budget − EAC), pctSpent, profile.
- SAP: `s.settings.sapMappings` (priority-ordered rules: cost-element range, optional `wbsSuffix`,
  optional `textContains`, target 'line' | 'allocate' (loader settlements spread pro-rata) | 'exclude').
  `parseSapExtract(text, fallbackPeriod)` → rows/errors/columns; `stageImport(d, rows, fileName)`;
  `remap(d, importId)` after rules change; `resolveTxn(d, txnId, {lineId|exclude|projectId}, note)`;
  `postImport(d, importId)` → `{ok, reason}` (unmapped / no-project rows block posting; posting rebuilds
  CostPeriod.actual/byLine/byFunction for each project-period in the file, replacing earlier SAP data);
  `discardImport`; `matchRule(rules, row)`; `projectForWbs(s, wbs)`; `txnsFor(s, pid, {lineId, fnId, period})`
  for drill-down; `sampleExtract(s, period)` builds a demo CSV. Collections: `s.actualsImports`, `s.actualTxns`.
  Seed: P07–P09 posted; `CJI3_FY2026_P10_wk4.csv` staged with 4 exceptions (unknown cost element 5450110,
  WBS C.PSE.9999 with no project, a credit memo, a balance-sheet transfer that the exclude rule catches).
  `periodLines(s, rows)` is the posting roll-up (allocation + whole-dollar rounding) shared with reconciliation.
- Fictional sample: `samples/sap-actuals-fictional.csv` (CJI3-style headers, built by `fictionalSapExtract` in
  engine/sapSample.ts from the seed's posted P09 rows for six projects plus quirks; regenerate with
  `npm run sample:sap`). The SAP actuals page bundles it via `?raw` ("Load the fictional sample file"). Only
  fictional data may be loaded in the public demo.
- Reconciliation (engine/reconcile.ts): `reconcile(s, rows, {period})` compares SAP project cost (rows through the
  current mapping table, less rule exclusions; no-project rows bucketed) with posted `CostPeriod.actual/byLine/
  byFunction` and the latest forecast's actual months, per project-period → status ties | lines-differ | differs |
  not-posted (`RECON_TOLERANCE` $1). Rows are matched to posted transactions by period, WBS, document, cost element
  and amount; `items` (sap-only, crosswalk-only, mapped-differently) carry each row's effect so differences are
  explained. `reconCsvRows` / `reconItemCsvRows` for export. UI: Reconciliation tab on SAP actuals;
  `openReconciliation({projectId})` is the per-project entry (forecast tab footer).

## Class 5 quick estimate (engine/quick.ts)

- `s.historicalCosts`: direct $/unit (P10/P50/P90, n, baseYear, category `mix`) by asset type × work method ×
  diameter band × terrain ('any' allowed). Units: ft, site, hp, station. `QUICK_CATALOG` lists asset types,
  their work methods, unit and whether diameter bands apply. `DIAMETER_BANDS`, `bandOf(dia)`, `UNIT_LABEL`.
- `findHistorical(s, inputs)` → `{row, match: 'exact'|'any-terrain'|'nearest-band'|'none'}`;
  `computeQuick(s, inputs, basis='p50', adjustPct=0)` → direct, loaders, contingency, total, low (P10), high (P90),
  regionFactor (settings.quickEstimate.regionFactors), escalationFactor (base year → midpoint year).
  `inputsFromProject(s, p)` pre-fills. `createQuickEstimate(d, pid, inputs, requestNote, byId?, needBy?)` makes
  an Estimate with `method: 'quick'`, `cls: 5`, `quick: {…}` and lines from the mix. Route it with
  `startWorkflow(d, 'class5-review', {title, recordType: 'estimate', recordId: e.id, projectId, data: {amount, note}, startedById})`
  then `actOnWorkflow` on the 'prep' step to submit. Steps: prep (requester) → est (role estimator, any) → lock.
  On approval the completion hook approves the estimate. `adjustQuickEstimate(d, id, {pct, basis?, reason})`
  is how an estimator adjusts during review (keeps before/after + audit). `deriveFromClosed(s, p)`.

## Finance, estimating administration and messaging (see types.ts)

- Regions are North / West / South / East (`project.location.district`). Counties: `project.counties` [{county, pct}].
- `s.settings.estimating` (EstimatingConfig): regions, regionFactors, contingencyByClass, taxRates (county %), taxableCategoryIds,
  units (allowed units), quantityTypes (allowed scope quantities; `feeds` says which estimate input it drives), scopeLibrary
  (in/out-of-scope + assumptions picklists), maturityItems (class checklist, maintained by estimating), rateTableVersion + history.
  `UnitCostRate.region` = region-specific rate row. `EstimateLine.override` = estimator override of a locked unit cost.
  Loaders (`settings.loaderRates`) and escalation (`settings.escalationByYear`) are portfolio-wide and locked per project.
- `project.scope.capitalPct` (rest is O&M); `scope.quantities[].typeId` → quantityTypes.
- `project.finance` = { woa, ios: InternalOrder[] } (IO type capital|om, status, functionIds). Key facts display; Finance tab manages.
- Commitments = `s.contracts` (call-offs): poNumber, poTotal (blanket PO), pctOfPo, scope, lineIds (forecast lines), ioId.
  `s.commitmentChanges` = RFI / contract change orders, the single entry point for commitment changes; workflow key
  'commitment-change' (prep PM → CM → project controls → DOA approval); approval adds `amount` to `contract.changeOrders`.
  `Change.contractIds` (commitments a project change affects), `Change.scheduleNotice` (task to the scheduler; P6 is not written back).
- Messaging: `s.channels` (project | direct) and `s.messages`. Notifications have `kind`.
- `settings.workflow` { reminderDays, escalateAfterDays }; `Person.outOfOffice` { from, to, delegateId } (engine already routes to delegate).
- `settings.features` { fieldTailboard, portfolioPlanning, opQual } — phase-2 modules, off by default.
- WBS: contingency is 990 (held separately), undifferentiated 999.

## UI

- Kit: `src/ui/kit.tsx` — Button, Badge, StatusBadge/statusTone, HealthDot, ClassBadge, Avatar, Progress,
  StageTrack, PageHeader, Panel, Stat, KV, Empty, Callout, Tabs, Table (sortable columns), Field, Input,
  TextArea, Select, Checkbox, MoneyInput, Modal, Drawer, ConfirmButton, SegButtons, Mono, Section, AiTag.
- Charts: `src/ui/charts.tsx` — LineChart, BarChart, HBarChart, Waterfall, Sparkline, Histogram, RiskMatrix, RangeBar.
- `toast('Saved')` from `src/ui/toast.tsx` after every action. `Icon` from `src/ui/icons.tsx`.
- Shared: `<WorkflowStatus instanceId=… />` (history + approve/return/reject for the current user),
  pickers `PersonSelect`, `ProjectSelect`, `ProgramSelect`, `ProgramTag` in `src/views/shared/pickers.tsx`.
- Routing: hash links only. `projectHref(id, tab)` → `#p-1042-estimates`; tabs: overview, info, map, lifecycle,
  estimates, baselines, cost, forecast, changes, risk, safety, permits, records, evidence, activity.
  Top-level: `#portfolio #projects #new-project #inbox #gates #estimating #risk #safety #field
  #regulatory #planning #workflows #wf-<key> #admin #audit`. Use `<a href>`; `go(hash)` in handlers.
- Styling: Tailwind with token colors only — `bg-surface bg-sunken bg-ground border-line text-ink
  text-muted text-faint text-good text-warn text-bad text-info text-link bg-marker text-markerink bg-steel`.
  Opacity works (`bg-bad/10`). NEVER hard-code hex/rgb or use `dark:` variants (tokens handle dark mode).
  Fonts: `font-display` (headings), default body, `font-mono` for IDs/codes. `tabular-nums` for figures.
  Amber `marker` = "needs action" only. Semantic good/warn/bad for status.
- Treatment: a dense, polished professional tool (think a modern capital-project platform). Summary before detail,
  real typographic hierarchy, tables over cards, state shown as badges/dots. No emoji. No lorem ipsum.
  Write copy from the user's side ("Submit for approval", toast "Submitted for approval").
- Must work at phone width (~400px): grids collapse (`grid-cols-1 md:grid-cols-2`), tables scroll inside
  their own container (Table already does), give text containers `min-w-0`.
- The page may run in a sandboxed frame: don't use `alert/confirm/prompt` (use ConfirmButton / Modal);
  download with `saveFile(filename, data, mime)` from `@/core/download` (plus `toCSV`, `htmlDoc`);
  no window.print; no external fetches.
- AI assist is OPTIONAL and OFF by default (Configuration → AI assist points it at the organization's LLM
  gateway). `ask(prompt)`, `askJSON<T>(prompt)` from `@/core/ai`; call only from a click; `useAiAvailable()`
  is false by default → render NO AI controls and no "AI unavailable" notes. Never name a vendor or model
  in UI copy; say "AI assist". New features must not depend on AI.

## Quality bar

Every view opens in a realistic working state from the seed data, every button does something real
(mutates the store, starts a workflow, downloads a file, or opens a drawer), and every number traces to
records. Build complete features, not placeholders.

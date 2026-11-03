# Crosswalk

Open-source capital project delivery for gas utilities. It covers:

- stage gates
- AACE-class estimating that becomes the budget
- a transparent Class 5 factor model with a backtest
- forecasting by WBS function
- SAP actuals import and reconciliation
- risk-linked contingency, change control and job safety plans
- a workflow designer that also prints the SOP

Every dollar, date and scope change traces back to an approved decision and its evidence.

**Live demo: [crosswalk-demo.pages.dev](https://crosswalk-demo.pages.dev)**, with a shared database. It redeploys on every push to `main`.

> **All data in this repository is fictional.** The demo runs a made-up utility, **Arroyo Valley Gas**:
> 30 projects on five programs, with lines named AV-11 to AV-28 and vendors such as "Delta Pipeline Co.".
> No real company's projects, costs, people, vendors or systems are included, and none may be added.
> See [AGENT_RULES.md](AGENT_RULES.md).

## Try it

- **Hosted demo:** everyone shares one dataset in a Postgres database. Anyone with the link can look around;
  changes need the edit passcode and are saved for everyone, with every change kept in the database's history.
- **Offline copy:** download [`Crosswalk.html`](Crosswalk.html) and double-click it. It is the whole app in one
  file and makes no network calls. It isn't connected to the database, so changes there are not saved.
- **Run locally with the database:**

  ```bash
  npm install
  npm run build && npm run serve:local   # http://localhost:8788, edit passcode "local", in-memory Postgres
  npm run dev                            # UI only, hot reload, not saved
  ```

### A five-minute demo path

1. **Estimating → Quick estimate.** Pick a project, or enter pipe size, length, soil, permits, traffic and
   work hours. The factor model returns:
   - a Class 5 cost
   - every driver's effect, itemized
   - a P10–P90 range
   - a comparison with the rate-table estimate
   - draft basis-of-estimate (BOE) text

   Apply an estimator adjustment with a reason and send it for review.
2. **Estimating → Admin → Factor model.** Change a weight or a multiplier and watch the backtest against
   60 fictional closed projects update (MAPE, bias, P10–P90 coverage). Publishing a new version goes
   through an approval gate, and every version is kept.
3. **Monte Carlo.** Run the model's base uncertainty plus project risks to get P10/P50/P80/P90.
4. **SAP actuals.** Click **Load the fictional sample file**. It is a CJI3-style extract in
   `samples/sap-actuals-fictional.csv`. Map it, post it, then open **Reconciliation** to see SAP tie to
   posted actuals and the forecast by project, period, line and cost element.
5. **Any project.** Look at its gate readiness, baselines, forecast by function, change requests, risk
   register and audit trail.

## Build, test, check

```bash
npm run typecheck
npm test                 # vitest: engine tests + AGENT_RULES guard tests
npm run build            # dist/index.html: the whole app as one self-contained file
npm run licenses         # every dependency must be MIT, Apache-2.0, BSD or ISC
npm run sample:sap       # regenerate the fictional SAP sample extract
```

`src/agent-rules.test.ts` fails the build if:

- estimates change when a project's `location.dac` flag flips
- an estimating factor binds to a demographic or wealth attribute
- the engine imports UI, storage or network code
- anything touches browser storage outside the data-access interface
- real-format docket numbers or non-fictional vendor names appear
- AI or outside map services are on in the demo data
- the audit log can be edited

## Host the public demo (free)

The demo runs on **Cloudflare Pages** (the page plus `/api` functions, free and commercial use allowed) with
**Neon** Postgres (free tier). `.github/workflows/deploy.yml` does everything on each push to `main`: typecheck,
tests, license check, build, SQL migrations, then deploy. It needs four repository secrets:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → a token with **Cloudflare Pages: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → the account ID on the right |
| `DATABASE_URL` | Neon → your project → Connection string |
| `EDIT_PASSCODE` | Any phrase you choose; people type it to edit |

Without the secrets the workflow only runs the checks. How the data is stored:

- A "generation" starts from a full snapshot.
- Every edit is appended as an ordered change (immer patches).
- Database triggers refuse any update or delete (`migrations/001_shared_state.sql`).
- "Reset demo data" starts a new generation. Nothing is ever deleted.
- Secret settings (AI key, map tokens) and the persona you act as never leave the browser.
- On the shared demo, file uploads and pasted extracts are turned off. Only the bundled fictional samples load.

The public demo is for fictional data only:

- no company branding
- no company login or email sign-up
- no uploads of real files

Hosting real data belongs inside an organization's managed cloud, after its architecture review.

## What's in it

| Area | Highlights |
| --- | --- |
| Stage gates | Configurable lifecycle templates, conditional deliverables, readiness score, gate packets, Go/Conditions/Recycle/Hold/Cancel decisions with immutable history, stage permissions |
| Estimating | Class from a maturity checklist; Class 5 factor model (physical, legal and logistical drivers only, itemized, with a range and a backtest); rate-table Class 5 by region; Class 3 line items; loaders, escalation, contingency, county sales tax; BOE as PDF or CSV; version bridge; estimate → budget |
| Factor model admin | Weights, multipliers and uncertainty per driver; backtest; override reasons; publish gate; version history |
| Forecast | Line items under WBS functions 100–999 with a curve profile per function, then hand adjustment; ETC/EAC by function; versions and review |
| SAP actuals | CSV import, priority-ordered mapping (cost element range, WBS suffix, text) to line, allocation or exclusion; exception queue; posting; reconciliation |
| Finance | Work order authorizations and internal orders, commitments against blanket POs, RFI/CCO and commitment-change workflow |
| Cost & change | EVM (CPI, SPI, EAC, TCPI); change requests routed by dollar authority that create new current baselines |
| Risk | Register with L×C and 3-point impacts, Monte Carlo cost and schedule, contingency adequacy and drawdown |
| Safety | Job safety plan builder from a hazard library, permit and 811 expiry, field tailboard |
| Workflow | Visual designer (roles, positions, dollar-authority routing, conditions, parallel reviews, SLAs, reminders, escalation, out-of-office delegation), inbox, auto-generated SOP, swimlane and RACI |
| AI assist | **Off by default**, and hidden while off. It makes no calls in the demo build. An organization can point it at its own approved gateway later |
| GIS | Project points and alignments, KML/GeoJSON in and out. Outside basemaps are **off by default** |

## Architecture

```
src/core/types.ts          domain model (read it first)
src/core/engine/*.ts       pure functions, no UI/storage/network imports; every change ships with vitest tests
src/core/seed/             fictional reference data + history replayed through the engine
src/core/data/             the one data-access interface: the app's own API (Postgres); UI preferences stay in the browser
src/core/sync.ts           loads the shared data, sends each change, merges others' edits, re-applies on conflicts
src/server/                the API: plain (request) => response handler, SQL repository, migration runner
functions/api/             Cloudflare Pages adapter for the API handler
migrations/                plain SQL migrations (append-only tables)
src/core/auth/             swappable OIDC-style interface: id, name, groups → Crosswalk roles
src/core/store.ts          zustand + immer; every write goes through update(fn, audit); the audit log is append-only
src/views/                 one folder per module
samples/                   fictional sample files (SAP extract)
```

The planned production path (see [AGENT_RULES.md](AGENT_RULES.md) §5):

- a static front end plus serverless `(request) => response` handlers (Cloudflare Pages functions now, AWS Lambda later)
- Postgres through plain SQL migrations
- OIDC sign-in
- infrastructure in Terraform (today the deploy is scripted in GitHub Actions; Terraform is still to do)
- no containers or VMs

## Contributing

Read [AGENT_RULES.md](AGENT_RULES.md) first. It applies to people and AI agents alike. The core rules:

- fictional data only
- no proprietary vendor code or screens
- permissive licenses only
- no outside calls
- fair estimating factors
- small commits, one feature per branch, a PR saying what changed and how it was tested
- `// VERIFY:` on any formula, regulatory text or BOE wording a human must check

[CONTRIBUTING.md](CONTRIBUTING.md) explains the engine and store conventions.

If your AI coding assistant can't read the repository directly, `copilot/` holds the source as plain-text
files: one complete file plus smaller parts by area. Regenerate them with `npm run copilot-txt`.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).

Nothing here is engineering, legal or financial advice. The formulas and regulatory references marked
`// VERIFY:` must be checked by a qualified person before anyone relies on them.

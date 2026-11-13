# Agent rules

Rules for any person or AI agent changing Crosswalk. Transcribed from the project owner's rules file; where the
original line was cut off, the end is marked _[…]_ and should be replaced with the original wording.

---

## 1. Data: fictional only, no exceptions
1. Use only the fictional "Arroyo Valley Gas" data in `src/core/seed/` or data the agent generates.
2. Never accept, request, read, or paste:
   - Utility company project data, estimates, TICs, BOEs, actuals, SAP or Unifier exports, or screenshots
   - Anything marked Confidential or Restricted, or covered by PU Code §583
   - Real cost-element, vendor, or cost-center mapping tables
   - Org charts, employee names, or emails
   - Customer data or personal information of any kind
3. **Scrub real identifiers.** Replace real-looking pipeline line numbers in the seed (e.g. Line 85, 1004, 2001, 3000) with obviously fake ones _[…]_ — no street pairings with real line numbers.
4. **No real vendor names.** Use fakes (e.g. "Delta Pipeline Co."). No real contractors, consultants, or staffing firms.
5. **No real people.** User names in the demo must be fictional.
6. If the human pastes something that looks like real company data, **stop, refuse to use it, and ask them to remove it** from the session _[…]_

## 2. Third-party IP
7. Do not reproduce, copy, or reverse-engineer Oracle Unifier, Primavera P6, HCSS HeavyBid, or Enstoa/Concertus code, screens, adapters, or docs. Use public standards (AACE, GAO) and the requirements in this repo.
8. Use only dependencies with permissive open-source licenses (MIT, Apache-2.0, BSD, ISC). Run a license check before adding one. No GPL or AGPL _[…]_
9. Do not copy code from sources of unknown license.

## 3. No AI or outside calls in the running app
10. Ship the app with all AI features **off by default** (`src/core/ai.ts`). No calls to any LLM API in the demo build.
11. The app makes no network calls except to its own API. No telemetry, analytics, CDN fonts, or third-party scripts.
12. No secrets in code. Configuration goes in environment variables; `.env` files go in `.gitignore`.

## 4. Fairness in the estimating model
13. Factors must be physical, legal, or logistical cost drivers (soil, permits, HCA, remoteness, traffic, work-hour restrictions).
14. **Never** use demographic or wealth attributes as model inputs: `location.dac`, income, race or ethnicity, home value, or zip-code proxies. A test fails if any factor binds to `location.dac`.
15. Every estimate must show its drivers itemized (no black box).

## 5. Architecture: portable to AWS serverless
16. Keep the engine pure: `src/core/engine` has no imports from UI, storage, network, or framework code.
17. All persistence goes through one data-access interface, with two implementations: the browser (localStorage) version for the demo, and a Postgres version for later. Nothing outside the interface touches storage.
18. API handlers are plain `(request) => response` functions, so they run on Vercel functions now and AWS Lambda later. No framework-specific server features.
19. Postgres only through plain SQL migrations. If Supabase is used, use it **as Postgres only**: no Supabase Auth, row-level-security policies, edge functions, or realtime.
20. Login through a swappable OIDC interface that uses only the user's ID, name, and group claims. Groups map to Crosswalk roles.
21. The audit log is append-only (no update or delete) in every storage implementation.
22. Infrastructure goes in Terraform. No click-built cloud resources.
23. No containers or VMs. Static front end plus serverless functions only.

## 6. Quality bar: every change
24. Run `npm run typecheck` and `npm test` before calling a change done, and report the results. Never mark failing work complete.
25. Every engine change ships with vitest tests.
26. Small commits with plain-English messages, one feature per branch, and a pull request describing what changed and how it was tested.
27. Don't break the demo. `npm run build` must still produce the single-file HTML.
28. Mark anything AI-generated that a human must verify (formulas, regulatory text, BOE wording) with `// VERIFY:` and list those items in the PR.

## 7. Scope: the usable demo (in this order)
1. Scrub the seed data (rules 3–5) and add the `location.dac` guard test (rule 14).
2. Apply `crosswalk-factor-model.patch`. Typecheck and test.
3. Factor model admin screen (weights, backtest, override reasons, publish gate, version history).
4. Quick estimate screen showing the factor-model path: drivers, range, BOE text, rate-table comparison, estimator adjustment.
5. Monte Carlo view using the model's base uncertainty.
6. SAP CSV import against a **fictional** CSV in the same column layout, plus a reconciliation view.
7. Data-access interface (rule 17) with the browser version only. Postgres comes after approvals.

**Done =** a stranger can open the built HTML or the Vercel URL, run a Class 5 estimate, adjust the model in admin, and see the backtest. All data is fictional, and all tests pass.

## 8. Hosting the demo
- Public hosting (Vercel) is for **fictional data only**, with no company branding, logos, or names.
- No company login, no company email sign-up, no uploads of real files.
- Hosting with real data happens only inside the company's managed cloud after architecture review approval.

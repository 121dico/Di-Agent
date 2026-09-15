# Fixed Data Reporting

## 1. Scope / Trigger

Use this contract when adding or changing enterprise data sources, fixed report definitions, report runs, scheduled generation, or report downloads.

## 2. Signatures

- `GET|POST /api/reports/sources`
- `GET|POST /api/reports`
- `POST /api/reports/:id/run`
- `GET /api/reports/:id/runs`
- `GET /api/reports/:id/runs/:runId/download`
- DB: `report_data_sources`, `report_definitions`, `report_runs`
- Runtime credentials: environment variable names stored in `app_key_env` and `signature_env`; an optional `x_date_env` is reserved for replay-based integration tests.

## 3. Contracts

- A Report Definition binds exactly one Data Source.
- The platform may register multiple independent Data Sources; generic report queries never join them. The bounded administrator-only station score evidence lookup below is an explicit exception, not an arbitrary join facility.
- Credentials stay in backend environment variables. APIs expose only environment-variable names, never credential values.
- A captured signature may use `x_date_env` for a short-lived replay test. Production schedules must leave it empty and use a dynamic `Signer` implementation.
- A manual test and the 10:00 Asia/Shanghai scheduler call the same `ReportRunner.Run` interface.
- A manual Report Run force-refreshes the inclusive 31-day analytics range ending at the returned source partition; a scheduled Report Run force-refreshes only that latest partition.
- Persisted daily analytics are reusable only when every calendar date in the requested inclusive range is present. Matching only the first and last date is forbidden because it hides missing or stale middle partitions.
- Successful runs store immutable JSON snapshots plus source partition, query ID, duration, and timestamps.
- Fixed query JSON permits approved fields, filters, grouping, ordering, pagination, and aggregate functions: AVG, MIN, MAX, SUM, COUNT, COUNT DISTINCT.
- MVP rejects non-empty `expression` fields.

## 4. Validation & Error Matrix

- Non-admin creates a Data Source or Report Definition -> 403.
- Invalid endpoint, empty API name, missing credential-reference name, malformed JSON, unsupported aggregate, or expression -> 400.
- Missing Report Definition or Data Source -> 404.
- Missing credential environment value or upstream failure -> failed Report Run plus generic 500 response; secret values must not appear.
- Empty catalog/history -> frontend normalizes `null` to `[]` and renders an empty state.

## 5. Good / Base / Bad Cases

- Good: an admin creates one source and an aggregate report; manual run stores a traceable snapshot and the same report runs at 10:00.
- Base: no reports exist; `/reports` shows an administrator creation entry and no fabricated metrics.
- Bad: an Agent submits arbitrary expression/SQL or downloads all `duid` rows to calculate a card in the browser.

## 6. Tests Required

- Service test: `ReportRunner.Run` persists rows, partition, query ID, duration, and successful status.
- Service validation test: expression and unsupported aggregate are rejected.
- Connector test: upstream `resultCode`, rows, partition, and query ID are normalized without leaking headers.
- Signer test: a configured replay date is taken from its environment-variable reference without persisting the date value.
- Frontend test: stored snapshot plus visualization config produces metric cards and numeric series.
- Browser smoke: empty `/reports` route, administrator configuration dialog, and navigation remain usable.
- Service test: a cache containing the requested first and last date but missing a middle date must query upstream.
- Service test: manual runs refresh 31 days while scheduled runs refresh one day.

## 7. Wrong vs Correct

### Station validation adjunct
- Scope: V1.2 report's independent validation section; it never changes the report's main source or joins APIs.
- Signature: `GET /api/reports/:id/station-validation`, optional `refresh=true` is admin-only. Returns source name, fetched_at, available_dates, daily station/ALL users and level counts; no DUID/order rows.
- Contract: resolve exactly one enabled `station_price_sensitive_test_detail`; require allowed select/group/sort/filter capabilities before cache. Filter duid>0, MATCHED, vehicle_type=private. Use upstream `COUNT_DISTINCT`, independently aggregate ALL across stations and each station. Seven bands plus UNKNOWN must sum to distinct users or fail. Missing source dates remain missing; successful empty cohort on a known source date is zero. Range totals mean user-days.
- Cache: typed JSON under `station-validation:` namespace in existing analytics cache; key includes source/contract/report configuration, expiry next Asia/Shanghai 10:00. This is request-triggered expiry, not background prewarming. Shared execution lock prevents overlapping cold-load/refresh writes.
- Validation: wrong profile/disabled field/ambiguous source ->400/404; non-admin forced refresh ->403; invalid/truncated/duplicate pagination or distribution mismatch -> failure, never persist partial. Bound to 365 calendar days and 50,000 aggregate groups.
- Good/base/bad: ALL=distinct across stations / genuine zero cohort / summing station totals inflates cross-station users.
- Required tests: public service count/filter/pagination/cache/permission seam and UI date/station/baseline selection; missing yesterday must not substitute prior observation.
- Wrong: `ALL = sum(stations)` or `COUNT` on order-grain DUID. Correct: independently `COUNT_DISTINCT(duid)` grouped by `dt`.

### Station people overlap contract
- Scope: user-level validation under the station adjunct, not a change to V1.2 labels or the main report.
- Signature: `GET /api/reports/:id/station-people?station=ALL&start=YYYY-MM-DD&end=YYYY-MM-DD[&refresh=true]`.
- Contract: validate the base report/source and field capabilities before cache; group dt/station_id/duid/ps_level with COUNT_DISTINCT(order_id). Source contract requires order_id unique within a dt. Parse DUID losslessly as an integer string, never expose/cache identities. Use all available preceding cohort history for new/returning classification; selected range only for order-frequency totals. Period level is last observed consumption level; daily level is the consumption-day level.
- Cache: reuse analytics cache with station-people namespace; key includes base fetched_at, source/field contract and selected range/station. Same next-10:00 request-triggered expiry. Browser automatically requests valid selections using the cache-first path; only an administrator's explicit recompute forces refresh. Cold requests remain bounded and may take longer.
- Validation/errors: non-admin refresh ->403; missing capabilities/invalid dates/station ->400; duplicate groups, changing pagination total, missing pages, >500000 groups or conflicting daily labels ->error without partial cache. Missing prior dates are unavailable, not zero; `week_days_available` counts actual days in the prior seven calendar days.
- Good/base/bad: same DUID changing level is returning / a genuine empty known day is zero / identical macro counts do not prove identity retention.
- Tests: public service validates cache privacy, revocation, admin gating, pagination completeness and UNKNOWN; builder validates exact 7-day boundaries, historical/selected window separation, station scope and daily label conflicts. Frontend validates automatic cache-first queries, invalid selections, retry and stale response suppression. Opt-in `TestStationPeopleLive` is service integration only, not browser/auth acceptance.
- Wrong: previous seven rows or summing station users to infer unique people. Correct: calendar [D-7,D-1] identity intersections and backend DUID deduplication.

### Station score evidence
- Signature: administrator-only `GET /api/reports/:id/station-score-evidence?station=...&start=...&end=...&level=VERY_HIGH&min_days=2` (level also accepts HIGH).
- Scope: on-demand, single-station case investigation. Never auto-query user identities when opening the report. Keep the public repurchase aggregate separate; no identities in its cache. Respond with `Cache-Control: no-store`.
- Contract: validate both registered source contracts before querying. Fully paginate bounded station/user/day groups (maximum 50,000), reject partial or conflicting groups, and select up to 20 cases ordered by consumption days then orders. Level is the last consumption-day level; show actual first/last date, days, orders and candidate count, not an all-population causal conclusion.
- Match a candidate only to the same DUID and consumption-day V1.2 snapshot. Missing, duplicate or inconsistent labels are unavailable, never replaced with the latest date. Use allowlisted, enabled, non-sensitive selectable fields; do not expand field permissions implicitly.
- Observed price/coupon/time contributions use the supplied SQL weights 50/30/20 and must be labeled as such. Missing per-dimension priors cannot be recovered from the composite prior_score. Display raw base_score, profile_factor and ps_score without inventing psychological causes or silently relabeling users.
- Required tests: public service admin gate, contract revocation, pagination bounds/conflicts, exact historical match, missing/duplicate snapshots, and no unexpected response fields; frontend single-station restriction, independent manual query, stale suppression and missing-evidence presentation. Live helper is not a replacement for browser acceptance.

### V1.2 confidence cohort contract
- Scope: V1.2 analytics only; legacy reports retain their existing contract.
- Signature: analytics returns optional `order_cohort {user_count, share, distribution}`.
- Contract: append strict `ps_conf GQ 0` to the same saved/city/date conditions; latest returned snapshot supplies the overview while every returned dt retains cohort count/distribution for charts. For this user-supplied V1.2 SQL's unique `(dt,duid)` snapshot grain use COUNT(duid), expose `counting_basis` and do not claim an independently verified uniqueness audit. Never reuse this assumption on arbitrary table grains. Validate confidence filter capability before cache; version cache keys when the payload changes.
- `range=dates` discovers actual dt from 2026-07-28 through the requested end date under existing source/filter contracts. Frontend loads bounded one-day aggregates newest-first; preserve failed/missing dates as chart gaps, retain successful days, stop scheduling stale selections. Overview users are never summed across days.
- Validation: disabled confidence field -> invalid query; truncated groups -> failure, never cache partial data; successful empty cohort -> zero, failed/missing statistics -> unavailable.
- Good/base/bad: preserve two separate denominators / empty cohort is legitimate / never infer daily additions from rolling-order differences or label update dates.
- Tests: public QueryAnalytics checks strict filter, totals/share, genuine zero, truncation, saved filters and cache; UI checks unavailable is not zero.
- Wrong: label `ps_update_dt` as first-registration date. Correct: show daily additions unavailable until first-label and order-date data are supplied.

### V1.2 order-count selector
- Scope: single-day distribution adjunct, never changes label SQL or historical charts.
- Signature: `GET /api/reports/:id/order-cohort?date=YYYY-MM-DD&orders=all|1..10|gt10[&city=...]`; uses the existing authenticated report-view route. Analytics-shaped response: consume `data_date`, `fetched_at`, `cached`, `counting_basis`, `order_cohort.user_count/distribution`; other analytics fields are not this endpoint's metrics.
- Contract: saved non-dt conditions and normalized city selection remain; require ps_conf>0 and duid>0. All does not filter order count; exact/gt10 use order_cnt_180d, not capped ps_order_cnt. This field is last-label-refresh order count, not a freshly recomputed current rolling window. Server COUNT_DISTINCT per level must equal independent COUNT_DISTINCT total. Percentages use selected cohort total, with two displayed decimal places.
- Cache: existing template analytics store, `order-count:` namespace includes source, report configuration, field contract, date and selection; 10-minute TTL, capability checks before cache; same-key singleflight. No identities returned or cached. Empty cohorts verify the source snapshot exists before reporting zero.
- Browser: keep at most 12 successful selections for the current report/date/city scope, with ten-minute reuse eligibility. Selection changes revalidate expired entries; ordinary rerenders must not blank an already displayed result merely because time elapsed. Pending is an explicit loading state, not an empty cohort. Scope changes discard local results; failures are not cached.
- Validation/errors: non-V1.2/invalid date/count/>50cities/disabled capabilities ->400; missing source ->404; incomplete, duplicate, malformed, wrong-date or nonconserving aggregate ->error without cache. Query errors clear old selection rather than render zero.
- Good/base/bad: gt10 counts true >10 / zero people on an existing snapshot / reuse capped ps_order_cnt makes >10 impossible.
- Tests: public runner count/city/date/filter/cache/revocation and malformed totals; frontend exact choices, within-cohort denominator and stale/error suppression; opt-in TestOrderCohortLive checks all eleven groups against the independent all cohort without writing label tables.
- Wrong: download ten DUIDs and derive a distribution. Correct: ask upstream for all selected DUIDs' distinct grade counts.

```go
// Wrong: credentials or captured signatures are persisted and returned.
source.Signature = request.Signature

// Correct: persist only the environment-variable reference.
source.SignatureEnv = "REPORT_PRICE_SIGN"
```

```ts
// Wrong: an empty backend slice serialized as null crashes the view.
const reports = await get<ReportDefinition[]>('/api/reports');

// Correct: normalize at the API seam.
const reports = (await get<ReportDefinition[] | null>('/api/reports')) ?? [];
```

# Launchpad fixes: ranked backlog and implementation prompts

Prepared: November 1, 2026  
Baseline: `main` at `9def943`; recheck current code before implementing.  
Purpose: turn the code/application review into separate, testable implementation tasks.

## Review findings and priority

The review's 43 backend tests, TypeScript check and production build passed. Mocked backend probes and browser tests nevertheless reproduced scheduling, duplication, polling, input-validation, upload-root and navigation-state defects. Passing the existing suite does not establish correct launch behavior.

No live ads were created during the review. This document authorizes no implementation or deployment by itself; use the individual prompts when ready.

| Rank / ID | Severity and context | Issue | Practical consequence | Owner |
| --- | --- | --- | --- | --- |
| 1 / F01 | High now | Scheduling ignored for existing-campaign creatives | Ads created ACTIVE despite a future schedule. | Fixes |
| 2 / F02 | High now | Duplicate job submissions | Multiple clicks/retries can create duplicate advertising objects. | Fixes |
| 3 / F03 | High now | Poll failure treated as job failure | Retry becomes available while an existing launch may still run; bulk processing may overlap. | Fixes |
| 4 / F04 | High now | Weak request validation and truthy defaults | Zero budget becomes the configured default; missing existing-campaign ID can become a new campaign. | Fixes |
| 5 / F05 | High now | Target relationships and stale requests unchecked | Ad sets from another campaign may be displayed or submitted. | Fixes |
| 6 / F06 | High now | Partial failures have no safe recovery path | Media is deleted after failures; partial Meta results are not structured. | Fixes, then hosting integration |
| 7 / F07 | Critical before public exposure | No API authentication/ownership checks | A reachable API can launch ads or change settings using shared credentials. | Hosting, Phase 2 |
| 8 / F08 | Medium now | Multiple campaign roots and parser ambiguity | Later folders are ignored, or nested campaigns are misclassified. | Fixes |
| 9 / F09A | Medium now | UI loses job identity on navigation/reload | Users lose monitoring of jobs still running. | Fixes |
| 9 / F09B | High before hosting | In-memory jobs/uploads and daemon threads | Restarts lose state; multiple API processes cannot share it reliably. | Hosting, Phase 3 |
| 10 / F10 | Medium locally; high publicly | Incomplete upload/resource limits | Oversized files or expanded archives can exhaust disk/memory. | Fixes, then hosting integration |
| Follow-up / F11 | Medium now | Predictable failures discovered after Meta writes | Optional Instagram + image text variations can fail after campaign/ad-set creation. | Fixes |
| Follow-up / F12 | Medium locally; high publicly | Raw errors and token-bearing request URLs | Connection errors or upstream responses can disclose secrets in browser-visible logs. | Fixes |
| Follow-up / F13 | Medium for deployment reliability | Installs are not reproducible | Ignored npm lockfile and unpinned Python dependencies permit environment drift. | Coordinate with hosting |

“High now” means a correctness or recovery issue in the current local app. “Critical before public exposure” is conditional on making the API reachable; it does not claim the present local installation is publicly exposed.

## Work order and coordination

Use one fixes worktree and one hosting/PWA worktree. Do not run every prompt in parallel: many modify `launcher/backend.py`, `launcher/launch_core.py`, `app/launch/ui.tsx` and `app/bulk-launch/ui.tsx`.

Recommended fixes sequence: **F01 → F02 → F03 → F04 → F05 → F11 → F06 → F08 → F09A → F10 → F12**. F12 can be moved earlier if sanitized logging is needed for debugging. Coordinate F13 before the hosting chat creates dependency/container configuration.

The hosting/PWA chat can independently implement the foundation in [the hosting report](hosting-and-laptop-pwa-readiness.md). Reserve F07 and F09B for its later authentication/persistence phases. Agree on API contracts before those phases; incorporate the fixes branch first. Integration tests must cover the combined result.

F02 initially provides process-local idempotency if no durable store exists. F09B later makes it survive restarts. F06 initially provides retained media and structured partial outcomes; it must not advertise durable automatic resumption before the worker/checkpoint implementation exists.

## Shared instructions for every prompt

Every prompt below references these rules so it can be copied independently:

- Read this report, the current code and applicable repository instructions. Verify whether the finding still exists; do not reintroduce an old implementation to match the report.
- Work in the assigned fixes or hosting worktree. Preserve user edits. Commit each completed task separately. Do not merge, push, deploy or provision services unless separately requested.
- Preserve the Next.js frontend, Python launcher, asset selectors and video-upload timeout fix. Keep secrets and actual saved asset IDs out of commits, test output and client bundles.
- Use synthetic uploads, temporary configuration paths and mocked Meta responses. No real campaign/ad-set/creative/ad creation, real selection changes or live cleanup during tests.
- Add focused behavior tests for the failure and success paths. Run the existing backend suite; run TypeScript/build checks for frontend changes. Use browser checks when changing interactions. Do not claim unrun checks passed.
- Preserve API compatibility where reasonable; document deliberate contract changes in `lib/types.ts`, `lib/backend.ts` and the backend together.
- Address the requested part fully, report the tests and practical limitations, then stop. Do not silently implement the entire backlog.

## F01 — Scheduling correctness

Evidence: `app/launch/ui.tsx` offers scheduling for all launch modes; the creatives-only branch in `launcher/launch_core.py` creates ACTIVE ads without using the scheduled start time. Time conversion is duplicated in single/bulk UI and does not correctly format fractional-hour offsets.

Acceptance: unsupported scheduling is rejected before writes; supported schedules are validated; existing immediate launch behavior remains available. Confirmation must show supported scheduling clearly.

```text
Implement F01 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Fix scheduling correctness in the single/bulk UI, backend payload translation and launch core. For existing_campaign + creatives_only, disable future scheduling with a clear explanation and reject a scheduled request server-side before any Meta write. Do not pretend that an existing ad set's schedule has been changed, and do not activate or reschedule existing campaign/ad-set objects as a workaround. Implement actual delayed execution only if separately approved.

For modes that create ad sets, validate a timezone-aware future timestamp and preserve it through ad-set creation. Reject missing, malformed or past schedules before creating a campaign. Show the selected schedule in confirmation. Replace duplicated date conversion with a shared helper and correctly handle half-hour/quarter-hour offsets and DST-sensitive dates. Keep calendar scheduling distinct from when backend processing starts.

Test rejected creatives-only schedules with zero Meta writes, valid scheduled ad-set creation, immediate mode, invalid/past dates, and fractional offsets. Verify the relevant UI controls in a browser. Commit this part and report its supported scheduling contract.
```

## F02 — Duplicate prevention

Evidence: two clicks produced two browser job requests; identical backend submissions returned distinct job IDs. Each job can also delete media used by another job sharing the upload.

Acceptance: one launch intent produces one job even with concurrent requests or a lost response; UI and server both enforce this.

```text
Implement F02 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Add a synchronous in-flight submission guard and visible submitting/error state to single and bulk launch. Block launch while a replacement upload is pending so the old upload cannot launch accidentally. Prevent out-of-order upload responses from replacing the latest selection.

Add an idempotency key for each explicit launch intent. Keep the same key when retrying an ambiguous submission; generate a new one only for a genuinely new intent. Bind the key to a canonical validated payload and selected-asset snapshot. The backend must atomically return the existing job for matching duplicates, reject key/payload conflicts, and prevent concurrent jobs from consuming the same upload. Ensure registration and starting a worker cannot race. Do not solve this with a disabled button alone.

Test double clicks, concurrent identical requests, changed payload with the same key, response loss/retry, upload replacement and separate legitimate jobs. Do not automatically rerun an errored job. If storage is process-local, document that restart-safe idempotency depends on F09B. Commit this part.
```

## F03 — Monitoring versus execution status

Evidence: a polling failure changed a running job to `error`, stopped normal monitoring and enabled Launch again. Bulk processing can then advance while the server job continues.

Acceptance: temporary connectivity trouble never falsely declares a job terminal or submits a replacement.

```text
Implement F03 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Separate job execution status from monitoring/connection status. A failed poll must preserve the job ID and last known execution state, show that monitoring is interrupted, and retry with bounded backoff or offer an explicit reconnect action. Terminal failure/success must come from the backend. Keep launch/retry actions blocked while the previous job may still be running. Bulk processing must not start the next card until the previous job is known terminal.

Replace overlapping setInterval polling with one in-flight request at a time. Handle stale responses, component teardown, log ordering and duplicate log entries. Give initial submission failures a visible error, preserving F02's idempotency behavior for ambiguous outcomes. Treat unknown/expired job responses distinctly from transient network errors.

Test slow and overlapping responses, offline/online transitions, one transient failure followed by recovery, terminal backend failure, and bulk ordering. Confirm no extra launch requests occur during reconnect. Commit this part.
```

## F04 — Strict launch request validation

Evidence: `dailyBudget: 0` became 8000 minor units in the reviewed configuration. An existing-campaign request with no campaign ID was accepted and can fall through to the new-campaign branch.

Acceptance: invalid requests produce useful client errors and no Meta writes; false/zero values never select an unintended default.

```text
Implement F04 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Preserve F01's scheduling contract and F02's idempotency semantics.

Replace permissive launch dictionaries with explicit validated request models and mode-specific checks. Validate launch/add-mode enums, required existing campaign/ad-set IDs, supported country, HTTP(S) product URL, finite positive budget where applicable, schedule fields, preset shape and booleans. Resolve defaults only when a field is absent, not when it is zero or false. Reject invalid combinations instead of silently creating a new campaign. Align backend minor-unit conversion with the currently supported account currency assumptions; flag unsupported currency precision rather than guessing.

Expose field-specific errors in both launch screens and keep user input after failures. Mirror safety-critical checks in the CLI/launch-core entry path, which can bypass HTTP validation. Do not rely on an input's min attribute or JavaScript truthiness.

Test zero/negative/nonfinite budgets, missing IDs, unsupported modes, malformed URLs, false booleans, valid modes and unchanged default behavior for genuinely omitted fields. Assert no Meta writes for invalid requests. Commit this part.
```

## F05 — Campaign and ad-set targeting

Evidence: existing-campaign processing uses submitted target IDs without ownership reads. Ad-set fetches in the UI are not protected against stale responses.

Acceptance: the selected campaign and every target ad set are verified against the selected account before writing.

```text
Implement F05 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Before uploading media or creating advertising objects, validate that the existing campaign belongs to the captured ad account and every selected ad set belongs to that campaign/account. Deduplicate target IDs. Fail closed with a useful error when relationships cannot be verified. Never substitute a different campaign or account silently.

Cancel or ignore stale campaign/ad-set/preview responses in the UI. Changing campaign, launch mode or saved account must clear or revalidate dependent selections; late responses must not restore old ones. Show actionable fetch errors rather than treating every failure as an empty list. Ensure the actual launch uses the same captured asset context that was validated.

Test wrong-account campaign, wrong-campaign ad set, unavailable assets, duplicate IDs, valid targets and reversed response ordering. Assert zero Meta writes for invalid targets. Commit this part and document how changing saved settings affects an open launch form.
```

## F06 — Partial outcomes and failure recovery

Evidence: `_run_job` deletes upload media in its finally block even after failure. The result is replaced by a generic error without a structured record of completed operations.

Acceptance: users can identify what already exists and make an informed recovery decision without blindly repeating the entire launch.

```text
Implement F06 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Preserve F02 upload ownership and F03 monitoring behavior.

Return structured partial outcomes on failure, including completed campaign/ad-set/creative/ad/video IDs and the failing step, without secrets. Record object IDs immediately after confirmed successful operations rather than only at the end. Preserve failed-job media for a configurable bounded retention period. Cleanup must exclude pending/running jobs and uploads still owned by another job; prune expired retained failures safely.

Show partial completion and recovery guidance in single/bulk UI. Distinguish a definite rejection from an ambiguous network timeout where Meta may have accepted the operation. Do not add automatic full-job retries, delete live Meta objects, or claim exactly-once external writes. Full durable resume belongs to F09B; keep the immediate implementation honest about restart limitations.

Test failure after one successful ad, ambiguous upload failure, media retention, expiry cleanup, active-job protection and successful cleanup. Verify users cannot mistake partial completion for zero work done. Commit this part.
```

## F07 — Authentication and ownership (hosting Phase 2)

Evidence: launch, upload, job polling and asset-selection endpoints have no caller authentication or ownership enforcement.

Acceptance: all privileged operations require an authorized identity; a valid object ID alone grants no access.

```text
Implement F07 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions and the hosting readiness report. This is a hosting Phase 2 task, not PWA-foundation scope.

Build invite-only Supabase authentication and workspace membership enforcement for the API and browser. Define upload/job/preset/selection ownership and roles. Verify tokens server-side using the appropriate current Supabase signing/JWKS mechanism; never trust a client-supplied workspace ID alone. Protect media, job status/logs, discovery and settings mutation as well as launch creation. Add corresponding database/Storage policies and tests. Keep service-role keys and Meta credentials server-only. Do not confuse CORS restrictions or Supabase login with Meta permissions.

If a local-development bypass is needed, make it explicit, loopback-scoped and rejected in hosted configuration. Coordinate F02/F09B identity and idempotency scope. Do not publish an API until access controls are verified, and do not provision external resources without separate authorization.

Test anonymous, expired/invalid token, non-member, cross-workspace object IDs, read-only member and authorized operator cases. Confirm no secret appears in client output. Commit this part and document any remaining provisioning steps.
```

## F08 — Upload roots and folder semantics

Evidence: a multipart upload containing CampaignA and CampaignB stored both but selected only CampaignA as the processing root. The parser's early shape inference can confuse campaign containers with carousel structures.

Acceptance: every accepted media file appears exactly once in the intended preview/launch structure, or the input is explicitly rejected.

```text
Implement F08 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Define and document supported folder/file/ZIP layouts. Remove first-file root guessing that silently ignores later roots. Represent upload roots explicitly and make preview and launch use the same interpretation. Handle a campaign folder, a container of multiple campaigns, a single ad-set folder, carousel subfolders and flat creative selections without ambiguous silent reinterpretation. If a layout cannot be inferred safely, require clarification in the UI or reject it before launch.

Preserve original relative paths, reject duplicate/colliding paths instead of overwriting files, and handle hidden/metadata files consistently. Do not mix temporary directory names into user-visible campaign names unexpectedly.

Test two top-level campaigns, ordinary campaign/ad-set layouts, carousels, flat files, duplicate basenames, hidden files, ZIP versus multipart parity and unsupported nesting. Assert preview counts/structure match the operations that would be launched. Commit this part.
```

## F09A — Frontend job and draft recovery

Evidence: browser navigation away from Launch and back discarded the job identity. Backend work could continue unseen.

Acceptance: reopening a page restores monitoring without submitting another launch.

```text
Implement F09A from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Build on F02 and F03.

Persist enough non-secret state to recover active job IDs, idempotency intents, bulk progress and unfinished drafts across route changes and reloads. Scope persisted state to the relevant account/workspace context and handle malformed/old data. On recovery, reconnect to the existing backend job rather than creating one. If the current in-memory backend has restarted, show an explicit unknown-job/reconciliation state instead of claiming success or offering a blind rerun.

Do not imply a browser File object survives reload. Mark interrupted local uploads as requiring resumption/reselection until cloud resumable upload support exists. Avoid storing Meta tokens or source media in localStorage. Keep a clear distinction between remembered UI state and durable server execution.

Test navigation/reload during running jobs, bulk recovery, backend restart/404, context changes, corrupted stored state and no duplicate POSTs during restoration. Commit this part.
```

## F09B — Durable jobs, uploads and worker (hosting Phase 3)

Evidence: process-local dictionaries and daemon threads cannot survive API restarts or support independent API workers reliably.

Acceptance: accepted jobs and upload records survive API restarts; execution is owned by a durable worker with recoverable state.

```text
Implement F09B from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions and the hosting readiness report. Coordinate with the fixes branch before changing backend launch contracts. This task depends on the agreed authentication/data foundation.

Replace in-memory upload/job registries with persistent owned records and a durable queue. Separate HTTP API and worker execution. Implement atomic claims, lease/heartbeat handling, cancellation semantics, bounded retries and ordered persistent job events. Make F02 idempotency survive process restarts and scope it to the authenticated workspace. Preserve immutable asset/input snapshots and F06 partial outcomes.

Use private object storage with verified complete uploads, relative-path metadata and safe worker scratch directories. Retention must respect queued/running jobs. Persist confirmed Meta object IDs, reconcile uncertain writes and require operator review where safe replay cannot be established; do not claim globally exactly-once delivery. Restore jobs from the frontend without rerunning them.

Test API restart, worker crash before/after external success, lease expiry, duplicate delivery, concurrent workers, ownership failures and cleanup. Use a fake Meta service. Do not silently retry the whole campaign or deploy to production. Commit this part with migrations and a recovery runbook.
```

## F10 — Upload and resource bounds

Evidence: raw file uploads have no total byte cap; ZIP size is checked after saving and expansion has no total-byte limit. Every job starts another thread without a concurrency bound.

Acceptance: unsafe input is rejected early, disk use is bounded and accepted jobs do not exhaust resources.

```text
Implement F10 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Coordinate folder semantics with F08 and job/media ownership with F02/F06.

Add configurable per-file and aggregate upload limits enforced while bytes are read/written, accounting for framework multipart parsing/spooling as well as the application copy loop. Check archive metadata and enforce actual expanded bytes, file count, paths and supported types during extraction; do not trust declared sizes alone. Reject empty and colliding paths. Clean rejected partial uploads reliably. Avoid blocking the async event loop with large synchronous extraction/copy work.

Bound concurrent uploads and launch execution; provide explicit busy/queued responses without silently dropping work. Keep the local implementation compatible with the later durable queue. Preserve media used by active jobs and define limits in .env.example/docs. Do not disable limits to accommodate a test file.

Test just-under/over boundaries, aggregate overflow, compressed expansion, traversal, duplicates, interrupted uploads, active-job cleanup protection and concurrency saturation. Use small synthetic fixtures rather than large disk allocations. Commit this part.
```

## F11 — Preflight validation before spending or creating objects

Evidence: image asset-feed creatives require Instagram in the current implementation even though Settings allows no Instagram. This incompatibility is discovered inside creative processing after parent objects may exist.

Acceptance: predictable invalid launch combinations fail before the first Meta write.

```text
Implement F11 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Reuse F04/F05 validators instead of creating inconsistent copies.

Add a shared preflight stage that inspects parsed media, resolved preset text, selected identities and launch mode before campaign/ad-set/media creation. Check the current implementation's Instagram requirement for image asset-feed text variations, unsupported/empty media, carousel requirements, variable resolution and text-variant limits. Report exactly which files/configuration need correction. Do not silently drop text variants or change the chosen identity to make validation pass.

Make preview/UI expose actionable preflight failures, and invoke the same checks for HTTP jobs and CLI launches. Keep uncertain remote/format checks separate from guarantees that can actually be made locally. Do not promise that local preflight guarantees Meta acceptance.

Test no-Instagram + image variations, valid single-text images, supported videos, invalid carousels, unknown variables and empty effective uploads. Assert zero Meta writes for predictable invalid configurations. Commit this part.
```

## F12 — Secret-safe errors and logs

Evidence: the launch Meta client uses access tokens in GET query parameters and forwards raw request/response failures. Job errors and logs are then returned to the browser; discovery already uses safer patterns.

Acceptance: useful diagnostics remain available without credentials in application-visible errors, logs or stored job records.

```text
Implement F12 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions.

Centralize safe Meta/network error handling for the launch client, matching the safety of discovery while preserving useful status/error codes and actionable messages. Prefer Authorization headers where supported and avoid token-bearing URLs. Sanitize nested connection errors, upstream responses and traceback chains before recording or returning them. Apply coverage to uploads, thumbnail polling, image/video creative paths, CLI output and HTTP job logs. Keep timeout, permission, rate-limit and definite validation failures distinguishable.

Do not print real credentials to demonstrate redaction. Use synthetic sentinel secrets inside mocked request URLs, bodies, headers and exception chains, and assert none reach returned errors/logs/results. Preserve the existing video-specific timeout and avoid unsafe automatic retries. Include Meta trace identifiers when safe and available. Commit this part and document the diagnostic fields retained.
```

## F13 — Reproducible builds and dependencies

Evidence: `package-lock.json` is ignored, and there is no pinned Python runtime dependency specification. Coordinate this task with the hosting chat to avoid conflicting Docker/dependency changes.

Acceptance: clean installs resolve a reviewed dependency set and run the existing app/tests consistently.

```text
Implement F13 from docs/fixes-review-and-implementation-prompts.md and follow its shared instructions. Confirm ownership with the hosting/PWA worktree first; if it already implemented dependency packaging, review and integrate that work rather than duplicating it.

Track the appropriate npm lockfile and document/use npm ci for reproducible installs. Separate Python runtime and test dependencies using a maintainable pinned/locked approach. Determine supported Node and Python versions from actual build/runtime behavior. Exclude local environments, secrets, generated assets and media from source control. Add CI for a clean frontend install, TypeScript/build checks and mocked backend tests. Make any lint command genuinely runnable or clearly document its removal/replacement.

Do not perform unrelated major framework upgrades or copy the developer's entire installed environment into requirements. Review new/transitive dependency changes, demonstrate a clean supported install, and document any unavailable platform checks. Coordinate the resulting container build instructions with hosting Phase 1. Commit this part.
```

## Completion and integration checklist

For each task, record its commit, changed contracts, tests run and unresolved limitations. A useful completion record is:

```text
Task ID:
Commit:
Behavior before / after:
Validation performed:
Known limitations:
Follow-on task dependencies:
```

After the fixes are combined, test complete workflows with a fake Meta API: new campaign, scheduled new ad sets, existing-campaign creatives, existing-campaign new ad sets, partial failure, reconnect, duplicate submission, single/multiple upload roots and bulk processing. Include the real UI in this validation. Unit tests alone missed several reviewed defects.

Review live-launch authorization separately. Do not use an integration test run as implicit permission to publish real campaigns or delete remote objects.

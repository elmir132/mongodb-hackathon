# Continuation audit — September 26, 2026

This is a verification record, not a replacement specification. Scope remains in
[proposal.md](proposal.md), [demo-flow.md](demo-flow.md), and [decisions.md](decisions.md).
The user requested a fresh audit after context compaction. No application source
was changed in this audit.

## Reconstructed scope and repository state

The pasted conversation authorized three improvements: explicit scoped authority
learning beyond Engineering, validated model extraction, and semantic conflict
checks in ordinary chat, plus latency reduction. Fact embeddings, event streaming,
and a visualization redesign were deferred.

Commit `2643a5c` already contains the main implementation. At audit start, 15 files
were modified, totaling 201 additions and 68 deletions relative to that commit:

- Documentation: `AGENTS.md`, `docs/decisions.md`, `docs/demo-flow.md`, `docs/proposal.md`.
- Extraction/response: `server/memory-analysis.mjs`, `server/model-context.mjs`,
  `server/model-response.mjs`, `server/providers.mjs`.
- Frontend orchestration: `src/journey.jsx`, `src/memory-review.js`, `src/memory.js`.
- Tests/verification: `src/memory-review.test.js`, `src/model-context.test.js`,
  `scripts/check_memory_review.mjs`.
- Backend diagnostics: `backend/app/main.py`.

The transcript does not identify the exact compaction boundary for every edit.
Committed versus uncommitted is a reviewable boundary, not proof of when each
change was made. There is no reason to discard all pending changes: they include
useful fixes for date years, incompatible applicability periods, and decisions
inside multi-conflict replies.

## Implemented and inspected

| Requested work | Current implementation | Verification in this audit |
| --- | --- | --- |
| Generalize authority learning | Explicit unchecked opt-in for recorded sources; project/domain/attribute scope; generic scope narrows to subject; multiple lessons and policy versions retained | Backend tests pass. Live Engineering launch lesson and Marketing finance lesson both persisted; finance lesson reused for a different budget subject |
| Validated extraction | One real model response proposes date, owner, budget, and status claims; exact quotes, source references, IDs, values and compatibility checked before persistence | Launch and budget extraction worked live; an intermittent empty analysis and a date-validation defect remain |
| Semantic conflict review | Relevant typed evidence groups flow through the existing Python engine and Danny's retrieval; multiple conflicts queue independent answers | Launch and budget conflicts worked live; multi-conflict behavior covered by automated fixtures, not newly exercised in the browser |
| Lower latency | One model call for review plus extraction; shorter output; cached Voyage client; narrow saved-human-answer lookup bypasses generation | Launch/reuse calls used one model request; saved launch lookup used zero |

The subagent in the prior conversation was a coding collaborator. The application
does **not** run a separate autonomous runtime subagent. Semantic analysis is part
of the existing response call. Context is bounded to 80 stored facts and eight new
claims; this is not arbitrary-document or arbitrary-history recall.

## Fresh checks

- `npm test`: **99 passed**.
- `.venv/bin/python -m pytest tests resolution-engine -q`: **57 passed**.
- `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q`: **13 passed**.
- `npm run build`: passed.
- `git diff --check`: passed before adding this record.

The backend API tests require the backend import path; a first invocation without
`PYTHONPATH=backend` failed collection, then the corrected command passed.

The first live attempt lost its frontend connection; Vite was no longer listening.
It was restarted with `npm run dev`. The cause of that process exit was not
established. Backend and frontend were available during the subsequent checks.

The real acceptance script reached its second-domain assertion and failed at
`scripts/check_memory_review.mjs:51`. A targeted retry continued the finance path
successfully. The complete script therefore did **not** pass uninterrupted in this
audit, even though its major paths were exercised across the initial run and retry.

Isolated Atlas QA workspace:
`workspace-qa-semantic-270f68e7-f58c-4688-8e09-23fbff13ff00`.
Existing demo workspaces were not reset. A fresh Atlas load after the retry
confirmed two lessons and policy v3. Backend restart persistence was not repeated.

| Operation | Recorded turn elapsed | Model elapsed |
| --- | ---: | ---: |
| Initial launch memo review | 7.18 s | 5.99 s |
| Engineering correction and readiness check | 2.28 s | No model call |
| Saved launch-date lookup | 0.45 s | No model call |
| Next-release review and precedent reuse | 8.14 s | 6.27 s |
| Budget claim, failed extraction attempt | 4.70 s | 4.09 s |
| Budget claim, successful retry | 6.52 s | 4.82 s |
| Marketing finance correction and readiness check | 2.79 s | No model call |
| Different budget subject using finance lesson | 7.87 s | 5.73 s |

These are individual observations, not latency guarantees. `turn.timing.elapsedMs`
is captured before the final trace/cache persistence in `src/memory.js`; it is not
the complete submit-to-visible-response duration. Future rehearsal should measure
that full duration. Browser rendering and the narrated 60-second demo were not
rechecked in this audit.

## Confirmed gaps, in repair order

1. **Silent extraction omission (high priority).** With a stored acquisition
   budget of $15,000, the explicit prompt “The acquisition budget is $20,000.
   Check this against project memory.” produced `status: validated` with empty
   claims, relations, and relevant IDs, and zero rejections. The reply was “No saved
   answer is available.” A model-only repeat and the subsequent integrated retry
   extracted the claim correctly. This establishes inconsistent behavior, not a
   deterministic validator rejection. Inspect the request/output contract and
   distinguish structurally valid output from a complete successful review;
   do not invent claims to compensate for missing analysis. Add a regression
   scenario and repeat the real acceptance run.

2. **Requested output disappears when a conflict exists (high priority).**
   `src/memory.js:248` replaces all model prose with review notes whenever
   `conflict` or `savedReview` is true, even for translations and summaries.
   Reproduction: ask to translate an attached “The budget is $15,000.” into French
   against stored $20,000 evidence. A fixture model returns “Le budget est de
   15 000 $.” plus validated conflict analysis; the final reply contains only the
   memory decision and drops the translation. Preserve the actual requested task
   while keeping engine authority separate. Do not restore contradictory
   provisional decision prose as a blanket fix.

3. **Impossible written dates pass typed validation (medium priority).**
   `server/memory-analysis.mjs:90` accepts an exact phrase before validating a
   written calendar date. “The launch is February 31, 2027.” with that literal
   date value is accepted as a validated date claim. ISO dates are checked, but
   month-name dates bypass the check. Retain the original source while rejecting
   or explicitly flagging the invalid typed date; cover leap years and valid
   written dates as well.

4. **Final acceptance and presentation checks remain.** After focused fixes,
   run the full real-model script without relying on a retry, verify multiple
   conflict questions and saved decisions in the browser, recheck scope isolation
   and persistence after backend restart, and rehearse the complete presentation.
   Model variability cannot be ruled out by one successful run. API-key providers
   were not exercised here.

Do not expand into fact embeddings, streaming, or another retrieval implementation
as part of this recovery. Preserve the existing engine, correction endpoint,
scoped lessons, recorded replay, and retained source evidence.

## Recovery implementation and verification

The user authorized the repairs after the audit. The three confirmed defects
have been addressed, together with issues exposed by fresh integration checks:

- The Codex CLI now uses a strict response schema. Its current instruction and
  transformation source references are explicit, separate from prior conversation.
  A bounded omission check flags concrete assertions absent from accepted claims;
  it never manufactures replacement facts. Partial checks retain only accepted
  claims and visibly identify the incomplete check. This does not guarantee
  comprehensive extraction of arbitrary prose.
- Source translations, summaries and rewrites keep their requested output, labeled
  as supplied-source content, alongside the authoritative engine/human result.
  A live test caught the model translating the instruction itself; explicit
  output-source references fixed that request ambiguity.
- Written calendar dates and ISO dates are checked before acceptance, including
  impossible month days, leap years and document-provided year context.
- Browser QA uncovered a separate multi-conflict rendering defect: the composer
  searched only top-level turns. It now resolves synthetic conflict IDs too.
- Upstream HTTP 429 errors now produce a rate-limit/retry message without raw
  provider details. Some early acceptance runs encountered Voyage rate limits.
  `CHRONICLE_QA_PACE_MS=22000` spaces test operations only; reported `totalMs`
  excludes this QA pause and includes final trace persistence. App requests still
  use one model call and have no artificial delay or automatic model retry.

Fresh automated validation after the repairs: **107 JavaScript tests, 57
retrieval/engine/backend tests, and 14 backend API tests passed**. The production
build and whitespace checks passed.

Browser QA used a separate origin on port 5174, leaving the existing demo workspace
on port 5173 untouched. Confirmed: two conflicts from ordinary chat, automatic
question rendering, deferral/reopening, independent saved answers including
leave-unresolved, Maya attribution, cached draft restoration, exactly one combined
replay after both answers, and replay returning to the working terminal. A real
uploaded memo translated to French with its $20,000 source claim while the separate
saved-answer section retained the human-selected $15,000. It did not reopen the
already answered conflict or show a new decision-save badge for the translation.

After backend restart, a fresh API load of
`workspace-qa-semantic-3b29886f-03dc-4f25-b164-750cc1a400f4` confirmed policy v3,
two retained lessons, two saved human decisions, and the applied finance precedent
on the different retention-budget subject.

Request separation follows the
[official prompt-engineering guidance](https://developers.openai.com/api/docs/guides/prompt-engineering).
The installed Codex CLI's `exec --help` confirmed its `--output-schema` capability.
API-key providers remain unverified, and the narrated one-minute presentation
still requires human rehearsal.

### Final live acceptance evidence

The extended acceptance script completed all assertions in isolated workspace
`workspace-qa-semantic-35de66bf-ee86-4358-b075-07c328ea91e4` with QA pacing enabled.
The launch lesson was reused on the next release; the separate finance lesson
was reused on retention. Policy v3 and both lessons were present on a fresh load.
For the travel translation, successful Voyage and Atlas receipts returned both
lessons as candidates, while the engine applied neither and requested a human
choice. Thus scope isolation was checked against real retrieved candidates.

| Action | Full operation time, including final persistence |
| --- | ---: |
| Launch review | 9.58 s |
| Engineering correction and retrieval readiness | 3.47 s |
| Saved launch answer (zero model calls) | 0.68 s |
| Next release using launch lesson | 8.38 s |
| Acquisition budget review | 9.27 s |
| Marketing correction and retrieval readiness | 4.84 s |
| Retention budget using finance lesson | 9.04 s |
| Travel translation with out-of-scope lessons | 8.96 s |
| Travel summary during a recorded Voyage failure | 9.11 s |
| Impossible-date rejection | 9.36 s |

Receipt inspection caught a Voyage failure on the summary step despite the
successful output assertions. A targeted repeat (`turn-eab4d644`) then passed
with successful Voyage and Atlas calls, no failed receipt, both lessons returned
as candidates, neither applied, and the requested summary preserved beside the
human-choice question. That operation took 10.15 s. The invalid-date step saved
no extracted fact and visibly reported unavailable memory checking.

These are individual backend/orchestration observations, not browser-rendering
measurements or latency guarantees. QA pacing did not eliminate every upstream
failure. A quota-safe, narrated 60-second presentation has not been established
by this run; the successful checks should not be described as a failure-free
unpaced rehearsal.


## Exact three-prompt compatibility check — September 26

Tested the user's pasted command sequence through the real local model and
Atlas/Voyage bridge in isolated workspace
`workspace-qa-exact-2a272f3f-c399-4d64-9461-af011ebdb918`.
This exercised connected orchestration directly, not browser interaction; the
normal UI offers a conflict question after the first response.

| Prompt | Observed result |
| --- | --- |
| Marketing says the launch is Friday. Engineering says the launch is Monday. | Both accepted claims inherit Maya / Marketing from the composer. The engine sees equal-authority Friday and Monday claims and abstains; it does not select Friday. |
| Engineering owns launch readiness for this project. | Saved as an owner fact, not a human correction. No precedent; policy remains v1. |
| Marketing says the next release is Wednesday. Engineering says Thursday. | Only Wednesday is accepted. The shorthand Thursday claim is rejected; the undated weekday does not compare with the seeded calendar-specific Engineering evidence. No conflict or applied precedent is recorded. |

A fresh backend load retained policy v1, three turns, and zero lessons.
No service failures occurred in this sequence. The phrase-triggered correction
branch is limited to the older no-services path; the connected application uses
an explicit linked conflict answer and authority opt-in. Source attribution in
validated extraction comes from the composer/document contributor, not reported
speaker names inside prose. These are compatibility gaps relative to the pasted
guide, not evidence that its exact three commands currently work.

A separate real-service check used workspace
`workspace-qa-explicit-322f6915-53e4-42a4-974c-8b729395cb00` and the currently
supported flow:

1. Maya submits “The launch is Friday, October 2.” The stored Engineering
   readiness update provides the competing Monday evidence. Policy v1 selects
   Marketing / Friday provisionally (6.55 seconds).
2. Submit the linked conflict answer choosing the stored Engineering fact,
   `rememberAuthority: true`, and reason “Engineering owns launch readiness for
   this project.” This is the same payload as choosing Engineering, checking
   Remember authority, and submitting the question card. The backend selects
   Monday, stores precedent `prec-30dd97b1cc86`, advances policy to v2, and confirms
   retrieval readiness (2.54 seconds).
3. Maya submits “The next release is Wednesday, October 14.” Atlas Vector Search
   returns that exact precedent with score 0.7469745874404907. The engine selects
   Engineering / Thursday, records `applied_precedent_id` matching the new lesson,
   and requires no second human answer (8.18 seconds).

A fresh backend load confirms policy v2 and that lesson. The relevant Voyage,
search, readiness, and engine receipts succeeded. These times describe individual
operations in this check, not a latency guarantee or a timed browser rehearsal.
The UI's explanation surface is Replay internals → Resolution engine; there is
no separate button literally named “Why this decision?”. This audit changed no
runtime behavior and does not reinstate the older two-speaker prompt as the
canonical natural-memo demonstration.


## Reported-source continuation — implemented and checked

The stopped follow-up had not changed source attribution, omission reporting, or
authority-statement handling. The existing uncommitted replay refinements were
preserved. This continuation implemented all three agreed changes and updated
the canonical docs under decision D49.

- Explicit reporting sentences keep the claimant department and a separate
  `submittedBy` identity. No fictional named claimant is inferred. Backend save
  validation checks the reporting quote and original submitter.
- Adjacent date shorthand keeps its exact `contextQuote`; missing or rejected
  assertions are visible with a request for clarification.
- An unambiguous ownership statement reopens recorded evidence in the active
  chat with its wording in Add context. Neither a claim nor the authority
  checkbox is selected automatically. An explicit answer is still required.
  The original review remains in the completed linked replay.

Connected acceptance (`CHRONICLE_QA_PACE_MS=25000 node scripts/check_reported_sources.mjs`):

| Action | Observed result | Request duration |
| --- | --- | --- |
| Marketing says launch Friday; Engineering says launch Monday | Two distinct reported sources; Friday provisionally selected under policy v1 | 6814 ms |
| Engineering owns launch readiness for this project | Confirmation requested, context retained, no model call or policy change | 903 ms |
| Explicit Monday answer with Remember authority checked | Monday saved, policy v2, indexed precedent ready | 1919 ms |
| Marketing says next release Wednesday; Engineering says Thursday | Both claims validated; Thursday selected using that same precedent; no second question | 7863 ms |

Workspace: `workspace-qa-reported-b3a5ee68-c208-4d4d-8172-f8ec77577885`. Applied precedent: `prec-a6dc3fc37935`.
Atlas reload preserved the original Friday result, policy v2 and the precedent.
One earlier unpaced run recorded a failed Voyage query and used policy v2 without
a precedent citation; that run did not pass the reuse assertion. QA pacing was
outside measured request durations and was not added to application behavior.
These timings are observations, not guarantees.

Validation: 117 JavaScript tests, 58 Python tests, production build, and diff
whitespace checks passed. The browser showed the original reporting passages,
separate submitter labels, prefilled context, no preselected claim, and an
unchecked Remember authority option.
The final browser save also passed: selecting Monday with Remember authority
unchecked saved Maya's answer, kept policy v1 with no lesson, restored the
composer, and exposed exactly one Replay internals action. A development hot
reload interrupted an earlier QA save while the UI code was being edited; the
final interaction was rerun against the stable build in a fresh isolated QA
workspace. The user's selected workspace was not changed.

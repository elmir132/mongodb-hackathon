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

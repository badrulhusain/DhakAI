# Phase 5 implementation matrix

Status is based on an executed check, not source-file presence. Last local audit: 2026-09-20.

| Capability | Status | Evidence or limitation |
| --- | --- | --- |
| Frontend startup | Working and verified | Next.js production build and Playwright dashboard load pass. |
| Backend startup and HTTP health | Working and verified | Integration test calls `GET /health`; the supervisor waits for it before starting Next.js. |
| Terminal WebSocket | Working and verified | PTY/WebSocket integration and browser reconnect/replay checks pass; buffers and slow clients are bounded. |
| Demo runner | Working and verified | Offline runner pauses for input, updates validation and its test, runs `node --test`, and exits naturally. |
| Codex runner | Implemented; live task unverified | Executable/version check is safe and explicit. Authentication and a paid/uncontrolled coding run are intentionally not health-polled. |
| Git worktree creation | Working and verified | Disposable-repository tests verify distinct branches/worktrees and a clean base. |
| Agent start/stop lifecycle | Working and verified | Natural exit, SIGTERM/SIGKILL fallback, duplicate launch, failed launch cleanup, restore, and shutdown are tested. |
| Diff review | Working and verified | Tests cover committed, staged, unstaged, untracked, deleted, renamed, binary, symlink, oversized, and stale content. |
| Explanation persistence and paste-free inputs | Working and verified | Local persistence, stale-version invalidation, paste/drop blocking, and browser refresh restoration are tested. |
| Groq quiz generation | Working and verified | Mocked schema/error coverage passes; one explicit structured live request validated with `openai/gpt-oss-120b`. Normal health polling makes no paid request. |
| Server-side quiz grading and answer privacy | Working and verified | Browser payload excludes keys; retries, 3/3 pass, stale invalidation, and idempotent submissions are tested. |
| Supabase persistence | Working and verified | Required tables and private bucket were live-checked; a UUID-scoped temporary row and private PNG round trip succeeded and were removed. No fallback occurs in Supabase mode. |
| Drawing save/restore | Working and verified | Draft restore, optimistic revisions, stale history, PNG failure preservation, and private preview reads are tested. |
| Points and badges | Working and verified | Immutable transaction uniqueness, total calculation, and badge idempotency are tested. |
| Merge eligibility and safe merge | Working and verified | Exact reviewed tree, dirty/stale base, in-progress Git state, conflicts, concurrency, and retry reconciliation are tested. |
| Post-merge verification | Working and verified | Commit/tree/base cleanliness checks run after merge; optional validation command failures remain visible. |
| Demo reset | Working and verified by inspection and repeatable command | Targets exact managed paths and demo IDs; unexpected dirty worktrees/base checkouts are preserved and reported. |
| Live external services | Working and verified for the configured environment | Supabase and one Groq request passed on 2026-09-20. Availability remains environment-specific; local/mock/demo success is never reported as live success. |

## Test boundaries

- Unit/integration tests use disposable Git repositories and mocked providers.
- Playwright uses ports 3100/4100, a temporary repository, and a temporary application-data directory.
- Live Supabase/Groq checks are opt-in, remove only their UUID-named temporary records/objects, and never print prompts, code, keys, or credentials.
- This is a loopback, trusted, single-user hackathon tool—not a secure multi-user production service.

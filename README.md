# Agent Classroom

Agent Classroom is a local educational coding-agent dashboard. It runs one Demo or Codex CLI agent in an isolated Git branch and worktree, streams its real PTY to the browser, captures an immutable review, asks the learner to explain the change, creates a three-question quiz, and merges only the reviewed snapshot after every server-side gate passes.

The current Phase 3 flow is:

```text
Run → Review → Explain → Quiz → Merge → Result
```

## Requirements

- Node.js 22+ and npm 10+
- Git with worktree support
- macOS or Linux; process-group shutdown is POSIX-only
- Native build tools if `node-pty` cannot use a prebuilt binary
- Google Chrome for the optional Playwright browser suite
- The Codex CLI and its existing local login only when using the Codex runner
- Supabase and Groq credentials only when selecting those external integrations

## Install and run

```sh
npm install
cp .env.example .env
npm run demo:setup
npm run dev
```

Open <http://127.0.0.1:3000>. The one root command starts both the loopback backend and Next.js frontend. `npm run stop` stops only the supervisor recorded for this project after checking its PID, start identity, command, and project root. It refuses to stop while an agent is active. It never scans for or kills unrelated port owners.

For a production frontend:

```sh
npm run build
npm start
```

`npm run build` injects the backend URL derived from the root `.env`. Development, production, and Playwright use separate Next.js output directories (`.next-dev`, `.next`, and `.next-test`), so a build or test cannot invalidate the assets served by another mode.

### Backend-disconnection fix

The observed backend was alive and reachable, but an older production Next.js process was serving HTML whose asset hashes no longer matched the `.next` directory after later builds and tests replaced it. The browser aborted the missing JavaScript chunks, so the client never completed its API connection and displayed “Backend disconnected.” The fix separates each Next.js build directory, derives frontend/backend ports from one root environment, adds a real `GET /health`, and manages both services through a project-owned supervisor. No connected status is fabricated.

The dashboard reports four independent states: backend HTTP, terminal WebSocket, persistence, and quiz provider. Terminal reconnection uses exponential backoff capped at ten seconds. `/health` checks local server liveness; `/api/dependencies` separately checks storage and reports Groq configuration without making a model request.

## Configuration

The backend loads the project-root `.env`. Paths may be absolute or relative to this directory.

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `TARGET_REPO` | `.runtime/demo-repo` | Clean target Git repository root |
| `WORKTREE_ROOT` | `.runtime/worktrees` | Agent and merge worktrees; must be outside the target repo |
| `DATA_ROOT` | `.runtime/data` | Local durable learning records |
| `CODEX_EXECUTABLE` | `codex` | Executable name or absolute path; no arguments |
| `WEB_PORT` | `3000` | Frontend port |
| `PORT` | `4000` | Backend port |
| `ALLOWED_ORIGINS` | local port 3000 origins | Exact comma-separated browser origins |
| `STORAGE_MODE` | `local` | Explicitly choose `local` or `supabase` |
| `SUPABASE_URL` | unset | Supabase project URL, server-side only |
| `SUPABASE_SECRET_KEY` | unset | Supabase secret/service-role key, server-side only |
| `GROQ_API_KEY` | unset | Groq API key, server-side only |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Structured-output-capable Groq model |
| `MERGE_VALIDATION_EXECUTABLE` | unset | Optional server-owned command after a successful merge |
| `MERGE_VALIDATION_ARGS_JSON` | unset | JSON array of fixed arguments for that command |

Missing Supabase or Groq credentials do not block the local backend, terminal, Demo runner, local storage, or deterministic Demo quiz. Selecting `STORAGE_MODE=supabase` without working configuration fails startup clearly and never falls back to local files.

Secrets must stay in `.env`; the file is ignored by Git. Do not add `NEXT_PUBLIC_` versions of server credentials.

## Runners and review

`npm run demo:setup` creates a separate Git repository at `.runtime/demo-repo` without resetting an existing demo repository. The Demo runner makes one fixed greeting change and sends no data externally. The Codex adapter invokes the existing CLI directly, without a shell:

```text
codex --sandbox workspace-write --ask-for-approval on-request --no-alt-screen -- <task>
```

Every launch records the starting branch and commit and creates `classroom/agent-<uuid>` in a separate worktree. The target must have a commit, a named branch, and a clean checkout.

After the process exits, **Review changes** captures committed, staged, unstaged, deleted, renamed, mode-changed, and non-ignored untracked files relative to the recorded launch commit. The SHA-256 review version includes complete content hashes and modes. Displayed text is bounded, but fingerprinting is not truncated. Two matching scans protect against a moving worktree. Binary, symlink, oversized, special, nested-repository, submodule, and invalid-UTF-8 changes are reported and prevent completion.

The learner answers three explanation prompts. Drafts may be incomplete; completion requires at least 30 non-whitespace characters in every answer. Paste and text-drop are blocked only in those textareas as a learning prompt, not as secure cheating prevention. Every save recomputes the review version. New worktree content makes previous completion historical and requires review and explanation again.

## Persistence and Supabase

Local mode writes one private, atomically replaced `.runtime/data/learning-records.json`. It imports existing Phase 2 per-version explanation JSON instead of replacing it. It stores run metadata, review metadata, explanations, private quiz definitions, attempts, and merge operations. Repository files and terminal transcripts are never stored there.

Supabase mode uses `@supabase/supabase-js` only in the Node backend. Apply [the versioned migration](supabase/migrations/20260920000000_agent_classroom_phase3.sql) to the identified project, then configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` privately and set `STORAGE_MODE=supabase`. For a linked Supabase CLI project, the normal command is:

```sh
npx supabase db push
```

The migration enables RLS on every public table, grants no browser role access, and stores private answers and grading records behind the server secret. The Node API still validates every operation because a secret/service-role key bypasses RLS. Do not apply the migration to an unidentified project.

Run history is restored after a restart. A run that was previously creating, running, or stopping becomes `interrupted`; its old PTY is explicitly disconnected and its retained worktree must pass current review and merge checks. PTY output itself is only an in-memory 128 KiB replay buffer and is not restored.

## Quiz

A quiz is available only for an exited agent with nonempty supported changes and a completed explanation for that exact review version. Demo agents receive a labeled, deterministic **Demo quiz** and make no Groq request. Codex-run quizzes require Groq.

Before calling Groq, the server sends at most 100 KB of the reviewed before/after text plus file IDs and paths. It blocks secret-like paths such as `.env`, credentials, private keys, and npm/pypi credential files; it fails instead of silently omitting relevant files or truncating context. The system prompt treats repository text as untrusted data.

Groq must return strict structured JSON with exactly three questions in this order: behavior, implementation decision or condition, and edge case or test. Each question has four distinct options, one correct ID, an explanation, and evidence copied exactly from the immutable review. Zod checks structure, uniqueness, answer membership, and evidence. Requests have a bounded SDK timeout and one retry. Generated questions are a learning aid and may still be semantically imperfect.

The browser receives prompts, options, and evidence, but no correct IDs or explanations before submission. Grading uses the persisted private key in the backend. A pass requires 3/3. Attempts, feedback, retries, counts, and pass status are persisted; a repeated submission UUID is idempotent. A content change invalidates the current pass while retaining historical attempts.

## Merge gate and commit strategy

The merge button and direct API enforce the same checks:

- the agent process has exited;
- the current review is nonempty and fully supported;
- the explanation and 3/3 quiz pass match that review version;
- the worktree still has the exact reviewed contents;
- the expected base branch and launch commit remain checked out;
- the base checkout is clean and no merge, rebase, cherry-pick, or revert is active;
- the retained worktree exists and no merge record needs reconciliation.

A repository-wide in-process queue plus `.git/agent-classroom-merge.lock` serializes requests. Inside the lock, the backend rechecks state, writes a pending operation record, materializes only the immutable reviewed files into a temporary detached worktree, and stages only that controlled worktree. It creates one synthetic commit on the recorded start commit with agent, review-version, and operation trailers. This preserves the exact final reviewed tree while flattening intermediate agent commits into one auditable classroom commit; the original agent branch and worktree remain intact.

A second temporary worktree tests merge compatibility and verifies its tree equals the candidate. Immediately before mutation, all base, review, and quiz conditions are checked again. The base advances only with `git merge --ff-only`; no force update, reset, automatic rebase, conflict resolution, or history rewrite is used. Final HEAD, tree, status, and commit ancestry are verified.

Repeated merge requests return the same recorded result. If Git succeeds but persistence fails, the API returns `MERGE_RECORD_PENDING` with the real commit and reconciles from the commit trailers on retry instead of merging twice. An optional fixed server validation command runs after the merge; failure is reported and does not erase a completed merge.

## HTTP API

All browser routes require an exact configured `Origin`; the backend binds to `127.0.0.1`.

```text
GET  /health
GET  /api/dependencies
GET  /api/state
POST /api/agents
POST /api/agents/:agentId/stop
GET  /api/agents/:agentId/review
POST /api/agents/:agentId/review/refresh
GET  /api/agents/:agentId/review/files/:fileId?version=<sha256>
GET  /api/agents/:agentId/explanation?version=<sha256>
PUT  /api/agents/:agentId/explanation
GET  /api/agents/:agentId/quiz
POST /api/agents/:agentId/quiz
POST /api/agents/:agentId/quiz/attempts
GET  /api/agents/:agentId/merge/eligibility
GET  /api/agents/:agentId/merge
POST /api/agents/:agentId/merge
WS   /terminal/:agentId
```

Errors use stable codes including `DATABASE_UNAVAILABLE`, `GROQ_NOT_CONFIGURED`, `QUIZ_GENERATION_FAILED`, `REVIEW_OUTDATED`, `EXPLANATION_REQUIRED`, `QUIZ_NOT_PASSED`, `AGENT_RUNNING`, `DIRTY_BASE`, `STALE_BASE`, `MERGE_CONFLICT`, `WORKTREE_MISSING`, and `MERGE_RECORD_PENDING`. The browser separately represents unreachable HTTP and terminal connections.

## Verification

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
```

Backend tests use disposable repositories and mocked providers. They cover Phase 1 PTY/WebSocket lifecycle and isolation, Phase 2 immutable reviews and explanations, run restoration, valid and invalid quizzes, answer-key privacy, retry/pass and idempotency, stale reviews, direct merge rejection, dirty/stale/in-progress bases, exact-tree merge, concurrency, and post-Git persistence reconciliation. Playwright runs isolated services on ports 3100/4100 and covers the real browser terminal plus Review → Explain → Demo quiz → retry → pass → merge.

External checks are separate: Supabase requires configured project credentials and an applied migration; Groq requires its private API key and configured model. A successful mock or Demo test does not claim either external service is available.

## Security and remaining limits

This is a loopback, single-user local tool with one active agent. Exact Origin checks protect browser access but are not authentication against another local process. Worktrees isolate files but are not a security sandbox; the Codex CLI retains its own sandbox and approval controls. One backend instance should own a target repository and data store.

The server keeps only the 25 most recent runs in the dashboard. Historical run metadata and learning records persist, while review file contents are recaptured from retained worktrees and PTYs cannot be reattached after restart. Local JSON durability is suitable for development, not multi-process access. Supabase schema application and live availability remain operator-managed. AI quiz correctness is not guaranteed. A moved base is rejected as `STALE_BASE`. Agent worktrees and branches are intentionally retained for manual inspection and cleanup.

Phase 3 does not add drawing, rewards, accounts, teacher dashboards, simultaneous agents, or a Groq coding-agent runtime.

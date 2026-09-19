# Agent Classroom

A local educational coding-agent dashboard. Launch one agent in its own Git branch and worktree, watch a real PTY in the browser, send keyboard input, and stop it. Phase 1 includes a deterministic **scripted Demo** and an interactive **Codex CLI** adapter. Phase 2 adds immutable change reviews and versioned learner explanations.

## Prerequisites

- Node.js 22+ and npm 10+
- Git with worktree support
- macOS or Linux (POSIX process-group shutdown); Windows is not supported in this phase
- Native build tools if `node-pty` cannot use a prebuilt binary (Xcode Command Line Tools on macOS; Python, make, and a C++ compiler on Linux)
- Google Chrome for the optional automated browser test

## Install and run the demo

From the project root:

```sh
npm install
cp .env.example .env
npm run demo:setup
npm run dev
```

Open **http://127.0.0.1:3000**. Select Demo, click **Launch agent**, then click the terminal and press **Enter** at the prompt. The scripted demo appends an exclamation mark to `greet.js` in the agent worktree. It always performs this fixed task regardless of the task text. No credentials, API, or external service is used.

`demo:setup` copies `samples/demo` into `.runtime/demo-repo`, initializes a separate Git repository and commits the sample. It does not reset an existing demo repository. The install script restores executable permission on node-pty's bundled macOS spawn helper when necessary.

For a production frontend with the same local backend:

```sh
npm run build
npm start
```

The backend runs independently of Next.js on `127.0.0.1:4000`. Stop both services with Ctrl+C; the backend terminates its managed process first. `npm start` uses `tsx` to run the TypeScript backend, so retain development dependencies for this local tool.

## Server configuration

The backend reads `.env` at the project root. Paths can be absolute or relative to the project root.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TARGET_REPO` | `.runtime/demo-repo` | Target Git repository root |
| `WORKTREE_ROOT` | `.runtime/worktrees` | Directory for new agent worktrees; must be outside target repository |
| `CODEX_EXECUTABLE` | `codex` | Executable name on PATH or absolute executable path; no arguments |
| `PORT` | `4000` | Backend port |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:3000,http://localhost:3000` | Exact comma-separated allowed browser origins |

For a different backend address, put `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:4000` in `apps/web/.env.local` and restart/rebuild the frontend. The browser cannot choose executable paths or repository paths.

The target must have a commit, a named branch checked out, and no tracked or untracked changes. The app rejects dirty repositories without changing them. Branches use `classroom/agent-<uuid>`; worktrees use `<WORKTREE_ROOT>/agent-<uuid>`. The base branch and starting commit are recorded with every launch. The app never commits, merges, resets, or discards changes in the base checkout.

## Codex setup

Install the Codex CLI separately using the [official CLI documentation](https://developers.openai.com/codex/cli/), and complete its normal local login outside the dashboard. Verify `codex --help` works, or set `CODEX_EXECUTABLE` to the full CLI path. Set `TARGET_REPO` to a clean repository and `WORKTREE_ROOT` to a directory outside it, restart the backend, select Codex and enter a task.

The adapter invokes the executable directly, without a shell:

```text
codex --sandbox workspace-write --ask-for-approval on-request --no-alt-screen -- <task>
```

The task is one argument; the `--` separator prevents task text from becoming flags. Flags were checked against local CLI help and the [official command reference](https://developers.openai.com/codex/cli/reference/). Normal sandboxing, trust prompts, and human approvals remain available in the terminal. The app does not read, create, or expose credential files. It relies on the CLI's existing login. An interactive CLI can remain open after a task finishes; the dashboard reports completion when the CLI process exits. No authenticated Codex task was run during implementation.

## Verification

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
```

`npm test` creates disposable repositories in the OS temp directory. It checks HTTP and WebSocket streaming, terminal input, resize validation, reconnect replay, distinct branches/worktrees, duplicate launch rejection, natural completion, stop and forced shutdown, missing repository/executable, dirty and detached repositories, startup cleanup, nonzero exit, demo restrictions, origin rejection and bounded output. It does not use your configured target repository.

`npm run test:browser` starts isolated test services on ports 3100 and 4100 and uses installed Chrome via Playwright. It creates a disposable sample repository, clicks Launch, verifies streamed output, reloads to verify replay, sends Enter through xterm, observes completion, launches and stops another agent, and checks mobile overflow and browser exceptions. Screenshots are written to `test-results/`. Do not run this concurrently with another process using those test ports.

## Architecture and limits

- `apps/web`: Next.js / React dashboard, xterm.js and FitAddon, WebSocket reconnect and cleanup.
- `apps/server/src/agent-manager.ts`: single-agent reservation, lifecycle records, PTYs, stop escalation and retained output.
- `apps/server/src/git.ts`: argument-array Git calls and conservative worktree management.
- `apps/server/src/runners`: Demo / Codex runner interface and executable preflight.
- `apps/server/src/server.ts`: HTTP API and validated WebSocket transport.
- `packages/shared`: shared types and Zod input schemas.
- `scripts`: demo setup/runner and isolated browser-test backend.

Explicit states are `creating`, `running`, `stopping`, `stopped`, `completed`, and `failed`. Stop sends SIGTERM to the process group, escalating to SIGKILL after two seconds. Normal backend shutdown awaits managed exits. A hard OS kill or power loss cannot execute cleanup; inspect orphan processes manually if that happens. Deliberately detached child processes are outside the process-group guarantee.

Session history is in memory and limited to the 25 most recent sessions. Restarting the backend resets dashboard history; worktrees and branches remain on disk. The dashboard shows the latest session. All worktrees from successfully launched processes remain, including stopped and nonzero-exit sessions. Failed synchronous startups remove their new worktree only if it is clean and still at its original commit; changed worktrees remain. Review and remove retained worktrees manually with Git when you no longer need them.

Recent terminal replay is bounded to 128 Ki UTF-16 code units per session; old output is truncated and is not a full terminal snapshot. Each browser retains at most 3,000 scrollback lines. Slow WebSocket clients are disconnected above 256 KiB queued output and reconnect with recent replay. Connections are capped at eight; input is limited to 8,192 characters/message and 64 KiB/second, with frame and terminal-dimension limits.

This is a **local tool**, not a public service. The backend binds to loopback and requires an exact allowed Origin for all HTTP requests and WebSocket upgrades, including read requests. There is no arbitrary command API. Worktrees separate working files but **are not a security sandbox**. Codex uses its own sandbox/approval controls. Local processes can forge Origin headers; this is browser-origin protection, not authentication. Multiple browser tabs share the same one-agent session.

Diff review, quizzes, points, merge actions, accounts, teacher dashboards, and simultaneous agents are intentionally outside Phase 1.

## Phase 2: Review and Explain

After the demo completes (or an agent stops/fails), click **Review changes** on its card. The process status stays separate from explanation completion. The terminal stays available above the review panel.

1. Inspect the changed-file list and its colored, numbered diff. Switch between Split and Inline; narrow screens default to Inline.
2. Read the base branch, launch commit, file modes, changed-file count, and line totals. Refresh changes after editing the worktree externally.
3. Write answers to the three questions. **Save draft** accepts incomplete writing. **Mark explanation complete** requires at least 30 non-whitespace characters in each answer and fully supported, nonempty changes.
4. Reopen the panel to restore saved writing. Completion means the form is complete for that version; it is not a correctness or understanding verdict.

Paste and text drop are blocked only in the explanation textareas, with an accessible message. Typing, composition, selection, navigation, diff copying and terminal input remain available. This is a learning exercise, not secure cheating detection: the server validates answer lengths but cannot determine whether text was manually typed. Answers are never generated or prefilled with suggested responses; only the learner's saved writing is restored.

### Snapshot behavior

`review-git.ts` reads the recorded starting commit and captures the current final contents of tracked and non-ignored untracked files. This includes agent commits, staging, unstaged edits, deletions, mode changes, and exact-content renames. It does not rely on a diff against current HEAD. Renames with edited content may appear as delete/add in this MVP.

Inspection uses native Git executable/argument calls plus bounded filesystem reads. It does not change the real index, write Git objects, create commits, run clean filters, change branches, or alter working files. NUL-delimited paths preserve spaces, tabs, and newlines. Git external diffs and text conversion are disabled; text diffs are computed from immutable captured before/after content in a disposable temporary directory.

The version is a server-calculated SHA-256 fingerprint of the recorded base commit and a sorted manifest of current paths, complete Git-format content hashes, and file modes. Hashing streams **all bytes**, including bytes beyond display limits; deletions and symlink targets affect the fingerprint. Symlinks are recorded as link targets and never rendered or followed. Symlink ancestors are rejected during file reads. Two matching complete scans are required; a moving worktree is retried, then rejected with a refresh message. As with Phase 1, this is not a hostile-process filesystem sandbox: stop external editors/processes while collecting reviews.

The cached file list and lazily requested content belong to the same immutable version. Refresh retains the version when the manifest is unchanged and replaces the cached snapshot when it changes. Earlier saved writing remains in the server store, marked historical/outdated relative to the new review. Unsaved writing stays in the form when changing files or refreshing. Closing with unsaved writing prompts before discarding it; normal page unload also warns.

Every draft and completion submission captures/verifies the current manifest again. A stale version receives HTTP 409 and preserves typed answers. Refresh, inspect the new diff, and save again. Historical completed records are not treated as completion for a different version. Reverting to exactly the same content/modes/base naturally restores the same content-addressed version.

### Packages and storage

The only added runtime package is **`react-diff-viewer-continued` 4.4.x**, whose current peer dependencies support React 19. Its [documented split/inline API](https://github.com/Aeolun/react-diff-viewer-continued#props) supplies colored additions/deletions and line numbers. Repository contents render as React text, without syntax-highlighter HTML or code execution. Diff workers are disabled for predictable Next.js bundling; bounded files use the synchronous line diff. The existing Git, PTY, WebSocket, Zod, and Playwright dependencies remain. No second diff library, simple-git, editor framework, database, or dashboard replacement was added.

Explanation records are JSON files at **`.runtime/data/explanations/<agentId>/<version>.json`** by default. `DATA_ROOT` changes this directory. Writes use private temporary files and atomic rename. Each record stores the three answers, draft/completed status, update timestamp and, when complete, completion timestamp. No browser storage is authoritative. Writes are serialized per agent within the backend.

**Session recovery remains limited:** Phase 1 agent records and review snapshots are still in memory. A backend restart loses dashboard session history and the agent-to-worktree mapping even though worktrees and explanation files survive. Persisted JSON does not provide full session recovery. Older sessions evicted by the 25-session limit cannot be reopened through the API. Explanation history is not automatically deleted; manage application data manually as needed. Run one backend instance per data directory.

### Limits and unsupported changes

- At most 1,000 changed files and 20,000 candidate files; oversized listings fail clearly.
- At most 64 KiB per before/after side and 2 MiB of supported diff content per review; excess content is explicitly limited, never silently truncated.
- Binary, invalid UTF-8, symlink, or oversized changed files disable completion; drafts remain available. Counts cover supported text files only.
- Submodules, nested repository directories, special files and non-UTF-8 filenames fail inspection with an unsupported-state explanation. This phase does not review their contents.
- File content is lazy-loaded by a server-issued file ID plus exact version. APIs do not accept paths from the browser. Only the newest snapshot per agent stays cached; refreshing invalidates old file-content URLs, while saved explanation history remains on disk.
- There is no syntax highlighting, semantic grading, quiz, merge operation, drawing, or reward system.

### APIs and Phase 3 handoff

All routes preserve Phase 1's exact Origin checks and loopback binding:

```text
GET  /api/agents/:id/review
POST /api/agents/:id/review/refresh
GET  /api/agents/:id/review/files/:fileId?version=<fingerprint>
GET  /api/agents/:id/explanation?version=<fingerprint>
PUT  /api/agents/:id/explanation
```

PUT accepts `{ version, answers: { problem, solution, edgeCase }, intent: "draft" | "complete" }`. Shared schemas limit each answer to 6,000 characters. The request limit is 128 KiB. Active agents cannot be reviewed or submitted. The initial GET returns the immutable cached snapshot; use Refresh to inspect newer external edits.

`ReviewService.isExplanationCompleteForCurrentReview(agentId)` is the Phase 3 integration point. It recomputes the current version, checks full reviewability, and returns `{ version, complete }`. Call it at the point of any future gate decision rather than trusting a cached UI badge. It is only an explanation-completion prerequisite, not approval to merge.

The existing verification commands also cover Phase 2. Backend tests use disposable repositories for change collection, unusual filenames, base/index preservation, modes, immutable contents, stale versions, draft/completion persistence, symlinks, binary/large files, missing resources and validation. The browser suite covers paste/drop prevention, normal typing, draft restoration, completion, stale-save recovery, answer preservation, mobile inline mode, and the original launch/terminal/stop flow.

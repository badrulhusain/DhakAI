# Agent Classroom — Hackathon Pitch

## One-line pitch

Agent Classroom turns AI-written code from a black box into a guided lesson: watch the agent, review the exact diff, prove understanding, visualize the logic, and merge only what was reviewed.

## The problem

AI coding tools optimize for finishing tasks. That is useful for experienced developers, but risky for learners:

- the agent works faster than the learner can follow;
- a successful test run can be mistaken for understanding;
- accepting a diff is easier than explaining its behavior and edge cases;
- code can change after review, making an earlier approval stale;
- “agent isolation” is often only a UI promise, not a Git boundary.

The result is code ownership without knowledge ownership.

## The insight

The agent should not be the end of the learning experience. It should create the material for the lesson.

Every code change already contains four useful teaching artifacts: a process to observe, a diff to inspect, decisions to explain, and edge cases to test. Agent Classroom turns those artifacts into checkpoints before merge.

## The solution

The product guides one complete loop:

```text
Launch → Watch → Review → Explain → Quiz → Visualize → Merge
```

1. **Launch safely.** A Demo or Codex agent receives its own Git branch and worktree.
2. **Watch the real work.** The browser streams the actual PTY and accepts terminal input.
3. **Review exact changes.** The server snapshots all supported changes and creates a content-derived version.
4. **Explain in your own words.** The learner describes the problem, implementation, and edge case.
5. **Prove active recall.** A three-question quiz is tied to that exact review version.
6. **See the logic.** A validated graph is rendered locally as an accessible SVG flowchart; no external image service is needed.
7. **Earn the merge.** The server rechecks the repository, review hash, explanation, quiz pass, and Git state before a fast-forward merge.

## Why this is compelling

### Learning, not passive acceptance

The learner cannot unlock the main merge path by clicking “looks good.” They must explain the change and pass a quiz grounded in reviewed code evidence.

### Safety that is visible and verifiable

Each run uses a separate worktree. The base checkout stays untouched while the agent works. The final merge materializes only the immutable reviewed tree, verifies it again, and refuses dirty, stale, conflicting, or unsupported states.

### Honest system status

Backend HTTP, terminal readiness, persistence, Groq, and Codex availability are reported separately. The UI shows checking, ready, and unavailable states without fabricating a connection. It automatically recovers when the backend returns.

### An offline-first judging path

The bundled Demo runner changes a tiny task-validation project, pauses for terminal input, runs real tests, produces a deterministic quiz, and builds a deterministic flowchart. Judges can experience the core product without Codex, Groq, or Supabase credentials.

## Architecture

```text
Next.js classroom UI
  ├── HTTP health, review, quiz, drawing, score, merge
  └── WebSocket live terminal
             │
Node backend + PTY manager
  ├── Demo runner or local Codex CLI
  ├── immutable review/version service
  ├── quiz + validated learning-diagram service
  ├── drawing/reward service
  └── server-enforced merge gate
             │
Git branch + isolated worktree
             │
Local JSON storage or private Supabase storage
```

## Technical highlights

- Next.js 16 and React 19 frontend
- Node HTTP and WebSocket backend with `node-pty`
- Git branches, worktrees, immutable content hashes, and fast-forward-only merge
- Zod validation for every learning and diagram payload
- deterministic offline Demo provider and optional Groq provider
- local durable JSON or server-only Supabase access with RLS-enabled tables
- responsive, keyboard-focused UI with reduced-motion support
- integration and Playwright coverage for terminal, reconnect, review, quiz, drawing, score, and merge

## Four-minute demo script

### 0:00–0:35 — Frame the problem

“Coding agents can finish a task, but a learner can merge the answer without learning the reasoning. Agent Classroom makes understanding part of the delivery pipeline.”

Point out the live system-health chips and select **Demo**.

### 0:35–1:15 — Launch and watch

Click **Launch agent**. Show the real terminal, the isolated branch, and the prompt asking the learner to press Enter. Continue and let the sample tests pass.

### 1:15–2:05 — Review and explain

Open **Review changes**. Show the validation condition and whitespace-only test. Fill the three explanation prompts and complete the explanation.

### 2:05–2:45 — Quiz and flowchart

Create the Demo quiz. Intentionally miss one answer to show feedback, retry, then pass 3/3. Click **Build Demo flowchart** and point out the decision branch, error path, success result, and regression test. Emphasize that it renders locally.

### 2:45–3:25 — Learning artifact and reward

Optionally sketch the solution, add a caption, complete the checklist, and show the version-scoped score and badges. Explain that drawing is a bonus activity, not an AI correctness grade.

### 3:25–4:00 — Safe merge

Show merge eligibility, click **Merge reviewed changes**, and display the verified commit. Close with: “The agent wrote the code; the learner earned ownership of it.”

## Judge questions

### Is this just an agent wrapper?

No. The core value is the version-bound learning and merge pipeline around the agent: immutable review, explanation, evidence-backed quiz, local flowchart, drawing record, rewards, and a server-enforced Git gate.

### What happens if code changes after the quiz?

The review version changes. The old explanation, quiz pass, drawing, score context, diagram context, and merge eligibility become historical or stale. The learner must review the new code.

### Does the AI decide whether code is correct?

No. Quiz and diagram generation are learning aids. Merge safety comes from deterministic repository state, review hashes, supported-file checks, and Git verification. The drawing is never AI-graded.

### What works without cloud services?

Backend, live terminal, Demo runner, review, explanation, deterministic quiz, local flowchart, drawing, score, Git merge, and local persistence. Groq and Supabase are optional integrations.

### How is this safe?

It is a single-user tool. Worktrees isolate files but are not a security sandbox. Codex keeps its own sandbox controls. The merge service rejects dirty or moved bases, active Git operations, unsupported files, stale reviews, missing learning gates, and mismatched trees.

## Impact

Agent Classroom can help bootcamp learners, students, onboarding developers, and teams adopting AI coding tools. Its central idea is simple: measure progress by what the learner can explain and verify, not only by what the agent can generate.

## Honest limits and next steps

Today the product is deliberately single-user. It has no accounts, classes, teacher dashboard, collaborative review, or secure multi-tenant execution. The next meaningful step is a classroom layer with authenticated learners and teachers, while preserving the exact-version learning and merge guarantees demonstrated here.

## Closing line

**Do not just ship AI-generated code. Turn every change into a lesson, and every merge into earned understanding.**

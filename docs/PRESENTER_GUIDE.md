# Agent Classroom presenter guide

## Thirty-second problem

Coding agents can produce changes faster than learners can understand them. A learner can watch impressive terminal output and still be unable to explain the code, identify an edge case, or know whether merging is safe.

## Thirty-second solution

Agent Classroom turns an agent run into a learning gate: watch the live terminal, review an immutable diff, explain the solution in your own words, pass a server-graded quiz, optionally draw the logic for points, and only then unlock a merge of the exact reviewed version.

## Live demo (3–5 minutes)

Exact task: **“Add validation that rejects empty task titles and add a test for whitespace-only input.”**

1. Start with `npm run demo:reset && npm run demo:setup && npm run dev`. Show the yellow Demo mode banner and five independent dependency states. Mention that the demo requires no network, Codex login, Groq, Supabase, or user repository.
2. Keep Demo selected and launch. Point out the unique `classroom/agent-*` branch and separate worktree. Expected state: Agent is running and terminal WebSocket says Connected.
3. At the terminal prompt, explain the proposed validation, then press Enter. Expected output: two files updated, sample tests pass, agent completes naturally.
4. Open Review. Select `task.js` and `task.test.js`; call out additions/deletions and `+`/`−` labels. Paste into an explanation textarea to show it is blocked, then type the three prepared explanations and complete them.
5. Create the clearly labeled Demo quiz. Deliberately miss one attempt; show that Merge remains locked. Retry with the correct answers and pass 3/3.
6. Draw a tiny input → blank? → error/task flow, add the edge-case path, save, check all four items, and complete. Show that drawing points appear once; explain that drawing is optional for merge and never AI-graded.
7. Merge. Show the guarded progress, final commit SHA, 90/100 score for a second-attempt pass, and disabled “Already merged” button. In the sample repo, run `npm test` or inspect `task.js` to confirm the base repository contains the exact reviewed change.

Key technical points: real PTY over origin-checked WebSocket; bounded replay; server-owned worktree paths; full-content SHA-256 review fingerprints; private answer keys and server grading; immutable point transactions; exact-tree synthetic commit; clean/stale/conflict checks; fast-forward-only base mutation; idempotent merge reconciliation.

Educational value: the learner must observe, read, explain, retrieve knowledge, and optionally externalize a mental model before receiving the merge affordance.

## Recovery paths

- Backend unavailable: keep talking over `docs/demo/screenshots/`; run `npm run stop`, then `npm run dev`.
- Ports occupied: do not kill the owner. Set distinct `PORT`/`WEB_PORT` values in `.env` or stop only this project with `npm run stop`.
- Demo repository already completed or dirty: run `npm run stop`, then `npm run demo:reset`. If reset preserves a resource, show the reported path and do not force-delete it.
- Terminal disconnect: wait for exponential reconnect and replay. If necessary, reload; the run record and bounded output remain while the backend is alive.
- Groq/Supabase/Codex unavailable: stay in Demo/local mode; these are explicitly independent dependency states.
- Live browser trouble: use screenshots in order: dashboard, terminal, review/explain, quiz retry, drawing unlock, merge success.

## Likely judge questions

- **Can a learner bypass the UI and merge?** The direct merge API repeats every gate server-side and verifies the exact review fingerprint.
- **Are correct answers exposed?** No. Keys and explanations stay in backend persistence until grading returns feedback.
- **What if code changes after the quiz?** The fingerprint changes; explanation, quiz pass, drawing association, and merge eligibility become historical/outdated.
- **What if two merge clicks happen?** A repository queue, lock file, and operation ID make the merge idempotent and reconcilable.
- **Does Demo secretly call AI?** No. It is deterministic and labeled; its quiz is bundled, not presented as Groq-generated.
- **Is this production multi-user security?** No. It is a loopback, trusted, single-user hackathon threat model. Worktrees isolate files but are not a sandbox.
- **Why draw?** It is optional retrieval/elaboration practice worth bonus points; it never replaces the explanation, quiz, or Git safety gates.

## Recording

If a short recording is desired, use only the bundled repository after `npm run demo:reset`. Hide notifications, crop machine-specific paths, and record the 3–5 minute script. Store it under `docs/demo/` and document the filename. No player dependency is included because the application does not embed a recording.

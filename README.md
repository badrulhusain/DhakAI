# Agent Classroom

## Overview

Agent Classroom is an educational coding-agent workspace that helps learners understand AI-generated code before accepting it.

A learner gives Codex a programming task and watches the agent work through a live browser terminal. Every agent runs on its own Git branch and isolated worktree. After the agent finishes, the learner reviews the exact code changes, explains the solution, completes a quiz generated from the diff, and unlocks a guarded merge only after demonstrating understanding.

The project turns a coding agent from a code-generation tool into an interactive learning experience.

## Problem Statement

Coding agents can produce working software faster than many learners can understand it.

This creates several problems:

- Learners may accept generated code without understanding how it works.
- Terminal activity and large diffs can be difficult for beginners to follow.
- Existing coding-agent dashboards focus on task completion rather than learning.
- Teachers have little evidence that a learner understood an AI-generated solution.
- Incorrect, outdated, or unreviewed changes may be merged into the main branch.

The challenge is to preserve the speed of AI-assisted development while keeping the learner actively involved and accountable.

## Solution

Agent Classroom introduces a **Proof-of-Learning Gate** between AI-generated code and the final Git merge.

The workflow is:

1. The learner gives an agent a coding task.
2. The backend creates an isolated Git worktree and branch.
3. The agent’s terminal is streamed live to the browser.
4. The learner reviews the resulting code changes.
5. The learner explains the solution in their own words.
6. A quiz is generated from the exact reviewed diff.
7. The backend grades the answers and keeps merge locked until the quiz is passed.
8. Repository safety checks run before merging.
9. The learner can download a Learning Proof Report containing evidence from the session.

This creates a visible connection between watching an AI work, understanding its decisions, and safely accepting its code.

## Features

- **Isolated agent workspaces:** Every coding-agent run receives its own Git branch and worktree, protecting the base checkout.

- **Live browser terminal:** Agent output is streamed through WebSocket and PTY infrastructure, with browser keyboard input and start/stop controls.

- **Demo and Codex runners:** A deterministic demo works without credentials, while the Codex runner uses the locally installed Codex CLI.

- **Custom Codex profiles:** Learners can select an allowed model and reasoning level or use presets such as Fast Fix, Balanced Builder, and Deep Debugger.

- **Agent lifecycle tracking:** The dashboard shows agent creation, running, stopping, completion, failure, review, and merge states.

- **Agent Activity Stream:** Important actions such as inspecting files, editing code, and running tests are presented as understandable learning events.

- **Pause and Predict:** The learner predicts an important behavior or coding decision before the demo agent reveals its solution.

- **Guided code review:** Changed files, additions, deletions, and before-and-after code are displayed in a readable diff experience.

- **Change Story:** The application summarizes the problem, implementation decision, evidence, and possible risks behind a code change.

- **Paste-free explanation:** Learners describe the problem, solution, and edge cases in their own words before continuing.

- **Diff-generated quiz:** Groq can generate three evidence-based questions from the reviewed code changes.

- **Server-side grading:** Correct answers and passing state remain on the backend. Failed attempts keep merge locked.

- **Guarded Git merge:** Merge is enabled only after the explanation and quiz gates pass and repository safety checks succeed.

- **Solution Map:** Learners can draw or map the flow of the solution, including inputs, decisions, outputs, and error paths.

- **Points and badges:** Learners earn points for completing explanations, quizzes, solution maps, and verified merges.

- **Learning Proof Report:** A downloadable PDF records the task, learning journey, explanation, quiz result, score, drawing, changed files, and merge commit.

- **Safe demo mode:** The full educational flow can be demonstrated locally without Codex, Groq, or Supabase credentials.

## Tech Stack

- **Frontend:** Next.js, React, TypeScript, shadcn/ui, xterm.js

- **Backend:** Node.js, TypeScript, WebSocket, node-pty, execa

- **Database:** Supabase PostgreSQL, with a local demo-storage option

- **APIs / Services:** Codex CLI for coding-agent execution, Groq for structured quiz generation, Supabase Storage for private drawing assets

- **Hosting / Deployment:** [Add frontend deployment platform and URL]. Agent execution currently requires a local or self-hosted Node backend with access to Git, PTY processes, and the target repository.

- **Other Tools:** simple-git, React diff viewer, React sketch canvas, `@react-pdf/renderer`, Playwright, Git worktrees

## Codex / OpenAI Usage

Codex was used both as part of the product and throughout the hackathon development process.

### Inside the product

Agent Classroom launches the locally installed Codex CLI inside an isolated Git worktree. The learner can choose an allowed Codex model and reasoning profile before starting a task.

The application streams the Codex terminal to the browser, tracks the agent lifecycle, collects its Git changes, and connects the completed work to the educational review and merge process.

Codex remains responsible for solving the coding task. Agent Classroom adds the learning, review, scoring, and repository-safety layers around it.

### During development

Codex and ChatGPT assisted with:

- Refining the product idea and educational workflow
- Dividing development into five practical phases
- Designing the frontend and backend architecture
- Planning Git worktree and PTY process management
- Generating and reviewing TypeScript implementation
- Debugging frontend, backend, WebSocket, and port issues
- Designing immutable diff-review versions
- Planning Supabase persistence and security policies
- Integrating Groq structured quiz generation
- Designing guarded merge checks
- Creating test scenarios and error states
- Improving the interface and presentation story
- Writing documentation and hackathon submission material

AI accelerated development, while the team selected the final architecture, product decisions, safety rules, and educational experience.

## Demo

### Live Demo

[Add deployed project link]

If the agent backend runs locally, add the public frontend link and explain how judges can access the hosted or recorded agent flow.

### Demo / Pitch Video

[Add demo or pitch video link]

The recommended video structure is:

1. Show the problem: learners accept AI-generated code without understanding it.
2. Launch the sample validation task.
3. Show the live terminal and isolated worktree.
4. Complete the Pause and Predict moment.
5. Review the Change Story and code diff.
6. Submit an incorrect quiz answer and show merge remaining locked.
7. Pass the quiz and unlock merge.
8. Merge the reviewed changes.
9. Download the Learning Proof Report.

Keep the video between three and five minutes.

## Screenshots

### Agent Mission and Live Terminal

![Agent mission and terminal](./docs/screenshots/01-agent-mission.png)

### Pause and Predict

![Prediction checkpoint](./docs/screenshots/02-prediction-checkpoint.png)

### Change Story and Diff Review

![Change review](./docs/screenshots/03-change-review.png)

### Quiz and Locked Merge

![Quiz gate](./docs/screenshots/04-quiz-gate.png)

### Solution Map and Learning Score

![Solution map](./docs/screenshots/05-solution-map.png)

### Successful Merge and Learning Proof

![Learning proof](./docs/screenshots/06-learning-proof.png)

Replace these paths with the final screenshots committed to the repository.

## How to Run Locally

```bash
git clone <repo-url>
cd <project-folder>
npm install
```

Copy the environment example:

```bash
cp .env.example .env
```

Configure the values required by the project. Optional live integrations may include:

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
GROQ_API_KEY=
GROQ_MODEL=
CODEX_EXECUTABLE=codex
CODEX_ALLOWED_MODELS=
```

Never expose Supabase secret keys or Groq keys through variables prefixed with `NEXT_PUBLIC_`.

Set up the bundled demo:

```bash
npm run demo:setup
```

Start the frontend and backend:

```bash
npm run dev
```

Open the local URL printed by the development command.

Run the verification checks:

```bash
npm run test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Stop project processes:

```bash
npm run stop
```

Reset only the generated demo resources:

```bash
npm run demo:reset
```

Update these commands if the final repository uses different script names.

## Additional Notes

Agent Classroom is currently a local-first hackathon MVP.

The application requires a backend with access to Git, worktrees, and PTY processes. A fully static frontend deployment cannot run local coding agents by itself.

The bundled demo mode provides a deterministic presentation without external credentials. Live Codex, Supabase, and Groq functionality depends on the relevant local installation, account access, environment configuration, and network availability.

Current limitations may include:

- The MVP is designed primarily for one local learner.
- Freehand drawings receive completion points rather than automatic semantic correctness grades.
- Merge conflicts are detected and explained but are not automatically resolved.
- Available Codex models depend on the user’s CLI installation and account.
- The quiz is a learning checkpoint and does not prove that the generated software is free of defects.
- Teacher classes, session replay, collaborative review, and model comparison are planned future work.

Future development could add:

- Teacher and classroom dashboards
- Session replay with learning checkpoints
- Side-by-side agent-model comparison
- Personalized misconception tracking
- Assignment templates and grading rubrics
- Team learning reports
- Integration with GitHub pull requests and classroom platforms

The central idea remains simple:

**AI can write the code. Agent Classroom makes learners prove they understand it before it ships.**
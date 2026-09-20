# Agent Classroom

## Overview

Agent Classroom is an educational coding-agent dashboard that helps learners understand AI-generated code before merging it.

A learner gives Codex a programming task, watches the agent work through a live browser terminal, reviews the resulting Git diff, explains the solution, and completes a code-specific quiz. Merge remains locked until the learner passes the required understanding checks.

Each agent works in its own Git branch and isolated worktree, keeping the base repository protected.

## Problem Statement

Coding agents can generate software faster than learners can understand it.

This creates several problems:

- Learners may accept code without understanding how it works.
- Raw terminal output and large diffs can be difficult for beginners to follow.
- Existing agent dashboards focus on completing tasks rather than teaching.
- Teachers have little evidence that a learner understood an AI-generated solution.
- Unreviewed or outdated code can accidentally be merged into the main branch.

We wanted to preserve the speed of AI-assisted programming while keeping learners actively involved in reasoning, reviewing, and validating the generated code.

## Solution

Agent Classroom adds a **Proof-of-Learning Gate** between AI-generated code and the final Git merge.

The workflow is:

1. The learner creates a task and selects an agent profile.
2. The backend creates an isolated Git worktree and branch.
3. The agent’s terminal is streamed live to the browser.
4. The learner predicts important behavior while the agent works.
5. The completed changes are presented as a guided code review.
6. The learner explains the solution in their own words.
7. A quiz is generated from the exact reviewed diff.
8. The backend grades the quiz and keeps merge locked until it is passed.
9. Repository safety checks run before the reviewed changes are merged.
10. A Learning Proof PDF records the learner’s journey and results.

This turns the coding agent into an interactive teaching tool rather than a black-box code generator.

## Features

- Live browser terminal for Codex and scripted demo agents
- Isolated Git branch and worktree for every agent run
- Agent start, stop, completion, and failure states
- Configurable Codex model and reasoning profile
- Fast Fix, Balanced Builder, and Deep Debugger presets
- Agent Activity Stream with understandable progress events
- Pause-and-Predict learning checkpoints
- Changed-file list and colored Git diff viewer
- Guided Change Story explaining the problem, decision, evidence, and risk
- Paste-free problem-solving explanation activity
- Groq-generated quizzes based on the reviewed code
- Server-side grading with feedback and retries
- Merge button locked until learning and repository checks pass
- Detection of dirty repositories, stale branches, and merge conflicts
- Optional Solution Map drawing activity
- Learning points and achievement badges
- Supabase persistence for learning records
- Downloadable Learning Proof PDF
- Deterministic demo mode that works without external credentials

## Tech Stack

- **Frontend:** Next.js, React, TypeScript, shadcn/ui, xterm.js
- **Backend:** Node.js, TypeScript, WebSocket, node-pty, execa
- **Database:** Supabase PostgreSQL with a local demo-storage option
- **APIs / Services:** OpenAI Codex CLI, Groq API, Supabase Storage
- **Hosting / Deployment:** [Add hosting provider and deployed URL]
- **Other Tools:** Git worktrees, simple-git, React diff viewer, React sketch canvas, `@react-pdf/renderer`, Playwright

## Codex / OpenAI Usage

Codex was used both inside Agent Classroom and throughout the hackathon development process.

### Codex inside the product

Agent Classroom launches the locally installed Codex CLI inside an isolated Git worktree. The learner can choose an allowed Codex model and reasoning profile or use the default Codex configuration.

The application streams the Codex terminal to the browser, tracks the agent’s lifecycle, collects its Git changes, and connects the completed work to the review, quiz, and merge process.

Codex solves the programming task. Agent Classroom provides the educational and repository-safety layer around it.

### AI-assisted development

Codex, ChatGPT, and other AI tools helped us with:

- Product ideation and problem definition
- Architecture planning
- Next.js and Node.js implementation
- PTY and WebSocket integration
- Git worktree management
- Diff collection and review design
- Supabase schema and persistence planning
- Groq structured quiz integration
- Server-side grading logic
- Safe merge checks
- UI/UX exploration
- Debugging
- Test planning and generation
- Documentation and hackathon presentation material

AI accelerated implementation and helped us explore different approaches. The team made the final product, architecture, safety, and educational-design decisions.

## Demo

### Live Demo

[Add deployed project link]

The agent backend requires access to Git, local worktrees, and PTY processes. If the public deployment does not support those capabilities, use the demo video or run the project locally.

### Demo / Pitch Video

[Add demo or pitch video link]

The recommended demo flow is:

1. Show the whitespace-only task-title bug.
2. Launch a Codex or demo agent.
3. Watch the live terminal and agent activity.
4. Complete a Pause-and-Predict checkpoint.
5. Review the Change Story and Git diff.
6. Explain the solution.
7. Submit one incorrect quiz answer and show that merge remains locked.
8. Retry and pass the quiz.
9. Merge the reviewed code.
10. Download the Learning Proof PDF.

*A short demo/pitch video is strongly recommended.* Show the project working and briefly explain the problem, solution, and key features.

## Screenshots
available in this directory:dhakai/test-results
### Agent Workspace and Live Terminal

![Agent workspace and terminal](./docs/screenshots/01-agent-workspace.png)

### Prediction Checkpoint

![Pause and Predict checkpoint](./docs/screenshots/02-prediction-checkpoint.png)

### Diff Review and Change Story

![Diff review](./docs/screenshots/03-diff-review.png)

### Quiz and Merge Gate

![Quiz and locked merge](./docs/screenshots/04-quiz-merge-gate.png)

### Solution Map and Learning Score

![Solution map and score](./docs/screenshots/05-solution-map.png)

### Learning Proof Report

![Learning Proof Report](./docs/screenshots/06-learning-proof.png)

Replace these image paths with the final screenshots committed to the repository.

## How to Run Locally

```bash
git clone <repo-url>
cd <project-folder>
npm install
npm run dev
```

Copy the environment example before starting integrations:

```bash
cp .env.example .env
```

Optional live integrations may require:

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
GROQ_API_KEY=
GROQ_MODEL=
CODEX_EXECUTABLE=codex
CODEX_ALLOWED_MODELS=
```

Set up and run the deterministic demo if the corresponding scripts are available:

```bash
npm run demo:setup
npm run dev
```

Run the project checks:

```bash
npm run test
npm run test:e2e
npm run typecheck
npm
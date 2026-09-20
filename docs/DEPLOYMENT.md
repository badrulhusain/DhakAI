# Production deployment

Agent Classroom uses a split production topology:

```text
Browser
  ├── HTTPS → Next.js frontend on Vercel
  └── HTTPS/WSS → one persistent backend container
                         ├── PTY process
                         ├── Git repository + worktrees
                         └── Supabase or persistent volume
```

The frontend is suitable for Vercel. The backend is intentionally not packaged as a Vercel Function: an agent session owns a native PTY, keeps in-memory terminal state, mutates a Git worktree, and must serve later HTTP and WebSocket requests from the same process. Vercel Functions can accept WebSockets, but connections are pinned only for the function duration and later connections are not guaranteed to reach the same instance. Function execution is also time-bounded. See the official [WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) and [Function limits](https://vercel.com/docs/functions/limitations).

## Important security scope

This repository is a single-user coding classroom, not a multi-tenant SaaS application. Exact CORS origins reduce browser exposure but are not authentication: a non-browser client can forge an `Origin` header. Before exposing a backend to the public internet, protect both deployments with an identity-aware access layer or provider deployment protection. Do not offer anonymous access to a backend that can start processes or modify repositories.

Run exactly one backend replica. Agent sessions, PTYs, Git locks, and the in-memory replay buffer are process-local. Horizontal autoscaling is not supported.

## 1. Deploy the persistent backend

Build the supplied image:

```sh
docker build -f Dockerfile.backend -t agent-classroom-backend .
docker run --rm -p 4000:4000 \
  -e HOST=0.0.0.0 \
  -e PORT=4000 \
  -e ALLOWED_ORIGINS=https://classroom.example.com \
  -e STORAGE_MODE=local \
  -v agent-classroom-runtime:/app/.runtime \
  agent-classroom-backend
```

Deploy this image on a persistent container host such as Fly.io, Render, Railway, or a VM. Configure an HTTPS hostname, for example `https://agent-classroom-api.example.com`, and route it to container port `4000`. The provider health check is `GET /health`.

Production backend variables:

| Variable | Required | Production value |
| --- | --- | --- |
| `HOST` | yes | `0.0.0.0` |
| `PORT` | yes | provider-assigned port or `4000` |
| `ALLOWED_ORIGINS` | yes | exact comma-separated Vercel/custom frontend origins; no trailing slash |
| `STORAGE_MODE` | yes | `supabase` is recommended; `local` requires a persistent volume |
| `SUPABASE_URL` | for Supabase | private server variable |
| `SUPABASE_SECRET_KEY` | for Supabase | private/sensitive server variable |
| `GROQ_API_KEY` | for Codex quizzes/flowcharts | private/sensitive server variable |
| `GROQ_MODEL` | with Groq | configured structured-output-capable model |
| `TARGET_REPO` | optional | repository root inside the persistent volume/image |
| `WORKTREE_ROOT` | optional | persistent path outside `TARGET_REPO` |
| `DATA_ROOT` | local storage only | persistent data directory |

The supplied image supports the bundled Demo runner. A hosted Codex runner additionally requires a deliberate Codex CLI installation and non-interactive authentication strategy in your own image; credentials are not copied from the development machine.

## 2. Deploy the frontend to Vercel

Import the repository as one Vercel project. Keep the repository root as the project root. `vercel.json` selects the Next.js framework, runs `npm ci`, runs the workspace-aware production build, and publishes `apps/web/.next`.

Set this variable for both Preview and Production:

```text
NEXT_PUBLIC_BACKEND_URL=https://agent-classroom-api.example.com
```

It must be the bare HTTPS origin with no trailing path. The build fails instead of silently embedding localhost when this variable is missing or invalid on Vercel. Because it is a `NEXT_PUBLIC_` value, it is intentionally visible to browsers and must never contain credentials.

Deploy from Git or with the CLI:

```sh
vercel
vercel --prod
```

Vercel applies environment-variable changes only to new deployments, so redeploy after changing the backend URL. Official guidance: [environment variables](https://vercel.com/docs/environment-variables) and [monorepo builds](https://vercel.com/docs/builds).

## 3. Align CORS and preview deployments

The backend accepts only exact origins. Add the final frontend origin to `ALLOWED_ORIGINS`:

```text
ALLOWED_ORIGINS=https://classroom.example.com,https://classroom-staging.example.com
```

Use a stable staging domain for Preview instead of allowing every `*.vercel.app` deployment. Restart the backend after changing its origin list.

## 4. Production verification

Run before deployment:

```sh
npm ci
npm run typecheck
npm test
npm run test:e2e
NEXT_PUBLIC_BACKEND_URL=https://agent-classroom-api.example.com VERCEL=1 npm run vercel-build
docker build -f Dockerfile.backend -t agent-classroom-backend .
```

After deployment, verify:

1. `GET https://agent-classroom-api.example.com/health` returns `status: ok`.
2. The frontend health chips show backend and configured dependencies accurately.
3. A Demo agent launches and its WebSocket terminal accepts Enter.
4. Review, quiz, local flowchart, and merge complete against a disposable repository.
5. Restart the container and confirm persisted run metadata returns; an active PTY must correctly become `interrupted`.

## Operational limits

- Use one backend replica.
- Back up the persistent Git/data volume or use Supabase for learning records.
- Retained worktrees consume disk and require an operator cleanup policy.
- Treat logs and agent output as potentially sensitive.
- Keep `ENABLE_DEMO_REVIEWER_MODE=false` on an internet-accessible deployment.
- Worktrees isolate files but are not a security sandbox.

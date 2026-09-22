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

Treat this as a release blocker. The frontend sends credentials with every backend request, and the backend permits credentialed requests only from exact configured origins, so a cookie-based access proxy can protect the split deployment. Prefer frontend and backend custom domains under the same parent domain, for example `classroom.example.com` and `classroom-api.example.com`, and authenticate against the backend domain before opening the app. Confirm the access layer protects WebSocket upgrades as well as HTTP requests, and allows unauthenticated CORS `OPTIONS` requests to reach the backend while protecting the actual request.

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

The backend must be deployed before Vercel because its final HTTPS origin is compiled into the browser bundle and Content Security Policy. Use one replica and attach a persistent volume at `/app/.runtime` when `STORAGE_MODE=local`.

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
| `CODEX_EXECUTABLE` | optional | defaults to `/usr/local/bin/codex` in the supplied backend image |
| `TARGET_REPO` | optional | repository root inside the persistent volume/image |
| `WORKTREE_ROOT` | optional | persistent path outside `TARGET_REPO` |
| `DATA_ROOT` | local storage only | persistent data directory |

For a demo deployment, `TARGET_REPO=/app/.runtime/demo-repo`, `WORKTREE_ROOT=/app/.runtime/worktrees`, and `DATA_ROOT=/app/.runtime/data` match the supplied image. For a real repository, mount that repository and its worktree parent on persistent storage and set the two paths explicitly.

If using Supabase, apply the migration files in order before starting the backend:

1. `supabase/migrations/20260920000000_agent_classroom_phase3.sql`
2. `supabase/migrations/20260920010000_agent_classroom_phase4.sql`

Keep `SUPABASE_SECRET_KEY` on the backend only. Never add it to Vercel or prefix it with `NEXT_PUBLIC_`. The migrations enable RLS, revoke browser roles, and keep the drawing bucket private.

The supplied image installs a pinned Codex CLI and sets `CODEX_EXECUTABLE=/usr/local/bin/codex`. Rebuild and redeploy the backend image after changing the pinned `CODEX_VERSION` build argument. Authentication is intentionally not baked into the image: authenticate the production container with an API key or a securely mounted Codex auth cache. Never copy credentials into an image layer or commit `auth.json`. See the official [Codex authentication guide](https://learn.chatgpt.com/docs/auth).

## 2. Deploy the frontend to Vercel

Import the repository as one Vercel project. Keep the repository root as the project root. `vercel.json` selects the Next.js framework, runs `npm ci`, runs the workspace-aware production build, and publishes `apps/web/.next`.

For a newly imported project, use these exact settings:

| Vercel setting | Value |
| --- | --- |
| Framework Preset | `Next.js` |
| Root Directory | repository root (leave blank) |
| Install Command | use `vercel.json` (`npm ci`) |
| Build Command | use `vercel.json` (`npm run vercel-build`) |
| Output Directory | use `vercel.json` (`apps/web/.next`) |
| Node.js | `24.x` (current Vercel default; the app supports Node 22+) |

Do not select `apps/web` as Root Directory. If Vercel reports a path ending in `apps/web/apps/web/.next`, the Root Directory is wrong: clear it and redeploy.

Set this variable for both Preview and Production:

```text
NEXT_PUBLIC_BACKEND_URL=https://agent-classroom-api.example.com
```

It must be the bare HTTPS origin with no trailing path. The build fails instead of silently embedding localhost when this variable is missing or invalid on Vercel. Because it is a `NEXT_PUBLIC_` value, it is intentionally visible to browsers and must never contain credentials.

Add the variable before the first deployment. If Preview and Production use different protected backends, scope each value to its matching Vercel environment. Otherwise, disable Preview deployments or use one stable protected staging backend; arbitrary preview origins will not pass the backend's exact-origin policy.

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

After Vercel assigns the production domain, add that exact origin to `ALLOWED_ORIGINS` on the backend and restart it. If you later attach a custom domain, add the custom origin before switching traffic. Origins must not include a path or trailing slash.

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

For a clean Vercel re-import:

1. Delete the old Vercel project, then choose **Add New → Project** and import `badrulhusain/DhakAI`.
2. Leave **Root Directory** blank. Do not choose `apps/web`.
3. Add `NEXT_PUBLIC_BACKEND_URL` to Production and Preview before deploying.
4. Deploy and confirm the build log runs `node scripts/build.mjs`, not `node ../../scripts/build.mjs`.
5. Confirm the output is found at `/vercel/path0/apps/web/.next`.
6. Add the final Vercel origin to the backend's `ALLOWED_ORIGINS`, restart the backend, then run the browser checks above.

With the Vercel CLI installed, the equivalent local workflow is:

```sh
npm i -g vercel
vercel link
vercel env pull .env.local --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Do not commit `.vercel`, `.env.local`, or any pulled secrets.

## Operational limits

- Use one backend replica.
- Back up the persistent Git/data volume or use Supabase for learning records.
- Retained worktrees consume disk and require an operator cleanup policy.
- Treat logs and agent output as potentially sensitive.
- Keep `ENABLE_DEMO_REVIEWER_MODE=false` on an internet-accessible deployment.
- Worktrees isolate files but are not a security sandbox.

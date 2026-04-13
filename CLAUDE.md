# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Orbi** — personal life hub. A multi-module web app with a Node.js/TypeScript backend and plain HTML+JS frontend pages (no build step). Deployed on Vercel (frontend) + Render (backend API).

- Frontend: `https://orbi-two-xi.vercel.app`
- Backend API: `https://orbi-api-b9ev.onrender.com/api`

## Commands

All backend commands run from `backend/`:

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # Compile TypeScript → dist/
npm run db:migrate   # Create + apply new migration (dev)
npm run db:deploy    # Apply pending migrations (prod)
npm run db:seed      # Seed database
npx prisma studio    # Open Prisma Studio GUI
```

Local dev requires Docker for Postgres:
```bash
docker compose up -d   # Start Postgres (from repo root)
```

## Architecture

### Backend (`backend/src/`)

- **`server.ts`** — Express app setup, CORS, global error handler (Zod + Prisma errors)
- **`api.ts`** — All routes in one file, mounted at `/api`. ~1300+ lines.
- **`prisma.ts`** — Singleton Prisma client

Authentication uses session tokens stored in the `Session` table. The `requireAuth` middleware reads `Authorization: Bearer <token>` and attaches `req.userId`. All user data is scoped by `userId`.

### Frontend

Each module is a standalone HTML file with inline `<script>` — no bundler, no framework:

| File | Module |
|---|---|
| `index.html` | Hub (calendar + today card + profile) |
| `financas.html` | Finances |
| `exercicios.html` | Workouts |
| `casinha.html` | Home tasks & routines |
| `habitos.html` | Habits |
| `Alimentacao.html` | Nutrition |
| `Saude.html` | Health (weight, exams, appointments, meds) |

The hub (`index.html`) reads data from **localStorage** populated by `hubBootstrap()`, which fetches from all modules' APIs on load. Data is stored per-user with `_lsSet(key, val)` / `_lsGet(key)` helpers that namespace by `hub_user_id`.

### Key localStorage keys (hub)
- `hub_fin_cache` — transactions
- `saude_treinos_v1` — workouts
- `casinha_tarefas` — tasks
- `habitos_app_v5` — habits + logs
- `alimentacao_meals_v3_light` — meals
- `saude_app_v1` — weights/exams/consults
- `hub_gcal_events` — Google Calendar events

### Database

PostgreSQL via Prisma. Schema in `backend/prisma/schema.prisma`. Migrations in `backend/prisma/migrations/`.

The `start` script in `package.json` includes `prisma migrate resolve --applied <id>` for each migration that was created manually (not via `prisma migrate dev`) before running `prisma migrate deploy`. **When adding a new manual migration, append it to the start script.**

### Third-party integrations

- **Strava** — OAuth2, syncs activities as workouts. Token stored in `StravaToken` table.
- **Google Calendar** — OAuth2 (`calendar.readonly` scope), fetches events from all user calendars. Token stored in `GoogleToken` table. Backend auto-refreshes expired tokens.

For both integrations: `client_id` is safe in frontend JS; `client_secret` is only in Render env vars.

### API patterns

- Routes use `req.userId` (set by `requireAuth`) — never trust `usuario_id` from query params without calling `assertUserMatchesQuery(req)`
- Upserts use composite unique keys like `{ userId_client_id: { userId, client_id } }`
- `client_id` fields are frontend-generated UUIDs used for offline-first sync
- `toDecimal(value)` converts numbers to `Prisma.Decimal` for monetary fields

### Render deploy

The Render service builds with `npm run build` and starts with `npm run start`. The start script resolves migration state before deploying. New env vars go in the Render dashboard (never committed).

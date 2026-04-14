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

The hub (`index.html`) uses localStorage as a **read cache** only. On load, `hubBootstrap()` fetches from all module APIs and writes to localStorage. The hub calendar and today card read from this cache for fast rendering. Hub actions (toggle habit, complete task, complete workout) write directly to the API and update the cache in sync. Data is namespaced per-user via `_lsSet(key, val)` / `_lsGet(key)` helpers that prefix with `u_${hub_user_id}_`.

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

The `start` script in `backend/package.json` runs `prisma migrate deploy` then `node dist/server.js`. Do **not** chain `prisma migrate resolve --applied` on every start: once a migration is already recorded in `_prisma_migrations`, repeating `--applied` fails with **P3008** and the service never binds a port. One-off `resolve` (if ever needed for a broken history) should be run **manually** in the Render shell, not in `start`.

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

The Render service builds with `npm run build` and starts with `npm run start` (applies pending migrations, then starts the API). New env vars go in the Render dashboard (never committed).

---

## Reliability Standards

This section has two distinct parts:

- **Current State** — what the code actually does today. Factually accurate as of the last audit.
- **Rules for New Code** — what every new module or feature must do. These are prescriptive standards, not descriptions of the full existing codebase.

Do not assume a rule in "Rules for New Code" is already implemented everywhere. Check "Current State" and the code itself.

---

## Current State — What Is and Isn't Implemented

This is a factual audit of the codebase. Verified against source files. Last audited: 2026-04-14 (hub reliability pass: `fetchFinancas` delete filter, gated `hub_lastsync`, hub actions `e.network`).

### ✅ Implemented consistently across all modules

- **Dirty queue pattern** — all modules (`financas`, `exercicios`, `casinha`, `habitos`, `Alimentacao`, `Saude`) implement `markDirty` / `clearDirty` before and after API calls on write paths
- **Deleted queue pattern** — all modules implement `markDeleted` / `clearDeleted` for delete operations
- **Bootstrap uses `Promise.allSettled`** — all 6 modules. `index.html` (hub) uses `Promise.all` with per-fetch `.catch(()=>null)`, which is acceptable (read-only, null-guarded). Hub only updates `hub_lastsync_v1` when **all** core module fetches in that bootstrap return non-`null`; otherwise the sync label shows a partial-failure state.
- **Bootstrap retries dirty items** — all modules recover local-only items on bootstrap and retry sync
- **Bootstrap retries pending DELETEs** — all modules. `financas` retries all 5 entity types; `casinha` all 4; `Alimentacao` retries meals and water; `Saude` retries weights, exams, consults; `habitos` retries habits; `exercicios` retries treinos, locais, tipos.
- **`_showSyncWarn()` on partial bootstrap failure** — all 6 modules. `exercicios` uses `setStatus(...)` (different UI element, same intent).
- **`_showLastSync()` only on full success** — all 6 modules call `_showLastSync()` conditionally (only when all endpoints succeeded).
- **`logoutUser` checks all queues** — all modules check both dirty and deleted queues and show `confirm()` before clearing state
- **`beforeunload` warning** — all modules set `e.returnValue` if queues are non-empty (best-effort browser warning only, no sync)
- **No `.catch(()=>null)` on write paths** — eliminated from all modules. The only remaining `.catch(()=>null)` is in `index.html` (`hubBootstrap` read helper `h(url)`), which is read-only and null-guards all results
- **Hub cache filtered for all pending module deletes** — all module-backed hub cache keys filter pending-delete IDs before writing: `hub_fin_cache` (via `fetchFinancas`, by `client_id` vs `fin_deleted_v1`), `saude_treinos_v1` (by `_dbId`), `casinha_tarefas` (by `_dbId`), `habitos_app_v5` (by `_dbId`), `alimentacao_meals_v3_light` (by `id`), `saude_app_v1` (weights/exams/consults by `id`)
- **`e.network` distinction in write paths with rollback** — modules with rollback code in catch blocks (`casinha`, `habitos`, `Alimentacao`, `Saude`) all check `e.network` before rolling back. Modules without rollback (`financas`, `exercicios` treino save) leave items dirty and log — no rollback needed. **`index.html` hub quick actions** (`_hubPost` / hábito, treino, tarefa): on `fetch` throw, error has `network=true` — no optimistic rollback; marks the corresponding module dirty queue for retry on next module bootstrap.
- **`assertUserMatchesQuery`** — implemented on all backend GET routes that accept `usuario_id` query param

### ℹ️ No known open issues

All reliability issues identified in prior audits have been resolved. The codebase is consistent across all modules.

---

## Rules for New Code

These rules apply to any new module, new entity type added to an existing module, or significant refactor. They represent the target architecture.

---

### 🔴 ANTI-PATTERNS (PROHIBITED)

#### 1. `.catch(()=>null)` on write paths

```js
// ❌ PROHIBITED
await apiReq('/endpoint', { method: 'POST', body: ... }).catch(()=>null);

// ✅ CORRECT — error propagates; dirty queue or explicit catch handles it
await apiReq('/endpoint', { method: 'POST', body: ... });
```

The only acceptable `.catch(()=>null)` is on **read-only** fetches where the result is null-guarded and no write depends on it (e.g., the hub bootstrap helper `h(url)` in `index.html`).

#### 2. Fire-and-forget on persistence

```js
// ❌ PROHIBITED
syncData(item);

// ✅ CORRECT — mark dirty before, clear on success, warn on failure
markDirty(item.id);
syncData(item)
  .then(() => clearDirty(item.id))
  .catch(e => console.warn('[Module] sync failed, will retry:', e));
```

Fire-and-forget is only acceptable for non-persistence side-effects (UI preloads, analytics). Any call that writes data to the API must be awaited or follow the dirty-queue pattern.

#### 3. Optimistic update without rollback

```js
// ❌ PROHIBITED — UI shows success, failure is silent
items.push(newItem);
saveLocal();
apiReq('/items', { method: 'POST', body: ... }).catch(() => {});

// ✅ CORRECT — mark dirty, distinguish network errors from server errors
items.push(newItem);
saveLocal();
markDirty(newItem.id);
try {
  await apiReq('/items', { method: 'POST', body: ... });
  clearDirty(newItem.id);
} catch(e) {
  if (e.network) {
    // Request may have reached server. Local state is correct, dirty queue will retry.
    console.warn('[Module] network error, will retry:', e);
  } else {
    // Server explicitly rejected. Rollback.
    items = items.filter(x => x.id !== newItem.id);
    saveLocal();
    alert('Erro ao salvar. A alteração foi desfeita.');
  }
}
```

**The `e.network` distinction is critical.** `e.network === true` is set by `apiReq` when `fetch()` itself throws (connection failure, timeout, Render cold start). In this case the request may have already been processed server-side. Rolling back in this case creates the "ghost rollback" bug: UI shows error, user retries, a duplicate entry is created in the database, both appear after refresh. Do not rollback on `e.network`.

#### 4. localStorage as source of truth

```js
// ❌ PROHIBITED
const items = JSON.parse(localStorage.getItem('key') || '[]');
// used without ever syncing to/from API

// ✅ CORRECT — localStorage is write-through cache only
// bootstrap always fetches from API and merges with local pending items
// localStorage is only authoritative for items in the dirty queue (not yet confirmed by server)
```

#### 5. Hub cache written without pending-delete filter

```js
// ❌ PROHIBITED — hub overwrites cache, resurrects deleted items
if (rItems !== null) _lsSet('module_key', JSON.stringify(items));

// ✅ CORRECT — filter locally-deleted items before writing hub cache
if (rItems !== null) {
  const pending = new Set(
    JSON.parse(localStorage.getItem('u_' + uid + '_module_deleted_ids_v1') || '[]')
  );
  _lsSet('module_key', JSON.stringify(items.filter(x => !pending.has(x.id))));
}
```

Module deletes are fire-and-forget. If the user navigates to the hub before the DELETE reaches the server, `hubBootstrap` fetches the pre-delete API state and overwrites the cache, resurrecting the item.

---

### 🔴 The Golden Rule

> **The user must never believe data was saved when it was not. The user must never believe data was lost when it was not.**

- **False success**: UI shows item saved → API failed silently → data gone on refresh. Caused by fire-and-forget, `.catch(()=>null)`, missing rollback.
- **False failure**: UI shows error and rolls back → API actually succeeded → data reappears on refresh. Caused by rolling back on `e.network` errors. Creates duplicate entries if the user retries.

Both are bugs. Both have occurred in this codebase and been fixed. Do not reintroduce either.

---

### 🔴 Dirty Queue Pattern

Every entity type in every module must implement this pattern.

**Keys required per entity type:**
- `u_${userId}_MODULE_ENTITY_dirty_v1` — Set of `client_id`s pending sync
- `u_${userId}_MODULE_ENTITY_deleted_v1` — Set of server IDs (or `client_id`s) pending DELETE

**Lifecycle for creates and edits:**

```js
markDirty(item.id);    // 1. before API call — intent survives tab close
saveLocal();           // 2. immediately available, even offline
syncItem(item)
  .then(() => clearDirty(item.id))              // 3. confirmed → drain queue
  .catch(e => console.warn('[Module] ...', e)); // 4. failed → stays dirty, retried on bootstrap
```

**Lifecycle for deletes:**

```js
markDeleted(item.id);          // 1. before API call
removeFromLocalState(item.id); // 2. optimistic removal
saveLocal();
apiReq(`/items/${item._dbId}`, { method: 'DELETE' })
  .then(() => clearDeleted(item.id))
  .catch(e => console.warn('[Module] retry delete:', e));
```

**Bootstrap must retry both queues:**

```js
async function bootstrapApi() {
  // Step 1 — fire pending DELETEs before fetching server state
  for (const id of getDeleted()) {
    apiReq(`/items/${id}`, { method: 'DELETE' })
      .then(() => clearDeleted(id))
      .catch(e => console.warn('[Module] retry delete:', id, e));
  }

  // Step 2 — fetch server state (Promise.allSettled — never Promise.all)
  const [_sItems] = await Promise.allSettled([apiReq('/items')]);
  const serverItems = _sItems.status === 'fulfilled' ? _sItems.value : null;

  if (serverItems !== null) {
    // Step 3 — merge: server items + local dirty items not yet on server
    const serverIds = new Set(serverItems.map(x => x.client_id));
    const localPending = getLocalItems().filter(
      x => getDirty().has(x.id) && !serverIds.has(x.id)
    );
    items = [...serverItems.map(fromApi), ...localPending];

    // Step 4 — retry dirty items
    for (const item of localPending) {
      syncItem(item)
        .then(() => clearDirty(item.id))
        .catch(e => console.warn('[Module] retry sync:', e));
    }
  }

  // Step 5 — show sync warning if any fetch failed
  if (_sItems.status === 'rejected') _showSyncWarn();
  else _showLastSync();
}
```

---

### 🔴 Bootstrap Integrity Rules

1. **Use `Promise.allSettled`, never `Promise.all`.** A failed endpoint must not abort the entire bootstrap and leave the user with an empty or stale view.

2. **Null-guard every result.** `null` means the endpoint failed. Keep existing local state — do not overwrite with nothing.

3. **Never overwrite locally-dirty data with server data.** If the dirty queue for an entity is non-empty, push local → server instead.
   ```js
   const configDirty = getDirty(KEY_CONFIG_DIRTY).size > 0;
   if (serverConfig && !configDirty) {
     applyServerConfig(serverConfig);
   } else if (configDirty) {
     syncConfig().catch(e => console.warn('[Module] config sync failed:', e));
   }
   ```

4. **Show `_showSyncWarn()` if any endpoint failed.** The user must know their data may be stale.

5. **Show `_showLastSync()` after a fully successful bootstrap.**

---

### 🔴 Reliable Deletes

A delete is only reliable when all three are true:

1. Intent is persisted in a deleted queue **before** the API call
2. Local state is updated optimistically (item removed from UI immediately)
3. The DELETE is retried on next bootstrap if it failed

Missing any one of these causes the item to reappear — from the server, on another device, or on next refresh.

**In addition:** when `hubBootstrap` writes a module's data to the hub cache, it must filter IDs present in that module's deleted queue (see anti-pattern #5 above).

---

### 🔴 Logout and Exit Safety

`logoutUser()` must:

1. Check **every** dirty and deleted queue the module uses (not just the main dirty key)
2. Show `confirm()` if any queue is non-empty
3. Return early if the user cancels
4. Clear queues only after confirmation

`beforeunload` must check the same queues and set `e.returnValue`. This is a best-effort browser warning — it does not and cannot perform sync. Never attempt async API calls in `beforeunload`.

---

### 🔴 Multi-Device Consistency

- **Creates/edits** are idempotent: `client_id` is a frontend UUID, API upserts on `(userId, client_id)`. Retrying the same create is always safe.
- **Deletes** must go through the deleted queue. A delete that only removes from local state without queuing a DELETE will reappear on every other device.
- **Bootstrap merge**: server state overwrites local for items not in the dirty queue. Local state is preserved for items in the dirty queue. This is the only correct order.
- **Hub cache** must respect pending deletes from all modules, not just the one the user is currently on.

---

### 🔴 Error Handling Standards

- Never silence write-path errors. Minimum: `console.warn('[ModuleName] description:', e)`.
- Always distinguish `e.network` (fetch threw — server may have succeeded) from server errors (server returned 4xx/5xx — server definitely rejected).
- Use `apiReqRetry` for critical writes where Render cold starts are likely. It retries up to 4 times with backoff (3s, 8s, 15s) on network errors only.
- Backend: never swallow errors in route handlers. Let Zod and Prisma errors propagate to the global handler in `server.ts`.

---

### 🔴 New Module Checklist

Before shipping any new module or new entity type, verify all items:

**Storage**
- [ ] All localStorage keys use `u_${userId}_` namespace prefix
- [ ] Dirty queue key per entity type: `MODULE_ENTITY_dirty_v1`
- [ ] Deleted queue key per entity type: `MODULE_ENTITY_deleted_v1`
- [ ] `markDirty`, `clearDirty`, `markDeleted`, `clearDeleted` helpers implemented

**Bootstrap**
- [ ] Uses `Promise.allSettled` for all parallel fetches
- [ ] Each result null-guarded before use
- [ ] Pending DELETEs retried at bootstrap start (before fetching server state)
- [ ] Bootstrap merges server items + local dirty-only items
- [ ] Dirty items not on server are retried
- [ ] Local config/settings not overwritten when dirty
- [ ] `_showSyncWarn()` called if any endpoint failed
- [ ] `_showLastSync()` called after full success

**Writes**
- [ ] `markDirty` called before API call
- [ ] `clearDirty` called on confirmed success
- [ ] No `.catch(()=>null)` on any write path
- [ ] `e.network` errors do not trigger rollback
- [ ] Server errors trigger rollback with user-visible alert

**Deletes**
- [ ] `markDeleted` called before API call
- [ ] `clearDeleted` called on confirmed success
- [ ] Delete retried on next bootstrap
- [ ] If module data appears in hub cache, hub filters this module's deleted IDs before writing cache

**Exit safety**
- [ ] `logoutUser` checks every dirty and deleted queue the module uses
- [ ] `logoutUser` shows `confirm()` if any queue non-empty
- [ ] `beforeunload` checks same queues and sets `e.returnValue`

**Backend**
- [ ] All GET routes with `usuario_id` param call `assertUserMatchesQuery(req)`
- [ ] All write routes use `req.userId` from `requireAuth` — never trust body/params for user identity
- [ ] Upserts use composite unique key on `(userId, client_id)`

---

### Offline-First Architecture Summary

```
User action
    │
    ▼
markDirty(id)       ← intent persisted before network call
saveLocal()         ← immediately available offline
    │
    ▼
syncToApi(item)
    ├── success        → clearDirty(id)
    ├── e.network      → leave dirty, log warn      ← retry on next bootstrap
    └── server error   → rollback + alert           ← explicit user feedback
```

```
Bootstrap
    │
    ├── 1. Retry pending DELETEs (fire-and-forget, with warn on failure)
    ├── 2. Promise.allSettled([...all endpoints])
    ├── 3. Null-guard each result
    ├── 4. Merge: server + local dirty items not yet on server
    ├── 5. Retry dirty items
    ├── 6. If dirty config → push local to server (do not overwrite local)
    ├── 7. If any endpoint failed → _showSyncWarn()
    └── 8. If all succeeded    → _showLastSync()
```

localStorage is write-through: updated on every local change. On bootstrap it is read only to recover items in the dirty queue that have not yet reached the server. It is never the final source of truth.

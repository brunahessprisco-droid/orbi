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

---

## Reliability Standards (MANDATORY)

This section documents patterns that **must** be followed in every module. These rules exist because all of the problems below have already occurred in production and been corrected. Any new code that violates these rules introduces a known regression.

---

### 🔴 ANTI-PATTERNS (PROHIBITED)

These patterns are **banned** across all frontend modules. Never introduce them, regardless of context.

#### 1. `.catch(()=>null)` on write paths

```js
// ❌ PROHIBITED — error is silenced, caller receives null, failure is invisible
await apiReq('/endpoint', { method: 'POST', body: ... }).catch(()=>null);

// ✅ CORRECT — error propagates, dirty queue or catch handler deals with it
await apiReq('/endpoint', { method: 'POST', body: ... });
```

The only acceptable `.catch(()=>null)` is on **read-only hub bootstrap helpers** where the return value is null-guarded and no write operation depends on the result. Every write path must propagate or explicitly handle errors.

#### 2. Fire-and-forget on persistence

```js
// ❌ PROHIBITED — no await, no error handling at call site
syncData(item);

// ✅ CORRECT — mark dirty before call, clear on success, warn on failure
markDirty(item.id);
await syncData(item).then(()=>clearDirty(item.id)).catch(e=>console.warn('[Module] sync failed, will retry:', e));
```

Fire-and-forget is only acceptable for **non-persistence side-effects** (e.g., preloading UI, analytics). Any call that writes data to the API must be awaited or follow the dirty-queue pattern.

#### 3. Optimistic update without rollback

```js
// ❌ PROHIBITED — UI shows success, but failure is silent
items.push(newItem);
saveLocal();
apiReq('/items', { method: 'POST', body: ... }).catch(()=>{});

// ✅ CORRECT OPTION A — await and rollback on failure
items.push(newItem);
saveLocal();
markDirty(newItem.id);
try {
  await apiReq('/items', { method: 'POST', body: ... });
  clearDirty(newItem.id);
} catch(e) {
  // rollback only on server errors; network errors keep local state (dirty queue retries)
  if (!e.network) {
    items = items.filter(x => x.id !== newItem.id);
    saveLocal();
    alert('Erro ao salvar.');
  } else {
    console.warn('[Module] sync failed (network), will retry:', e);
  }
}

// ✅ CORRECT OPTION B — dirty queue pattern (no await at call site)
markDirty(item.id);
saveLocal();
syncItem(item).then(()=>clearDirty(item.id)).catch(e=>console.warn('[Module] will retry:', e));
```

**Critical distinction on rollback:** `e.network === true` means the request may have already been processed by the server (e.g., Render accepted the request but the response was lost in transit). In this case, **do not rollback** — the data is already in localStorage with the dirty flag set, and will be confirmed or retried on the next bootstrap. Rolling back on a network error that the server already handled creates the "ghost rollback" bug (UI shows error, refresh shows the data was saved).

#### 4. localStorage as source of truth

```js
// ❌ PROHIBITED — treating localStorage as authoritative
const items = JSON.parse(localStorage.getItem('my_key') || '[]');
// ... never syncing with API

// ✅ CORRECT — localStorage is a write-through cache
// On bootstrap: always fetch from API, merge with localStorage pending items
// localStorage is read only when API is unavailable (offline)
```

#### 5. Hub cache written without pending-delete filter

```js
// ❌ PROHIBITED — hub overwrites cache with stale API data, resurrecting deleted items
if(rItems !== null) _lsSet('module_key', JSON.stringify(items));

// ✅ CORRECT — filter locally-deleted items before writing hub cache
if(rItems !== null) {
  const pending = new Set(JSON.parse(localStorage.getItem('u_'+uid+'_module_deleted_ids')||'[]'));
  _lsSet('module_key', JSON.stringify(items.filter(x => !pending.has(x.id))));
}
```

This matters because module deletes are fire-and-forget (`deleteApi()` without await). If the user navigates to the hub before the DELETE reaches the server, `hubBootstrap` fetches from the API and overwrites the cache — resurrecting the deleted item.

---

### 🔴 The Golden Rule

> **The user must never believe data was saved when it was not.**

This has two sides:

- **False success**: UI shows item as saved → API failed silently → data is gone on refresh. This is caused by fire-and-forget, `.catch(()=>null)`, or missing rollback.
- **False failure**: UI shows error and rolls back → API actually succeeded → data appears on refresh. This is caused by rolling back on network errors (`e.network === true`) without distinguishing from server rejections.

Both are bugs. One loses data, the other erodes trust.

---

### 🔴 Dirty Queue Pattern (Standard for all modules)

Every module that writes data must implement the dirty queue pattern. This is what makes the app resilient to network failures, tab closes, and device switches.

**Required keys per entity type:**
- `MODULE_DIRTY_KEY` — Set of `client_id`s pending sync to server
- `MODULE_DELETED_KEY` — Set of `client_id`s (or server IDs) pending DELETE

**Required lifecycle:**

```js
// CREATE / EDIT
markDirty(item.id);       // 1. Mark before API call
saveLocal();              // 2. Persist to localStorage
syncItem(item)            // 3. Try to sync
  .then(()=>clearDirty(item.id))   // 4. Clear on confirmed success
  .catch(e=>console.warn('[Module] will retry:', e)); // 5. Warn, leave dirty for retry

// DELETE
markDeleted(item.id);     // 1. Mark deleted before API call
removeFromLocalState();   // 2. Remove from local array
saveLocal();              // 3. Persist removal
apiReq(`/items/${item._dbId}`, { method: 'DELETE' })
  .then(()=>clearDeleted(item.id)) // 4. Clear on confirmed success
  .catch(e=>console.warn('[Module] retry delete:', e)); // 5. Warn, retry on bootstrap
```

**Bootstrap must retry both queues:**

```js
async function bootstrapApi() {
  // 1. Retry pending DELETEs first (before fetching server state)
  for (const id of getDeleted()) {
    apiReq(`/items/${id}`, { method: 'DELETE' })
      .then(()=>clearDeleted(id))
      .catch(e=>console.warn('[Module] retry delete:', id, e));
  }

  // 2. Fetch server state
  const serverItems = await apiReq('/items');

  // 3. Merge: server items + local items not yet on server (in dirty queue)
  const serverIds = new Set(serverItems.map(x => x.client_id));
  const localPending = getLocalItems().filter(x => getDirty().has(x.id) && !serverIds.has(x.id));
  items = [...serverItems.map(fromApi), ...localPending];

  // 4. Retry dirty items
  for (const item of localPending) {
    syncItem(item).then(()=>clearDirty(item.id)).catch(e=>console.warn('[Module] retry sync:', e));
  }
}
```

---

### 🔴 Bootstrap Integrity Rules

Bootstrap is the most critical path — it runs on every page load and determines what the user sees. Violations here cause data loss, ghost data, and divergence between devices.

1. **Always use `Promise.allSettled` for parallel fetches**, not `Promise.all`. A single failed endpoint must not abort the entire bootstrap.
   ```js
   const [_sA, _sB, _sC] = await Promise.allSettled([fetchA(), fetchB(), fetchC()]);
   const rA = _sA.status === 'fulfilled' ? _sA.value : null;
   ```

2. **Null-guard every result** before merging. If an endpoint failed (`null`), keep the existing local state for that entity — do not overwrite it.
   ```js
   if (rA !== null) items = rA.map(fromApi); // only replace if server responded
   ```

3. **Never overwrite locally-dirty data with server data.** If the user has unsaved changes (dirty queue is non-empty for an entity), the local version takes precedence. The server's version may be stale.
   ```js
   const configDirty = getDirty(KEY_CONFIG_DIRTY).size > 0;
   if (serverConfig && !configDirty) {
     applyServerConfig(serverConfig); // safe to overwrite
   } else if (configDirty) {
     syncConfig().catch(e=>console.warn(...)); // push local to server instead
   }
   ```

4. **Show a sync warning banner when bootstrap is partial.** If any endpoint fails, the UI must indicate that some data may be stale. Use the established `_showSyncWarn()` pattern.

5. **Show a last-sync timestamp after a successful bootstrap.** Use the established `_showLastSync()` pattern.

---

### 🔴 Reliable Deletes

A delete is only reliable if it satisfies all three conditions:

1. **Local state is updated immediately** (optimistic removal from UI)
2. **The intent is persisted** in a deleted queue in localStorage before the API call
3. **The API call is retried** on the next bootstrap if it failed

If any of these is missing, the deleted item will reappear on the next device, the next refresh, or the next bootstrap — whichever comes first.

**Additional rule:** when `hubBootstrap` writes module data to the hub's localStorage cache, it must filter out any IDs present in that module's deleted queue. The hub bootstrap runs before the module's fire-and-forget DELETE has time to complete, so without this filter, deleted items resurrect in the hub.

---

### 🔴 Logout and Exit Safety

Every module's `logoutUser()` must:

1. Check **all** dirty and deleted queues (not just the main dirty key)
2. Show a `confirm()` dialog if any queue is non-empty
3. Allow the user to cancel and stay on the page
4. Only clear queues after the user confirms intent to leave

```js
async function logoutUser() {
  const hasPending = getDirty().size > 0 || getDeleted().size > 0; // check ALL queues
  if (hasPending) {
    const proceed = confirm('Você tem dados não sincronizados. Deseja sair mesmo assim?');
    if (!proceed) return;
  }
  try { await apiReq('/auth/logout', { method: 'POST' }); } catch(_) {}
  clearAllQueues(); // only after user confirms
  authToken = ''; API_USER_ID = null;
  showLogin();
}
```

Every module's `beforeunload` must check the same queues and set `e.returnValue` to warn the user. This is a best-effort browser warning — it does **not** perform any sync. Do not attempt async requests in `beforeunload`; they are not guaranteed to complete.

---

### 🔴 Multi-Device Consistency

The app is offline-first with eventual consistency. The rules that make multi-device sync reliable:

- **Creates**: new items use a frontend-generated UUID (`client_id`). API upserts are idempotent on `client_id`. Retrying the same create is safe.
- **Edits**: same `client_id` → API upsert overwrites. Dirty queue ensures the latest local version is pushed on next sync.
- **Deletes**: deleted queue ensures DELETE is eventually sent to the server. Until confirmed, the item is excluded from the local state and from hub cache writes.
- **Bootstrap merge**: server state wins for items not in the dirty queue. Local state wins for items in the dirty queue. This prevents the server from overwriting unsaved local changes.

A delete that only removes the item from local state without sending a DELETE to the server (or queuing it) **will cause the item to reappear** from the server on any other device or on the next bootstrap.

---

### 🔴 Error Handling Standards

- **Never silence API errors on write paths.** Use `console.warn` at minimum, with the module name prefix: `console.warn('[ModuleName] description:', e)`.
- **Distinguish network errors from server errors.** `e.network === true` (set by `apiReq` on fetch failure) means the request may have reached the server. `e.network` absent or false means the server explicitly rejected the request.
  - Network error on write → keep local state, leave dirty, log warning, retry via dirty queue.
  - Server error on write → rollback local state, show user-facing error message.
- **`apiReqRetry`** (used in Saúde and other modules) retries on network errors up to 4 times with backoff (3s, 8s, 15s). Use it for critical writes where the server may be cold-starting (Render free tier).
- **Backend errors must never be swallowed.** The global error handler in `server.ts` handles Zod and Prisma errors. Individual routes should throw or return structured errors, never silently catch.

---

### 🔴 New Module Checklist

When adding a new module, verify all of the following before shipping:

**Storage**
- [ ] All localStorage keys are namespaced with `u_${userId}_` prefix
- [ ] Dirty queue key defined per entity type (`MODULE_ENTITY_dirty_v1`)
- [ ] Deleted queue key defined per entity type (`MODULE_ENTITY_deleted_v1`)
- [ ] `markDirty`, `clearDirty`, `markDeleted`, `clearDeleted` helpers implemented

**Bootstrap**
- [ ] Uses `Promise.allSettled` for parallel fetches
- [ ] Each result null-guarded before use
- [ ] Retry pending DELETEs at bootstrap start
- [ ] Merge server items + local pending (dirty) items
- [ ] Retry dirty items that are not yet on server
- [ ] Respects local dirty flag — does not overwrite unsaved local config/state
- [ ] Calls `_showSyncWarn()` if any endpoint failed
- [ ] Calls `_showLastSync()` after successful bootstrap

**Write operations**
- [ ] `markDirty` called before API call
- [ ] `clearDirty` called on confirmed success
- [ ] No `.catch(()=>null)` on any write path
- [ ] Network errors (`e.network`) do not trigger rollback
- [ ] Server errors do trigger rollback with user-visible message

**Delete operations**
- [ ] `markDeleted` called before API call
- [ ] `clearDeleted` called on confirmed success
- [ ] Delete is retried on next bootstrap
- [ ] Hub cache write (if applicable) filters this module's deleted IDs

**Exit safety**
- [ ] `logoutUser` checks all dirty and deleted queues
- [ ] `logoutUser` shows `confirm()` if any queue non-empty
- [ ] `beforeunload` checks same queues and sets `e.returnValue`

**Backend**
- [ ] All GET routes with `usuario_id` param call `assertUserMatchesQuery(req)`
- [ ] All write routes use `req.userId` from `requireAuth`, not from request body/params
- [ ] Upserts use composite unique key on `(userId, client_id)`

---

### Offline-First Architecture Summary

The app follows an **offline-first, server-wins-except-for-pending-local** pattern:

```
User action
    │
    ▼
markDirty(id)          ← intent persisted before network call
saveLocal()            ← data available immediately, even offline
    │
    ▼
syncToApi(item)
    ├── success → clearDirty(id)         ← confirmed, queue drained
    └── network error → leave dirty      ← retry on next bootstrap
    └── server error → rollback + alert  ← user-visible failure
```

On bootstrap:
```
Fetch server state (Promise.allSettled)
    │
    ├── Retry pending DELETEs
    ├── Merge: server + local dirty
    ├── Retry dirty items not on server
    └── Show _showSyncWarn() if partial failure
        Show _showLastSync() if full success
```

localStorage is written on every local change (write-through). It is read on bootstrap only as a fallback for items not yet confirmed by the server, never as the primary source of truth.

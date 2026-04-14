# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run everything (from repo root):**
```bash
npm run dev          # starts backend (port 4000) + frontend (port 3000) concurrently
npm run kill         # kills processes on ports 3000 and 8888
```

**Backend only (`backend/`):**
```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc → dist/
npm run db:migrate   # run migrations
npm run db:seed      # seed demo data (40 companies, 120 contacts, 80 deals, 300 activities, 4 segments)
```

**Frontend only (`frontend/`):**
```bash
npm run dev          # next dev --turbopack
npm run build        # next build
npm run lint         # next lint
```

**Install all deps (from root):**
```bash
npm run install:all
```

There is no test suite.

## Environment Setup

**Backend** — copy `backend/.env.example` → `backend/.env`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/easycrm
PORT=4000
FRONTEND_URL=http://localhost:3000
```

**Frontend** — copy `frontend/.env.local.example` → `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Apply schema before seeding: `psql -d easycrm -f backend/src/db/schema.sql`

## Architecture

### Monorepo layout
```
easycrm/
  backend/   Express API (TypeScript, port 4000)
  frontend/  Next.js 16 App Router (React 19, port 3000)
```

Root `package.json` only wires concurrently — no workspaces, deps are installed separately in each subdirectory.

### Backend (Express + PostgreSQL)

`backend/src/index.ts` — app entry point. Guards `app.listen()` behind `NODE_ENV !== 'production'` so Vercel can import the express app as a default export without starting a server.

Routes under `backend/src/routes/`: `contacts`, `deals`, `dashboard`, `segments`, `companies`. All routes use `pg` pool directly — no ORM.

**Key services:**
- `backend/src/services/filter-builder.ts` — converts a `FilterParams` object into parameterized SQL `WHERE` and `ORDER BY` fragments. Every filter key maps to an explicit whitelisted column, so there is no dynamic SQL injection risk. `buildContactWhere` / `buildDealWhere` / `buildContactOrderBy` / `buildDealOrderBy` / `parsePagination` are the public API.
- `backend/src/services/export-service.ts` — streams the already-filtered result set as CSV (`csv-stringify`) or Excel (`exceljs`) directly to the response. No secondary query.

Input validation uses Zod at the route layer. The `backend/src/db/schema.sql` defines four PostgreSQL enums (`deal_stage`, `health_status`, `contact_role`, `activity_type`) that are referenced in filter conditions (e.g. `= ANY($1::health_status[])`).

### Frontend (Next.js 16 App Router)

`frontend/next.config.ts` proxies all `/api/*` requests to the backend URL (`NEXT_PUBLIC_API_URL`) so the backend URL is never exposed to the browser.

`frontend/app/providers.tsx` wraps the tree with `QueryClientProvider` (30s stale time, no refetch on window focus). The app is dark-mode only (`<html className="dark">`).

**Filter architecture — the critical pattern:**

`frontend/stores/filter-store.ts` (Zustand + `subscribeWithSelector`) is the single source of truth for all active filter state. Every dashboard widget subscribes here so a single filter change propagates to all views simultaneously. `FilterParams` is shared between the store and the backend's `filter-builder.ts` — they must stay in sync.

- `setFilter(key, value)` — updates one filter key, resets page to 1, clears any active segment
- `applySegment(id, filters)` — replaces filter state from a saved segment
- `selectFilterQueryKey` — stable JSON string used as TanStack Query cache keys

Data fetching is done with TanStack Query hooks. TanStack Table + Virtual handles the data table. Recharts handles charts.

### Vercel deployment

The backend has a `vercel.json`. In production the frontend's `/api/*` rewrite points to the deployed backend. The express `app.listen()` guard (`NODE_ENV !== 'production'`) is what makes the backend work on Vercel — do not remove it.

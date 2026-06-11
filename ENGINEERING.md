# Fila — Engineering Documentation

**Last updated:** June 2026  
**Repo:** `github.com/rbertler/Get-fila` (private)  
**Live app:** `https://get-fila.vercel.app`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Infrastructure](#infrastructure)
3. [Local Development Setup](#local-development-setup)
4. [Codebase Structure](#codebase-structure)
5. [Key Features & How They Work](#key-features--how-they-work)
6. [Database Schema](#database-schema)
7. [Environment Variables](#environment-variables)
8. [Commit → Push → Deploy Workflow](#commit--push--deploy-workflow)
9. [Demo Accounts](#demo-accounts)
10. [Known Technical Debt & Future Priorities](#known-technical-debt--future-priorities)
11. [Critical Rules (Do Not Skip)](#critical-rules-do-not-skip)

---

## Architecture Overview

```
┌─────────────────────────────┐
│  Client (React + TypeScript) │  ← Vercel  (get-fila.vercel.app)
│  Vite build tool             │
│  Radix UI + Tailwind CSS     │
└────────────┬────────────────┘
             │ HTTPS + HttpOnly cookie (JWT)
┌────────────▼────────────────┐
│  API Server (Express + TS)   │  ← Render  (get-fila.onrender.com)
│  Prisma ORM                  │
│  Claude Haiku (AI extract)   │
└────────────┬────────────────┘
             │ DATABASE_URL (PostgreSQL)
┌────────────▼────────────────┐
│  Database (PostgreSQL)       │  ← Supabase
└─────────────────────────────┘
```

**Authentication:** JWT signed with `JWT_SECRET`, stored in an HttpOnly cookie. In production the cookie uses `SameSite=None; Secure` to work across origins (Vercel ↔ Render).

**AI extraction:** Claude Haiku (`claude-haiku-3-5-20241022` via `@anthropic-ai/sdk`) is called synchronously during file upload to extract structured medical data from PDFs and images.

**File storage:** Files are stored on Render's local disk at `server/uploads/`, named with UUIDs. These are ephemeral on Render's free tier — files are lost on redeploy. (Migration to Supabase Storage or S3 is a future priority.)

---

## Infrastructure

| Service | Provider | Tier | URL / Config |
|---------|----------|------|-------------|
| Frontend | Vercel | Free | `get-fila.vercel.app` |
| API server | Render | Free | `get-fila.onrender.com` |
| Database | Supabase | Free | Project: `fila-health` |

### Vercel (Frontend)
- Auto-deploys from `main` branch on every push.
- Build command: `npm run build` (runs from `client/` root directory).
- No server-side config needed beyond the one env var (`VITE_API_URL`), which is baked into the bundle at build time via `client/.env.production`.

### Render (API Server)
- Auto-deploys from `main` branch on every push.
- Root directory: `server`
- Build command: `npm install --include=dev && npx prisma generate && npm run build`
  - `--include=dev` is required because `@types/*` packages are in devDependencies and TypeScript needs them at compile time.
  - `prisma generate` creates the Prisma client for the Linux target.
- Start command: `node dist/index.js`
- Free tier sleeps after 15 minutes of inactivity — first request takes ~30 seconds to cold-start.

### Supabase (Database)
- PostgreSQL hosted in `us-east-2`.
- Schema is managed via `prisma db push` (no migration files — see critical rules).
- **Connection strings — use the session pooler for all schema changes:**
  - Session pooler (port **5432**): `aws-1-us-east-2.pooler.supabase.com:5432` — use this for `prisma db push` and any DDL.
  - Transaction pooler (port **6543**): `aws-1-us-east-2.pooler.supabase.com:6543` — this hangs on schema changes; use only for regular queries if needed.
- The `DATABASE_URL` env var on Render uses the transaction pooler (port 6543) for runtime queries.

---

## Local Development Setup

### Prerequisites
- Node.js ≥ 20
- npm ≥ 10
- PostgreSQL (local) **or** a Supabase connection string

### Steps

```bash
# 1. Clone
git clone https://github.com/rbertler/Get-fila.git
cd Get-fila

# 2. Install server dependencies
cd server && npm install && cd ..

# 3. Install client dependencies
cd client && npm install && cd ..

# 4. Create server env file
cp server/.env.example server/.env   # if example exists, otherwise create manually
# Minimum required vars (see Environment Variables section below)

# 5. Generate Prisma client
cd server && npx prisma generate && cd ..

# 6. Push schema to database (local only — see Critical Rules before running on prod)
cd server && npx prisma db push && cd ..

# 7. Seed demo data (optional)
cd server && npx ts-node prisma/seed.ts && cd ..

# 8. Start the server (port 3001)
cd server && npm run dev

# 9. In a separate terminal, start the client (port 5173)
cd client && npm run dev
```

App is now running at `http://localhost:5173`.

---

## Codebase Structure

```
Get-fila/
├── client/                     # React frontend
│   ├── src/
│   │   ├── api/
│   │   │   └── client.ts       # Base API client; reads VITE_API_URL
│   │   ├── components/
│   │   │   └── ui/             # Radix/shadcn components
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx # Auth state + useAuth() hook
│   │   └── pages/
│   │       ├── Login.tsx
│   │       ├── Signup.tsx
│   │       ├── Dashboard.tsx
│   │       ├── Records.tsx          # File upload + document list
│   │       ├── LabsVitals.tsx       # Lab results + vitals charting
│   │       ├── Medications.tsx      # Medications + supplements
│   │       ├── History.tsx          # Medical history (conditions, allergies, etc.)
│   │       ├── Appointments.tsx
│   │       ├── ProviderDirectory.tsx
│   │       ├── HealthIntelligence.tsx  # AI-generated health insights
│   │       ├── Share.tsx
│   │       └── SharedView.tsx       # Public share link view
│   ├── .env.production         # VITE_API_URL=https://get-fila.onrender.com
│   └── vite.config.ts
│
├── server/                     # Express API
│   ├── src/
│   │   ├── index.ts            # App entry point; CORS, rate limiting, route mounting
│   │   ├── middleware/
│   │   │   └── auth.ts         # requireAuth middleware; validates JWT cookie
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /signup, /login, /logout; GET /me
│   │   │   ├── records.ts      # File upload, list, delete medical records
│   │   │   ├── history.ts      # CRUD for medical history entries
│   │   │   ├── appointments.ts # CRUD for appointments
│   │   │   ├── labs.ts         # CRUD for lab results + vitals
│   │   │   ├── insights.ts     # AI insight report generation
│   │   │   ├── providers.ts    # CRUD for provider directory
│   │   │   ├── dashboard.ts    # Aggregated dashboard data
│   │   │   ├── share.ts        # Share token creation + public view
│   │   │   └── google.ts       # Google OAuth + Calendar/Gmail sync
│   │   ├── services/
│   │   │   ├── aiExtractor.ts       # Core AI extraction logic (Claude Haiku)
│   │   │   ├── recordExtractor.ts   # Orchestrates extraction per record type
│   │   │   ├── pdfParser.ts         # Extracts raw text from PDF files
│   │   │   ├── insightGenerator.ts  # Generates health insight reports
│   │   │   ├── insightPdfGenerator.ts # Renders insight reports to PDF
│   │   │   ├── reportGenerator.ts   # Generates shareable PDF reports
│   │   │   ├── storage.ts           # File read/write to disk
│   │   │   ├── googleAuth.ts        # Google OAuth token handling
│   │   │   ├── googleCalendar.ts    # Google Calendar event sync
│   │   │   └── gmail.ts             # Gmail appointment extraction
│   │   └── utils/
│   │       └── prisma.ts       # Shared Prisma client singleton
│   └── package.json
│
├── prisma/
│   └── schema.prisma           # Single source of truth for DB schema
│
└── ENGINEERING.md              # This file
```

### API Route Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Log in, sets JWT cookie |
| POST | `/api/auth/logout` | Clear cookie |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/records` | List medical records |
| POST | `/api/records/upload` | Upload file → AI extract → save |
| DELETE | `/api/records/:id` | Delete record |
| GET | `/api/history` | List history entries |
| POST | `/api/history` | Add entry |
| PUT | `/api/history/:id` | Update entry |
| DELETE | `/api/history/:id` | Delete entry |
| GET | `/api/labs` | List lab results + vitals |
| POST | `/api/labs` | Add lab result |
| DELETE | `/api/labs/:id` | Delete lab result |
| GET | `/api/appointments` | List appointments |
| POST | `/api/appointments` | Add appointment |
| PUT | `/api/appointments/:id` | Update appointment |
| DELETE | `/api/appointments/:id` | Delete appointment |
| GET | `/api/providers` | List providers |
| POST | `/api/providers` | Add provider |
| PUT | `/api/providers/:id` | Update provider |
| DELETE | `/api/providers/:id` | Delete/archive provider |
| GET | `/api/dashboard` | Aggregated home data |
| POST | `/api/insights/generate` | Generate AI health insight report |
| GET | `/api/insights` | List past reports |
| POST | `/api/share` | Create share token |
| GET | `/api/share/:token` | Get shared data (public, no auth) |
| GET | `/api/google/auth-url` | Get Google OAuth URL |
| GET | `/api/google/callback` | OAuth callback |
| POST | `/api/google/sync` | Sync Calendar + Gmail |
| GET | `/health` | Server health check |

---

## Key Features & How They Work

### File Upload + AI Extraction
1. User uploads a PDF or image via `Records.tsx`.
2. `POST /api/records/upload` receives the file via `multer`, saves it to `server/uploads/` with a UUID filename.
3. `pdfParser.ts` extracts raw text from PDFs using `pdf-parse`.
4. `aiExtractor.ts` sends the text to Claude Haiku with a structured prompt.
5. Claude returns JSON containing: lab results, medications, conditions, providers, appointments, imaging studies, and vitals.
6. Each extracted item is saved to its respective Prisma model.
7. A `SyncIgnoreItem` record tracks any items the user has explicitly deleted, so re-uploading the same document doesn't recreate them.

### Provider Name Display
Providers are either **individuals** or **organizations**. The distinction is detected by `isOrgProvider()` in `ProviderDirectory.tsx`:
- If the provider's name matches the affiliation (same person, different format), it's treated as an org.
- If both name and affiliation contain organization keywords (hospital, clinic, medical group, etc.), it's an org.
- **Org:** displayed by natural name (e.g., "Function Health").
- **Individual:** displayed as "Last, First, Credential" in list view; "First Last, Credential" in detail view.

### Authentication Flow
- Signup/login sets a signed JWT in an HttpOnly cookie.
- Every subsequent API request sends the cookie automatically.
- `requireAuth` middleware in `server/src/middleware/auth.ts` validates the JWT and attaches `userId` to the request.
- Cookie settings: `SameSite=None; Secure` in production (required for cross-origin Vercel ↔ Render), `SameSite=lax` in development.

### Google Integration
- Users connect Google via OAuth 2.0 in settings.
- `POST /api/google/sync` pulls upcoming Calendar events and scans Gmail for appointment-related emails.
- Extracted appointments are saved; duplicates are detected by `googleEventId`.

### Health Intelligence (AI Insights)
- `POST /api/insights/generate` gathers recent labs, vitals, history, and medications for the user.
- Sends all data to Claude with a structured prompt requesting health insights, gaps, and recommendations.
- Result is saved as a `HealthInsightReport` and can be exported as a PDF.

### Share Links
- User configures what data to include, clicks Share.
- Server generates a unique token, stores it in `ShareToken` with an expiry and config.
- Anyone with the link (`/share/:token`) can view a read-only version — no login required.

---

## Database Schema

Schema is defined in `prisma/schema.prisma`. Key models:

| Model | Purpose |
|-------|---------|
| `User` | Account, credentials, Google tokens |
| `MedicalRecord` | Uploaded files metadata |
| `MedicalHistoryEntry` | Conditions, medications, supplements, allergies, surgeries, vaccinations, family history |
| `LabResult` | Individual lab test values |
| `Vital` | Weight, BP, heart rate, glucose, etc. |
| `Appointment` | Calendar appointments (manual or Google-synced) |
| `Provider` | Provider directory entries |
| `ImagingStudy` | X-rays, MRIs, CTs, etc. |
| `HealthInsightReport` | Generated AI insight reports |
| `ShareToken` | Public share link tokens |
| `SyncIgnoreItem` | Tracks user-deleted auto-extracted items to prevent re-creation on re-upload |

All user-owned models have `onDelete: Cascade` — deleting a user removes all their data.

22 database indexes are defined for performance: every model has `@@index([userId])` at minimum, plus compound indexes on frequently filtered fields (e.g., `[userId, recordedAt]`, `[userId, category]`).

---

## Environment Variables

### Server (`server/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWTs (use a long random string) |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key for AI extraction and insights |
| `NODE_ENV` | ✅ | `development` or `production` |
| `SUPABASE_URL` | ✅ prod | Supabase project URL (dashboard → Project Settings → API). Required in production: uploaded files go to Supabase Storage. When unset, files fall back to local disk (`UPLOAD_DIR`) — fine locally, but Render's disk is ephemeral and wipes on every deploy/restart. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ prod | Supabase service role key (same page). Server-side only — never expose to the client. |
| `SUPABASE_STORAGE_BUCKET` | — | Storage bucket name (default: `records`; created automatically) |
| `UPLOAD_DIR` | — | Local-disk fallback directory (default: `./uploads`) |
| `PORT` | — | Server port (Render sets this automatically; defaults to 3001) |
| `JWT_EXPIRES_IN` | — | Token expiry, e.g. `7d` (default: `7d`) |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID (required for Google sync) |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | — | OAuth callback URL |
| `CLIENT_URL` | — | Extra allowed CORS origin (optional override) |

### Client (`client/.env.production`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | API base URL, e.g. `https://get-fila.onrender.com` |

For local development, `VITE_API_URL` is unset so the client defaults to an empty string (relative path), hitting the local Express server via Vite's dev proxy or direct URL.

---

## Commit → Push → Deploy Workflow

All deployments are triggered automatically by pushing to `main`. There is no manual deploy step.

```bash
# 1. Make changes locally

# 2. Stage and commit
git add <files>
git commit -m "describe what changed"

# 3. Push to main
git push origin main
```

After push:
- **Vercel** detects the push, rebuilds the frontend (`npm run build` in `client/`), and deploys within ~1–2 minutes.
- **Render** detects the push, runs the build command, and deploys within ~3–5 minutes.

### Checking Deploy Status
- Vercel: `https://vercel.com/rbertler/get-fila` → Deployments tab
- Render: `https://dashboard.render.com` → `get-fila` service → Logs

### Schema Changes (Database)
If `prisma/schema.prisma` changes (new model, new field, new index):

```bash
# From the project root, with the PRODUCTION DATABASE_URL set in your shell:
# Use the SESSION POOLER connection string (port 5432 — NOT 6543)
DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-1-us-east-2.pooler.supabase.com:5432/postgres' \
  npx prisma db push

# Then commit and push the schema file
git add prisma/schema.prisma
git commit -m "schema: add X field to Y model"
git push origin main
```

⚠️ **See Critical Rules below before running `db push`.**

---

## Demo Accounts

These accounts exist in the production Supabase database for investor/demo use.

| Email | Password | Notes |
|-------|----------|-------|
| `derek@demo.fila.health` | `demo1234` | Primary demo account |
| `jordan@demo.fila.health` | `demo1234` | Secondary demo |
| `maggie@demo.fila.health` | `demo1234` | Secondary demo |

To reset or re-seed demo data, run the seed script against the production database (requires `DATABASE_URL` with session pooler):
```bash
DATABASE_URL='...' npx ts-node prisma/seed.ts
```

---

## Known Technical Debt & Future Priorities

### High Priority

| Issue | Detail |
|-------|--------|
| **File storage is ephemeral** | Files saved to `server/uploads/` on Render's disk are wiped on every redeploy. Migrate to Supabase Storage or AWS S3. |
| **AI extraction is synchronous** | Claude API is called during the upload request, blocking the response for 5–15 seconds. Move to a background job queue (e.g., BullMQ + Redis, or Render's background workers). |
| **No pagination** | List endpoints return all records. As users accumulate data, this will slow down. Add `cursor`-based or `page`/`limit` pagination to `/api/labs`, `/api/history`, `/api/records`, etc. |
| **No error handling on routes** | Most route handlers have no `try/catch`. Unhandled promise rejections crash the process. Wrap handlers in a global async error handler. |

### Medium Priority

| Issue | Detail |
|-------|--------|
| **Google sync is synchronous** | `/api/google/sync` fetches and processes Calendar + Gmail inline. Should be a background job. |
| **No test suite** | Zero automated tests. Add unit tests for AI extraction logic and integration tests for auth + core routes. |
| **Large component files** | `LabsVitals.tsx` and `ProviderDirectory.tsx` are large. Split into smaller components. |
| **No request validation on most routes** | Only `auth.ts` uses Zod schema validation. Other routes access `req.body` directly. |

### Low Priority / Nice to Have

| Issue | Detail |
|-------|--------|
| **Render free tier cold starts** | Free tier sleeps after 15 min; first request is slow. Upgrade to paid, or add a keep-alive ping. |
| **No logging service** | Errors only go to `console.error`. Add structured logging (e.g., Pino) and a log drain. |
| **No monitoring/alerting** | No uptime monitoring. Add a simple check (e.g., Better Uptime pinging `/health`). |

---

## Critical Rules (Do Not Skip)

1. **Never run `prisma db push` or `prisma migrate` without explicit confirmation from the product owner.** These commands can drop columns or tables if the schema has changed in a destructive way, wiping real user data. Always confirm what the diff is before running.

2. **Never run schema commands against production using the transaction pooler (port 6543).** It hangs silently. Always use the session pooler (port 5432) for DDL operations.

3. **`client/.env.production` is force-committed** (it's gitignored but was added with `git add -f`). It contains the production API URL. Do not remove it from git tracking or Vercel builds will break.

4. **The Prisma client output path is non-standard.** It outputs to `server/node_modules/.prisma/client` (not the project root). This is intentional so the compiled server can find it at runtime. Do not change the `output` field in `prisma/schema.prisma` without updating the server's Prisma import paths.

5. **CORS is an explicit allowlist.** If the frontend URL changes (e.g., a new Vercel preview domain needs permanent access), add it to `allowedOrigins` in `server/src/index.ts`.

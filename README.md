# Fila

A patient health intelligence platform designed to prevent misdiagnoses by centralizing fragmented medical data across providers.

## Prerequisites

- Node.js 20+ and npm
- PostgreSQL 14+
- (Optional) Google Cloud project with Calendar + Gmail APIs enabled

## Local Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd fila
npm install       # installs root concurrently
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
# Server
cp server/.env.example server/.env
# Edit server/.env — set DATABASE_URL and a strong JWT_SECRET

# Client (no changes needed for local dev — uses Vite proxy)
cp client/.env.example client/.env
```

### 3. Set up the database

```bash
# Create the database
createdb fila

# Run migrations
cd server
npx prisma generate --schema=../prisma/schema.prisma
npx prisma migrate dev --schema=../prisma/schema.prisma --name init

# Seed demo data
npm run db:seed
```

### 4. Run the app

```bash
# From the repo root:
npm run dev

# Or separately:
cd server && npm run dev    # API on http://localhost:3001
cd client && npm run dev    # UI on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

## Demo Accounts

| Email | Password | Description |
|---|---|---|
| sarah@demo.fila.health | demo1234 | Sarah Chen — hypothyroidism, iron deficiency, improving labs |
| marcus@demo.fila.health | demo1234 | Marcus Johnson — type 2 diabetes, hypertension, sleep apnea |

Both accounts include pre-populated records, appointments, labs, vitals, history entries, and one pre-generated insight report each.

## Google Calendar & Gmail Integration (Optional)

The app works fully without Google OAuth. If you want to enable calendar/email sync:

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (e.g., "Fila Dev")
3. Enable the **Google Calendar API** and **Gmail API**
4. Go to **APIs & Services → Credentials**
5. Create an **OAuth 2.0 Client ID** (type: Web application)
6. Add `http://localhost:3001/api/google/callback` as an authorized redirect URI
7. Copy the Client ID and Client Secret

### 2. Configure the server

Add to `server/.env`:
```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/api/google/callback
```

### 3. Test the integration

- Log in → go to **Appointments**
- Click **Connect Google**
- Authorize the app
- Use the **Calendar** and **Gmail** sync buttons

If `GOOGLE_CLIENT_ID` is not set, the UI shows "Not configured" instead of a connect button, and the rest of the app works normally.

## Feature Tour

| Feature | How to demo |
|---|---|
| **PDF Records** | Records → drag a PDF onto the upload zone → see extracted text and type badge |
| **Health History** | History → Add Entry → fill in any category |
| **Appointments** | Appointments → Add Appointment → fill in provider details |
| **Labs & Vitals** | Labs & Vitals → Record a Vital or Add Lab Result → see trend chart |
| **Health Intelligence** | Insights → view pre-generated report for demo accounts |
| **Share** | Share → select items → Generate share link → open the link in incognito |
| **Apple Health** | Labs & Vitals → Apple Health → paste the sample JSON below |

### Sample Apple Health Import JSON

```json
{
  "data": [
    { "type": "heart_rate", "value": 68, "unit": "bpm", "startDate": "2024-11-01" },
    { "type": "heart_rate", "value": 72, "unit": "bpm", "startDate": "2024-11-08" },
    { "type": "weight", "value": 142, "unit": "lbs", "startDate": "2024-11-01" },
    { "type": "steps", "value": 8432, "unit": "steps", "startDate": "2024-11-01" },
    { "type": "sleep", "value": 7.2, "unit": "hours", "startDate": "2024-11-01" }
  ]
}
```

## Project Structure

```
fila/
├── client/               React + TypeScript + Tailwind frontend
│   └── src/
│       ├── api/          Typed API client
│       ├── components/   UI primitives + layout
│       ├── hooks/        useAuth, useToast
│       ├── pages/        One file per route
│       └── types/        Shared TypeScript types
├── server/               Express + TypeScript backend
│   └── src/
│       ├── middleware/   JWT auth middleware
│       ├── routes/       REST API routes
│       ├── services/     Storage, PDF parsing, Google APIs
│       └── utils/        Prisma client, config
└── prisma/
    ├── schema.prisma     Database schema
    └── seed.ts           Demo data
```

## Architecture Notes

- **Auth:** JWT stored in httpOnly cookies, bcrypt password hashing (12 rounds)
- **File storage:** Abstracted behind `services/storage.ts` — swap `saveFile`/`readFile` to use S3 without changing routes
- **PDF parsing:** Server-side only via `pdf-parse`, API key never exposed to frontend
- **AI insights:** Wired up via Anthropic SDK in `server/src/services/insightGenerator.ts`
- **Google OAuth:** Gracefully degrades — UI shows "Not configured" if env vars are missing

## Health Intelligence

The AI feature uses the Anthropic SDK to generate plain-language health summaries. To configure:

1. Add `ANTHROPIC_API_KEY=sk-ant-...` to `server/.env`
2. The frontend `HealthIntelligence.tsx` renders the report automatically

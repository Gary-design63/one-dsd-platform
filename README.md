# One DSD Equity Program Platform

Minnesota Department of Human Services — Disability Services Division  
Built by Gary Banks, Equity and Inclusion Operations Consultant

## Deploy in 3 minutes

### Option 1: Railway (Recommended)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Add environment variable: `ANTHROPIC_API_KEY` = your key
5. Done — Railway gives you a public URL instantly

### Option 2: Render
1. Push to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect GitHub repo
4. Add `ANTHROPIC_API_KEY` env var
5. Deploy

### Option 3: Local
```bash
npm install
ANTHROPIC_API_KEY=your-key node server.js
# Open http://localhost:5000
```

## Features
- **Research Coordination** — AI-powered equity research synthesis using Claude
- **Consultations** — 3-gate triage system for staff equity requests
- **DEAI Activity Log** — Auto-classification of diversity activities
- **KPI Dashboard** — Performance tracking with disparity alerts
- **Document Knowledge Base** — Searchable equity resources
- **Community Feedback** — Anonymous submission and review workflow
- **Audit Log** — Full governance traceability
- **Reports** — AI-written executive summaries

## Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (for AI) | Claude API key |
| `JWT_SECRET` | Recommended | Auth token secret |
| `PORT` | No | Server port (default 5000) |

## Tech Stack
- **Frontend**: React + Vite + Tailwind (pre-built)
- **Backend**: Express 5 + Node.js
- **Database**: SQLite via sql.js (zero native deps)
- **AI**: Anthropic Claude (claude-sonnet-4-20250514)

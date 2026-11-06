# Leave Management System

A fast, free web app for leave requests and approvals. It replaces the Google Form + Google Sheet + Apps Script system.

- **Frontend:** plain HTML, CSS and JavaScript modules (no build step) in `public/`
- **Backend:** Cloudflare Pages Functions (`functions/` → `src/server/`)
- **Database:** Cloudflare D1 (SQLite), tables in `migrations/`
- **Email:** Resend (free plan)
- **Hosting:** Cloudflare Pages, deployed automatically from GitHub

## Quick start (on your laptop)

```bash
npm install
npx wrangler login
npx wrangler d1 create able-leave-db          # copy the database_id into wrangler.toml
npm run db:migrate:local
copy .dev.vars.example .dev.vars          # optional: add RESEND_API_KEY
npm run dev                               # open http://localhost:8788
```

**Read [GUIDE.md](GUIDE.md)** for every step: installing the tools, running locally, putting the code on GitHub, deploying to Cloudflare, setting up email, moving the Google Sheet data, using the system, backups and troubleshooting.

## Folder structure

```
Leave Management System/
├── public/                 Frontend (served as static files)
│   ├── index.html
│   ├── _headers            Security headers
│   ├── css/styles.css
│   └── js/
│       ├── app.js          Start, navigation, router
│       ├── api.js          Calls to /api
│       ├── ui.js           Dialogs, tables, toasts, helpers
│       ├── components/     Shared pieces (balance, request lists)
│       └── pages/          One file per page
├── functions/api/[[path]].js   Sends every /api/* request to the router
├── src/server/             Backend
│   ├── app.js              Router: session + permission check
│   ├── auth.js             Passwords and sessions
│   ├── leave.js            Leave rules, balances, requests, decisions
│   ├── email.js            Email sending + templates
│   ├── permissions.js      Roles and permissions
│   ├── settings.js         Company settings
│   └── routes/             API endpoints
├── migrations/             Database tables + starting data
├── scripts/import-sheet.mjs    Moves the old Google Sheet data in
├── wrangler.toml           Cloudflare settings
└── GUIDE.md                Full guide
```

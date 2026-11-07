# Google Sheet backup for the Leave and Shift Management System

A Google Sheet that holds a copy of everything in the system, **one tab per page**, kept up to date automatically.
It uses a small Google Apps Script (`Code.gs`). No Google Cloud is needed.

```
System (Cloudflare)  ──sends all data + secret key──►  Apps Script web app  ──►  writes the tabs of THIS Google Sheet
```

**Tabs:** Employees · Departments · Login Accounts · Leave Requests · WFH Requests · Leave Summary · Leave Settings · Holidays · Settings · Sync Log.
Passwords, sessions and photos are never sent.

## Setup (about 5 minutes)

1. In Google Drive create a new Google Sheet, e.g. **"Able Leave System – Backup"**.
2. **Extensions → Apps Script**. Delete the sample code and paste everything from `google_backup/Code.gs`. Save.
3. Choose **`setup`** next to **Run** and click **Run**. Allow the permissions
   (**Advanced → Go to … (unsafe) → Allow** - "unsafe" only means Google has not reviewed your own script).
   The **Execution log** shows the **secret key**. Copy it. (Lost it? Run **`showSecret`**.)
4. **Deploy → New deployment** → gear ⚙ → **Web app**:
   **Execute as: Me** · **Who has access: Anyone** → **Deploy** → copy the **Web app URL** (ends with `/exec`).
5. In the system: **Settings → General → Google Sheet Backup** → paste the **Web app URL** and the **secret key** → **First-time sync**.

Done. From now on every change in the system (employees, requests, approvals, holidays, settings…) updates the sheet automatically.
**Sync now** sends everything again at any time. Every sync is written in the **Sync Log** tab.

## Use another Google Sheet

Do steps 1–5 with the new sheet and press **First-time sync** again. The system then syncs with the new sheet.

## Changed the script?

**Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.** The link stays the same.

## Troubleshooting

| Message | Fix |
|---|---|
| "did not answer (401 / 404)" | The link must end with `/exec`, and **Who has access** must be **Anyone** |
| "Wrong secret key" | Paste the key from `setup` / `showSecret` again |
| "Another sync is running" | Wait a few seconds and press **Sync now** |

# Google email service for the Leave System

This folder holds a small **Google Apps Script** (attached to a Google Sheet) that sends the Leave System's emails with **Gmail**. It's free and needs no other email company.

```
Leave System (Cloudflare)  ──POST + secret key──►  Apps Script web app  ──►  Gmail sends the email
                                                          └─► one row in the "Email Log" sheet
```

**What gets emailed**

| When | Email to |
|---|---|
| An employee requests leave (leave request app) | Every **head** of that department, with **Approve / Reject** buttons |
| The same moment | The **employee**: "Leave request received" |
| A head approves / rejects / cancels | The **employee**, with the decision and their new balance |

Phone notifications keep working too.

**Free limits (set by Google)**

| Google account that owns the sheet | Emails per day |
|---|---|
| Normal Gmail (`@gmail.com`) | about **100** |
| Google Workspace (for example `leave@company.com`, if the company uses Google Workspace) | about **1,500** |

Emails are sent **from the Google account that owns the sheet**. Use a company account (for example `hr@company.com` or `leave@company.com`), not a personal one.

---

## Files

| File | What it is |
|---|---|
| `Code.gs` | The whole script: receives emails from the Leave System, sends them, logs them |
| `GUIDE.md` | This guide |

---

## Setup (about 10 minutes, one time)

### 1. Create the Google Sheet
1. Sign in to Google with the **account the emails should come from**.
2. Open https://sheets.new to create a new sheet, and name it **"Leave System – Emails"**.

### 2. Add the script
1. In the sheet, open **Extensions → Apps Script**.
2. Delete the sample code in `Code.gs` and paste **everything** from `google_email_services/Code.gs`.
3. Click **Save** (the disk icon). You can rename the project to "Leave Email Service".

### 3. Run setup once
1. Next to **Run**, choose **`setup`** and click **Run**.
2. Google asks for permission: **Review permissions → choose the account → Advanced → Go to Leave Email Service (unsafe) → Allow**. "Unsafe" only means Google hasn't reviewed your own script. It asks to send email as you and edit this sheet.
3. Open the **Execution log** (bottom of the screen). It shows the **secret key**. Copy it. You also get a test email, and the sheet now has an **"Email Log"** tab.

(Lost the key? Run **`showSecret`**.)

### 4. Publish it as a web app
1. Click **Deploy → New deployment**.
2. Click the gear ⚙ next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `Leave email service`
   - **Execute as: Me** (your account)
   - **Who has access: Anyone** (the secret key protects it; without the key it sends nothing)
4. Click **Deploy** and copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy..../exec`.
5. Optional check: open that URL in a browser. You should see `{"ok":true,"service":"Leave System email",...}`.

### 5. Connect the Leave System (Cloudflare)
1. Open https://dash.cloudflare.com, then the **able-leave-system** Pages project → **Settings → Variables and Secrets**.
2. **Add** → type **Secret** → name `GOOGLE_MAIL_URL` → value: the Web app URL → **Save**.
3. **Add** → type **Secret** → name `GOOGLE_MAIL_SECRET` → value: the secret key → **Save**.
4. Go to **Deployments**, open the latest one, choose **⋯ → Retry deployment**, and wait about 1 minute.

### 6. Set the sender name and test
1. In the Leave System, go to **Settings → General → Email sender**, enter for example `Company Leave <leave@company.com>`, and **Save settings**. Gmail uses the **name** part ("Company Leave"); the address is always the sheet owner's Google account.
2. The top of Settings now says **"Email is on (Google (Gmail))"**.
3. Click **Send test email**. The email arrives in your inbox, and a row appears in the sheet's **Email Log**.

Done. From now on, every leave request and decision is emailed.

---

## Day to day

- **Email Log sheet:** shows every email (time, to, subject, **Sent** or **FAILED** + reason). It keeps the last 5,000 rows.
- **Request notes:** each request's System notes in the Leave System also say "email sent to …" or why not.
- **Daily limit reached:** the log says *Daily Gmail limit reached*. Phone notifications still work, and emails start again the next day.
- **Changed the script?** Use **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**. The URL stays the same.
- **Changing the Google account:** do steps 1–6 again with the new account, and update both Cloudflare secrets.

## Troubleshooting

| Problem | Fix |
|---|---|
| Settings says "Email is off" | Both secrets must be added in Cloudflare, then **Retry deployment** |
| Test email: "Google: Wrong secret" | `GOOGLE_MAIL_SECRET` is not the same as the key from `setup` / `showSecret` |
| Test email: "Google: 401" or an HTML page | The web app isn't set to **Who has access: Anyone**. Edit the deployment |
| Test email: "Google: 404" | The Web app URL is wrong. It must end with `/exec` |
| Emails go to spam | Send from a company Google Workspace account, and ask receivers to mark it "Not spam" once |
| You used Brevo before | Google is used first when its two secrets are set; Brevo / Resend are only used if they aren't |

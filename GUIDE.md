# Leave Management System: Complete Guide

This guide covers everything, step by step, from an empty laptop to a live system your staff can use.

| Part | What |
|---|---|
| [1](#1-what-this-system-is) | What this system is |
| [2](#2-install-the-tools-one-time) | Install the tools (one time) |
| [3](#3-run-the-app-on-your-laptop) | Run the app on your laptop |
| [4](#4-put-the-code-on-github) | Put the code on GitHub |
| [5](#5-deploy-to-cloudflare-pages) | Deploy to Cloudflare Pages (free) |
| [6](#6-set-up-email-resend) | Set up email (Resend) |
| [7](#7-first-time-setup-of-the-live-system) | First-time setup of the live system |
| [8](#8-move-the-data-from-the-google-sheet) | Move the data from the Google Sheet |
| [9](#9-how-to-use-the-system) | How to use the system (every role) |
| [10](#10-leave-rules-reference) | Leave rules reference |
| [11](#11-making-changes-later) | Making changes later (develop → deploy) |
| [12](#12-backups-and-restore) | Backups and restore |
| [13](#13-custom-domain-optional) | Custom domain (optional) |
| [14](#14-free-plan-limits) | Free plan limits |
| [15](#15-troubleshooting) | Troubleshooting |
| [16](#16-security-notes) | Security notes |

---

## 1. What this system is

| Old system | New system |
|---|---|
| Google Form to request leave | **Apply for leave** page in the app |
| Google Sheet tabs (Settings, Departments, Employees, Leave_Requests) | Cloudflare **D1 database** (fast SQL database) |
| Apps Script web app (slow) | **Cloudflare Pages Functions** (runs close to the user, usually under 100 ms) |
| Gmail emails with Approve / Reject buttons | Same emails through **Resend**, with Approve / Reject buttons |
| Leave_Register / Leave_Summary sheets | **Team balances**, **Calendar** and **Reports** pages |

**How a request flows**

1. The employee signs in and fills **Apply for leave** (one day, days in a row, or separate dates; half day for types that allow it; short leave with out and return times).
2. The server checks the request: working days (weekends and holidays are not counted), past dates, the same days asked twice, and the balance (approved + pending).
3. The request is saved as **Pending** with a number like `R26Oct001`.
4. **Every head of the employee's department** gets an email in the style of the paper form, with **Approve / Reject** buttons. If the department has no head, the admins get it. The employee gets a "received" copy.
5. A head approves or rejects, either from the email or in the app (**Approvals** page). The first decision counts.
6. The employee gets an email with the decision and their new balance. Approved and cancelled leave can also be copied to HR (Settings → Copy emails).

**Roles** (you can change what each role can do in **Access control**)

| Role | Default access |
|---|---|
| **Super admin** | Everything, including Access control. Created at first setup. |
| **Admin** | All departments: approvals, requests, reports, employees, departments, accounts, settings |
| **Department head** | Their department(s): approvals, requests, cancel approved leave, team balances, reports, calendar |
| **Employee** | Own balance and requests, apply for leave, calendar of own department |

---

## 2. Install the tools (one time)

You need four free things. Install them in this order.

### 2.1 Node.js (runs the developer tools)
1. Open https://nodejs.org and download the **LTS** version for Windows.
2. Run the installer and keep all the default options.
3. **Close and reopen VS Code** after installing.
4. Check it in the VS Code terminal (menu **Terminal → New Terminal**):
   ```powershell
   node -v
   npm -v
   ```
   Both should print a version number (for example `v22.x` and `10.x`).

> If PowerShell says *"running scripts is disabled on this system"* when you run `npm`, run this once and answer **Y**:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 2.2 Git (saves your code and sends it to GitHub)
1. Open https://git-scm.com/download/win and install with the default options.
2. Reopen VS Code and check:
   ```powershell
   git --version
   ```
3. Tell Git who you are (one time):
   ```powershell
   git config --global user.name "Your Name"
   git config --global user.email "you@company.com"
   ```

### 2.3 Accounts (all free)
- **GitHub**: https://github.com/signup
- **Cloudflare**: https://dash.cloudflare.com/sign-up
- **Resend** (email): https://resend.com/signup (you can do this later, in part 6)

### 2.4 VS Code extensions (optional, helpful)
- **SQLite Viewer**: view the local database file
- **Prettier**: tidy code formatting

---

## 3. Run the app on your laptop

Open the **Leave Management System** folder in VS Code (**File → Open Folder**), then open a terminal (**Terminal → New Terminal**).

### 3.1 Install the project tools
```powershell
npm install
```
This downloads **Wrangler** (Cloudflare's tool) into `node_modules/`. It takes about a minute.

### 3.2 Sign in to Cloudflare from the terminal
```powershell
npx wrangler login
```
A browser window opens. Click **Allow**.

### 3.3 Create the database
```powershell
npx wrangler d1 create able-leave-db
```
It prints something like this:
```
database_name = "able-leave-db"
database_id = "1a2b3c4d-...."
```
Open **wrangler.toml** and replace `REPLACE_WITH_YOUR_DATABASE_ID` with that `database_id`. Save the file.

### 3.4 Create the tables on your laptop
```powershell
npm run db:migrate:local
```
Answer **y** if it asks. This creates the tables plus the starting data (default settings and leave types) in a local copy of the database inside `.wrangler/`.

### 3.5 (Optional) Email on your laptop
```powershell
copy .dev.vars.example .dev.vars
```
Leave `RESEND_API_KEY` empty for now. Emails are then **printed in the terminal** instead of being sent, which is perfect for testing.

### 3.6 Start the app
```powershell
npm run dev
```
Open **http://localhost:8788** in your browser.

The first time, you'll see **First-time setup**: enter the company name, your name, your email and a password. This creates the **Super admin**. You're now signed in.

To stop the app, press **Ctrl + C** in the terminal. Run `npm run dev` again to start it.

> **Local data is separate from live data.** What you add on your laptop stays on your laptop. That makes it safe for testing.

---

## 4. Put the code on GitHub

### 4.1 Create an empty repository
1. On GitHub, click **+ → New repository**.
2. Name: `leave-management-system`, visibility **Private**.
3. **Don't** tick "Add a README". Click **Create repository**.

### 4.2 Send the code
Run these in the VS Code terminal, inside the project folder (use your own GitHub user name):
```powershell
git init
git add .
git commit -m "Leave Management System - first version"
git branch -M main
git remote add origin https://github.com/YOUR-USER/leave-management-system.git
git push -u origin main
```
The first push opens a GitHub sign-in window.

> `.gitignore` already keeps secrets (`.dev.vars`), `node_modules/` and the local database out of GitHub.

---

## 5. Deploy to Cloudflare Pages

### 5.1 Create the live tables (one time)
```powershell
npm run db:migrate:remote
```
This creates the same tables in the **live** D1 database.

### 5.2 Connect GitHub to Cloudflare Pages
1. Open https://dash.cloudflare.com and go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Connect your GitHub account and choose the `leave-management-system` repository.
3. Build settings:
   | Setting | Value |
   |---|---|
   | Project name | `leave-management-system` |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | *(leave empty)* |
   | Build output directory | `public` |
4. Click **Save and Deploy**. After about a minute you get a link like **https://able-leave-system.pages.dev**.

The database connection comes from `wrangler.toml`. To check it, open the project, go to **Settings → Bindings**, and confirm **DB → able-leave-db** is listed.

### 5.3 From now on, deploying is automatic
Every `git push` to `main` deploys a new version within about a minute. See part 11.

---

## 6. Set up email

There are two free ways. Pick **one**:
- **Google Sheet + Gmail (recommended):** follow **`google_email_services/GUIDE.md`**. It needs a Google account only (about 100 emails a day on Gmail, 1,500 on Google Workspace).
- **Brevo:** the steps below (300 emails a day).

### Brevo (free, 300 emails a day)

With email on, the system sends:

| When | Email to |
|---|---|
| An employee requests leave | Every **head** of that department (with **Approve / Reject** buttons), and a **"request received"** copy to the **employee** |
| A head approves / rejects / cancels | The **employee** (the decision and their new balance) |

Phone notifications keep working as well. Until email is set up, the system works, but no emails are sent (each request's System notes say why).

### 6.1 Create a Brevo account and verify the sender
1. Sign up at https://www.brevo.com (the free plan is enough).
2. Go to **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Use the address the emails should come from, for example `leave@company.com` (a company address is best; Gmail senders often go to spam). Brevo emails a link to that address; click it to verify.
3. Optional, recommended: **Domains → Add a domain** `company.com` and add the DNS records it shows (your IT / domain provider can do this). Emails then reach inboxes more reliably.

### 6.2 Get the API key
In Brevo, go to **profile menu → SMTP & API → API Keys → Generate a new API key**, give it a name ("Leave System") and copy the key (`xkeysib-...`).

### 6.3 Add the key to Cloudflare
1. In Cloudflare, open the `able-leave-system` Pages project, then go to **Settings → Variables and Secrets → Add**.
2. Type **Secret**, name `BREVO_API_KEY`, value: the key. **Save** for Production.
3. **Redeploy:** go to **Deployments**, open the latest one, choose **⋯ → Retry deployment**.

### 6.4 Set the sender and test
1. In the system, go to **Settings → General → Email sender**, enter `Company Leave <leave@company.com>` (the verified sender), and **Save settings**.
2. At the top of Settings it now says **"Email is on (Brevo)"**. Click **Send test email**. You get an email at your login address.

(Resend also works instead of Brevo: add the secret `RESEND_API_KEY` and verify your domain in Resend.)

### 6.5 Email on your laptop (optional)
Put `BREVO_API_KEY=xkeysib-...` in `.dev.vars`, then restart `npm run dev`.

---

## 6A. Employees request leave without signing in

### The employee portal (recommended)
Employees have their own simple portal, separate from the admin / head app (they can never open it):

**https://able-leave-system.pages.dev/request**

**How employees sign in**
- **Username:** the employee's **email** (the one in **Employees**). An employee without an email can't sign in until you add it.
- **First password:** **`user@123`** for everyone. Until they change it, the portal shows a reminder.
- **Changing the password:** the employee clicks the **⚙ Settings** icon (top right) to see their details (name, number, department, email) and use **Change password**.
- **Forgotten password:** in the app, go to **Employees → Reset portal password** on their row. They're back to `user@123` and signed out everywhere.
- **Portal column:** in **Employees** it shows *Default (user@123)*, *Own password*, or *No email - cannot sign in*.
- **Changing the default:** it's `DEFAULT_PASSWORD` in `src/server/routes/portal.js` (also shown in `public/js/pages/employees.js`).

**What the employee does**
| Screen | What happens |
|---|---|
| Sign in | Email + password |
| Home | Two big buttons: **Summary** and **Request**, plus **⚙ Settings** and **Sign out** at the top |
| Settings ⚙ | Their details and **Change password** |
| Summary | Total days left (ring), balance per leave type, upcoming approved leave, every request with its status, who decided and the remark. Pending requests can be **withdrawn**. |
| Request | The leave form: leave type, one day / days in a row / separate dates, full or half day (Annual and Casual), short leave times, reason. Shows the request number when sent. |

- **Email:** the first time, the employee types their email. It's saved and shown masked after that.
- **Checks:** the normal rules apply (balance, weekends and holidays, past dates, days already requested, two half days per date).
- **Locking and sessions:** 5 wrong passwords lock the portal for 15 minutes. Sessions end after 12 hours without use.
- **Where to find the link:** shown at the top of **Employees** and **Settings → General**.

You don't need the Google Form below unless you prefer Google Forms.

### Optional: a Google Form instead

Employees **don't sign in** to the system. They request leave with a **Google Form** (a new form, created by `google-form/Bridge.gs`). Only heads and admins have logins.

```
Employee → Google Form → Bridge.gs (the form's Apps Script) → new system checks + saves → head gets Approve / Reject email
```

**What the new system does with each form answer**
- **Employee number and name** must be the same person (as before). A typed "005" is matched to the full number (for example EMP005).
- **Rules:** the same checks as the app (balance, weekends and holidays, past dates, days already requested).
- **If everything is fine:** the request is saved as **Pending**, every head of the department gets the Approve / Reject email, and the employee gets a "received" copy.
- **If something is wrong:** nothing is saved, and the employee gets a red **"Your leave request was NOT sent"** email with the reason and the form link.
- **No double saves:** the same form answer is never saved twice.
- **Dropdowns:** every hour the form's Employee Name, Employee Number and Leave Type lists are refreshed from **Employees** and **Settings → Leave types**.

**Setup (one time)**
1. **Cloudflare secret:** in the Pages project, go to **Settings → Variables and Secrets → Add**, choose type **Secret**, name `FORM_SECRET`, value: a long random text (at least 16 characters). Save, then redeploy (Deployments → ⋯ → Retry deployment).
2. **Create a new Apps Script project:** sign in to Google with the account that should **own** the form (for example a company HR account), open https://script.google.com and click **New project**. Rename it to "Leave Form Bridge".
3. **Paste the script:** delete the sample code in `Code.gs`, paste in the content of `google-form/Bridge.gs` from this project, and click **Save**.
   - At the top, `BRIDGE_EMAIL_MODE = 'typed'` means employees type their email, so no Google account is needed. Change it to `'verified'` to take the email from their Google sign-in.
4. **Add Script Properties:** go to **Project Settings** (gear icon) → **Script Properties → Add script property**:
   | Property | Value |
   |---|---|
   | `LMS_URL` | `https://able-leave-system.pages.dev` |
   | `LMS_FORM_SECRET` | the same value as `FORM_SECRET` in Cloudflare |
5. **Test the connection:** go back to the **Editor**, choose `testBridge` next to **Run**, and click **Run**. Allow the permissions when asked (Advanced → Go to project → Allow). The log should say *Connected …*.
6. **Create the form:** choose `createLeaveForm` and click **Run**. It builds the new form (name, number, leave type, short leave times, one day / days in a row / separate dates, half day, reason), connects it, and fills the dropdowns. The **Execution log** shows the **new form link** and the edit link.
7. **Save the form link:** in the app, go to **Settings → General → Google Form link** and paste the new link, so the "NOT sent" email can point back to it.
8. **Share the new link** with employees. If they still have the old form, open it and switch off **Responses → Accepting responses**, with a message that points to the new link.
9. **Optional:** in the form editor (edit link from the log), add your logo or a header image, change colors, and so on. Don't rename the questions or pages: the bridge reads them by name.

**Day to day**
- **New employee:** add them in **Employees**. They appear in the form within an hour, or straight away if you run `syncFormLists`.
- **If the system was unreachable:** the form owner gets an email. Run `resendFailed` in the Apps Script project.
- **Requests that came from the form:** their System notes say *Via Google Form*.

---

## 6A+. One sign-in for everyone

Everyone uses the **same sign-in** (email + password), on the system page or the employee app page:

| Who | Goes to |
|---|---|
| Has a **Login account** (Super admin, Admin, Department head) and uses that password | **The system** |
| Is only in **Employees** (password `user@123` or their own) | **The employee app** |
| Is both (an employee who is also a Department head / Admin / Super admin) | The system **with My Leave** - also from the phone app |

| Who | 📱 Phone | 🖥️ Computer |
|---|---|---|
| Employee and also head / admin / super admin | 4 bottom tabs: **My Leave · Balance · Requests · Profile** | **Employee \| System** switch (top right). *Employee*: My Leave, Balance, Profile. *System*: the full system. |
| Head / admin / super admin, not an employee | Only **Requests** (Waiting / Done, Approve / Reject) | The full system |
| Plain employee | The employee app | The employee app (wider layout) |

- **My Leave, Balance, Profile** are the **same screens as the employee app** (All / Pending / Approved list,
  **New Request**: Leave, Work From Home, Late Arrival). On a computer they use the full width
  (cards in a grid, details in a dialog, Profile in two columns).
- **Requests** = leave and WFH requests waiting for this person (**Waiting**) and the ones decided (**Done**).
- The computer remembers the last mode (first time: *System*). A link to a page of the other mode switches by itself.

### One person = one account

| Who | How the Super admin sets it up |
|---|---|
| Not an employee (only manages) | **Login accounts → Add** |
| An employee | **Employees → Add employee** (the employee app account is ready at once). To make them Department head / Admin / Super admin: **Employees → System access**. *Login accounts → Add* refuses an employee's email and says so. |
| Login made first, employee added later (same email) | **Add employee** (or CSV import / changing the email) **links** to the existing login - no second account, and they keep the login's password. |

### An employee who is also a Department head / Admin / Super admin

1. The **Super admin** opens **Employees**, clicks **System access** on the employee, and chooses
   **Department head** (tick their department(s)), **Admin** or **Super admin**. Choosing **None** takes the access away again.
   The employee needs an email; the login account is made and linked automatically. One Super admin must always remain.
2. The person signs in **once**, with the **same password** for the system and the employee app.
   If they never set their own password, the first password is `user@123` and they must choose their own.
3. They always get the **full system** (the phone app sends them there too); their own leave is under **My Leave** and **Request Leave**.
4. They can **never approve their own leave**; it goes to the Super admin / Admin.
5. Making the employee **Inactive** (or deleting them) removes the system access at once.
   Every give / remove is saved in the `access_log` table.

---

## 6B. Phone notifications (instead of email)

The system sends **phone notifications** (they appear in the phone's notification bar):

| When | Who gets it | Tapping it opens |
|---|---|---|
| An employee requests leave | Every **head** of that department (no head: the admins) | Admin app → **Approvals** |
| A head approves / rejects / cancels | The **employee** | Employee app |

The admin app also has a **🔔 bell** (top right) with an unread count and the list of notifications.

**Turn it on (once per phone):**
- **Android (Chrome):** open the app, then tap **Turn on notifications** (on the admin Home page or in the 🔔 bell; in the employee app: **Profile → Notifications → Turn on**) and choose **Allow**.
- **iPhone (iOS 16.4 or newer):** open the link in **Safari**, tap **Share → Add to Home Screen**, open the app **from the Home Screen icon**, then tap **Turn on notifications** and choose **Allow**. iPhones only show web notifications for apps added to the Home Screen.
- **Computer:** the same button works in Chrome or Edge.

Nothing needs to be set up on Cloudflare: the notification keys are made automatically the first time. Email is only sent if `RESEND_API_KEY` is set.

If someone doesn't get notifications: check that they allowed them in the phone settings (Settings → Apps → Chrome → Notifications), and that they're signed in on that phone.

---

## 7. First-time setup of the live system

1. Open your live link (`https://....pages.dev`).
2. **First-time setup**: create the Super admin (company name, your name, email, password).
3. Go through **Settings → General**:
   - **Time zone**: `Asia/Colombo` (decides what "today" is)
   - **Leave year starts**: `01-01` for the calendar year
   - **Weekend days**: tick Saturday and Sunday (or whatever applies)
   - **Total leave days per year**: leave it empty to add up the types, or type a number
   - **When there is not enough balance**: *Stop the request* or *Send it with a warning*
   - **Short leaves per month**: for example `2`
   - **Copy of Approved / Cancelled emails**: for example the HR email
   - **App address**: your live link, used in the email buttons
   - **Main color** and **Logo** (any `https://` image link)
4. Go to **Settings → Leave types** and check the names and days per year. "Half day allowed" means half days count as 0.5. Exactly one type can be the **Short Leave**.
5. Go to **Settings → Holidays** and add this year's public and company holidays. **Paste list** accepts lines like `2026-01-14, Tamil Thai Pongal Day`.
6. In **Departments**, add each department.
7. In **Employees**, add employees one by one or use **Import CSV**, with columns `emp_no,name,email,department,status`. The **email must be the person's real email**: it links the login to the employee record.
8. In **Login accounts**, click **Create accounts for all employees**. Each person gets an email with a first password, and the screen also shows a list of temporary passwords **once**. At first sign in, everyone chooses their own password.
9. Back in **Departments → Edit**, tick the **Department head(s)**. A head who is an *Employee* is automatically changed to *Department head*. To make someone an **Admin**, go to Login accounts → Edit → Role (only the Super admin can do this).
10. Test it: sign in as an employee (or apply on someone's behalf as admin), apply for a day, check the head's email, then approve.

---

## 8. Move the data from the Google Sheet

Only do this if you want to keep the old requests and balances.

1. In the old Google Sheet, open each of these tabs and choose **File → Download → Comma Separated Values (.csv)**:
   - `Departments` → save as `scripts/input/Departments.csv`
   - `Employees` → save as `scripts/input/Employees.csv`
   - `Leave_Requests` → save as `scripts/input/Leave_Requests.csv`

   (Create the `scripts/input` folder. It is ignored by Git, so this personal data never goes to GitHub.)
2. Make the SQL file:
   ```powershell
   npm run import:sheet
   ```
   If your sheet shows dates as month/day/year, use `npm run import:sheet -- --mdy` instead.
3. Test it on your laptop first:
   ```powershell
   npx wrangler d1 execute able-leave-db --local --file=scripts/output/import.sql
   npm run dev
   ```
   Check **All requests**, **Team balances** and **Employees**.
4. Load it into the live database:
   ```powershell
   npx wrangler d1 execute able-leave-db --remote --file=scripts/output/import.sql
   ```
5. In **Settings → Leave types**, make sure the type names are **exactly** the same as in the old sheet (for example `Casual Leave`), otherwise old requests are not counted in balances.
6. Department heads from the old sheet get accounts with **no password**. They use **Forgot password?** on the sign-in page, or an admin clicks **Reset password** for them in Login accounts.

Running the import twice is safe: existing rows are skipped.

---

## 9. How to use the system

### Everyone
- **Sign in** with your email and password. Forgot it? Click **Forgot password?** and a 6-digit code is emailed to you.
- **My account** (top right menu): change your password.
- The app works on phones too (the menu is behind the ☰ button).

### Employee
| Task | How |
|---|---|
| See my balance | **Home** or **My leave**: each type shows days left, approved and pending |
| Apply for leave | **Apply for leave** → choose type → *One day* / *Days in a row* / *Separate dates* → reason → **Send request** |
| Half day | Choose a type that allows half days (for example Casual Leave) → *One day* → **Half day** |
| Short leave | Choose **Short Leave** → date, out time, return time |
| Withdraw a pending request | **My leave** → click the request number → **Withdraw** |
| See who is on leave | **Calendar** (your department) |

### Department head
| Task | How |
|---|---|
| Approve / reject from email | Click **Approve** or **Reject** in the email → add a remark (optional) → confirm |
| Approve / reject in the app | **Approvals** → buttons on each row, or tick several → **Approve selected** |
| Cancel approved leave that wasn't taken | **All requests** → open the request → **Cancel leave** (the days are no longer counted and the employee is emailed) |
| Team balances | **Team balances**: days left per type for each person; **Export CSV** |
| Reports | **Reports** → period (this month, last month, this year, or custom dates) → **Print / Save PDF** or **Export CSV** |

> You can't approve your own leave. It goes to the other heads or the admins.

### Admin / Super admin
| Task | How |
|---|---|
| Enter leave for someone | **Apply for leave** → choose the **Employee** at the top |
| Enter past leave | Allowed for roles with "Use leave dates before today" (Admin by default) |
| Change any status | Open a request: Approve / Reject / Cancel leave (admins can also re-approve rejected or cancelled requests) |
| Search and export | **All requests** → filters → **Export CSV** |
| Department heads | **Departments → Edit**: tick or untick existing heads (as many as needed), or type **New head - name / email / password** to create the head's login right there. A head gets requests and notifications for **their** departments only. |
| Leave Chart | **Leave Chart**: employees across, Casual / Annual / Half Day / Short going down, one date per cell (27-Feb), like the paper register. With the "Edit the Leave Chart" permission: click a cell to remove that employee's dates or add new ones - **Type dates** (27-Feb, 6-Mar, 16/04, 17/04/2026), **Pick dates** or **From - To**. **Bulk add** adds the same dates to many employees. Weekends, holidays and days that already have leave are skipped. |
| Leave Summary | **Leave Summary**: approved leave **taken** this leave year - Employee, Annual (/14-Year), Casual (/7-Year), Short (/2-Month), Total (/21-Year). Half days are not shown as a column (they still count inside Annual / Casual). The header numbers come from Settings → Leave types; a number above its limit is red. |
| Manage people | **Employees**, **Departments**, **Login accounts** |
| Disable a person | **Login accounts → Edit → Status: Disabled** (signs them out at once) |
| Reset a password | **Login accounts → Reset password** (shows a temporary password and emails it) |
| Change permissions | **Access control** (Super admin only): tick what each role can do → **Save** |
| Delete requests | Only roles with "Delete leave requests" (off by default; turn it on in Access control) |

---

## 10. Leave rules reference

| Rule | How it works |
|---|---|
| **Working days** | Days in the request minus weekend days (Settings) and holidays (Settings → Holidays) |
| **Leave year** | Starts on Settings → Leave year starts (MM-DD). Balances start again on that day. |
| **Balance** | Days per year − approved − pending, per type and for the yearly total |
| **Yearly total** | Settings → Total days per year, or (if empty) the sum of types marked "Counts in the yearly total" |
| **Half day** | 0.5 day of the chosen type (only types with "Half day allowed") |
| **Short leave** | Counted per **calendar month** (Settings → Short leaves per month). Starts again at 0 every month. Not part of the yearly total. |
| **No limit types** | Days per year empty (for example No Pay Leave): never blocked, shows days taken |
| **Not enough balance** | *Stop*: the employee sees why and nothing is saved. *Warn*: sent to the head with a red "Auto check" note. |
| **Past dates** | Blocked unless the role has "Use leave dates before today" |
| **Same days twice** | Blocked if a pending or approved request already covers those days (short leave may share a day) |
| **Separate dates** | Up to 10 dates; saved as `R26Oct001-1`, `R26Oct001-2`, …; one email for all |
| **Request number** | `R` + year + month of the first leave day + running number: `R26Oct001` |
| **Who gets the email** | Every head of the employee's department. With no head: every Admin and the Super admin. |
| **Allowed status changes** | Pending → Approved / Rejected (heads, admins). Approved → Cancelled (heads, admins). Pending → Cancelled (the employee withdraws). Anything else needs "Change any status" (admins). |
| **System notes** | Each request keeps a log of the automatic checks and of every email sent (or why it wasn't). Admins see it in the request details. |

---

## 11. Making changes later

**The daily loop**
```powershell
npm run dev                 # 1. run on your laptop, change code, refresh the browser
git add .                   # 2. save the change
git commit -m "Describe the change"
git push                    # 3. Cloudflare deploys it automatically (about 1 minute)
```

**Where things are**
| I want to change… | File |
|---|---|
| Look and colors | `public/css/styles.css` |
| A page | `public/js/pages/<page>.js` |
| Menu items | `ROUTES` in `public/js/app.js` |
| Leave rules / balances | `src/server/leave.js` |
| Email wording | `src/server/email.js`, `src/server/leave.js` (notify functions) |
| A new API endpoint | `src/server/routes/*.js` (add to the list at the bottom of the file) |
| A new permission | `PERMS` in `src/server/permissions.js` |
| A new setting | `SETTING_DEFAULTS` and `RULES` in `src/server/settings.js`, plus `public/js/pages/settings.js` |

**Changing the database tables**
Never edit `0001_schema.sql` after it has been applied. Add a **new** file instead, for example `migrations/0003_add_phone.sql`:
```sql
ALTER TABLE employees ADD COLUMN phone TEXT NOT NULL DEFAULT '';
```
Then apply it in both places:
```powershell
npm run db:migrate:local
npm run db:migrate:remote
```

**Test a change online before it goes live (preview)**
```powershell
git checkout -b my-change
git push -u origin my-change
```
Cloudflare builds a **preview link** for the branch, but it uses the **live database**. When you're happy with it, merge into `main` on GitHub.

**Deploy without GitHub (emergency)**
```powershell
npm run deploy
```

---

## 12. Backups and restore

**Download a full backup** (do this weekly, and keep the file somewhere safe that is **not** GitHub):
```powershell
npx wrangler d1 export able-leave-db --remote --output=backup-2026-11-02.sql
```

**Undo a mistake (Time Travel):** D1 can restore the live database to an earlier minute. The free plan keeps 7 days.
```powershell
npx wrangler d1 time-travel info able-leave-db
npx wrangler d1 time-travel restore able-leave-db --timestamp=2026-11-02T08:00:00Z
```

**Restore a backup file into an empty database:**
```powershell
npx wrangler d1 execute able-leave-db --remote --file=backup-2026-11-02.sql
```

---

## 13. Custom domain (optional)

To use an address like `leave.yourcompany.com`:
1. Open the Pages project and go to **Custom domains → Set up a custom domain**.
2. Enter `leave.yourcompany.com` and add the CNAME record it shows at your DNS provider.
3. Update **Settings → General → App address** in the app so the email buttons use the new address.

---

## 14. Free plan limits

| Service | Free limit | Enough for |
|---|---|---|
| Cloudflare Pages (static files) | Unlimited requests | |
| Pages Functions (the API) | 100,000 requests / day | Hundreds of employees |
| D1 database | 5 GB, 5 million rows read / day, 100,000 rows written / day | Many years of requests |
| Resend email | 3,000 emails / month, **100 / day** | About 30–40 requests a day (each request sends 2–3 emails) |

If you outgrow the Resend limit, its paid plan or another email service can be used. Only `sendEmail` in `src/server/email.js` would need to change.

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| `node` / `npm` / `git` "is not recognized" | Install it (part 2) and **reopen VS Code** |
| `npm` "running scripts is disabled" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| App says *"The database tables are missing"* | Run `npm run db:migrate:local` (laptop) or `npm run db:migrate:remote` (live) |
| App says *"binding DB is missing"* | `wrangler.toml` still has `REPLACE_WITH_YOUR_DATABASE_ID`, or the change wasn't pushed. Fix it, push, and check Settings → Bindings. |
| Emails not arriving | Open the request (admin) and read **System notes**. *"email is not set up"* → add `RESEND_API_KEY` and redeploy. *FAILED 403* → the domain isn't verified in Resend or the sender address isn't on it. Also check spam. |
| Email buttons open the wrong address | Settings → General → **App address** |
| Employee sees *"not linked to an employee record"* | The login email and the employee email must be the same (Employees → Edit) |
| Head doesn't see Approvals | Departments → Edit → tick them as head; check their role is Department head or Admin; check Access control |
| Wrong "today" / past date errors | Settings → General → Time zone |
| Weekend counted as leave | Settings → General → Weekend days |
| Forgot the Super admin password | Use **Forgot password?** If email isn't set up, ask another Super admin, or (on your laptop) delete the user with `npx wrangler d1 execute able-leave-db --remote --command "DELETE FROM users WHERE email='you@company.com'"`. When there are no users left, First-time setup appears again. |
| Port 8788 busy | `npx wrangler pages dev --port 8790` |
| See server errors live | Pages project → **Deployments → latest → Functions → Real-time logs** (or the terminal when running locally) |

---

## 16. Security notes

- Passwords are stored only as **PBKDF2-SHA256 hashes** (100,000 rounds, unique salt). Nobody can read them, not even the Super admin.
- Sessions use a random token in an **HttpOnly, Secure, SameSite** cookie. Only a hash of the token is stored. A session ends after 12 hours without use.
- 5 wrong passwords lock the account for 15 minutes. Reset codes expire after 15 minutes and allow 5 tries.
- Every API call checks the **role permission and the department** on the server. The menu hiding things is only for convenience.
- Requests from other websites are blocked (Origin check), and the pages send strict security headers (`public/_headers`).
- Email Approve / Reject links use a long random token per request. Opening the link only shows a confirm page; the decision needs a click, so email virus scanners can't approve by accident.
- Never commit `.dev.vars` or API keys. Keep the GitHub repository **private**.

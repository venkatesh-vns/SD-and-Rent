# SD Maintenance Application

A full-stack application for maintaining Security Deposit (SD) and lease data.
Built with **React.js** (frontend), **Node.js/Express.js** (backend REST API),
**JWT authentication**, and a **PostgreSQL** database (managed via pgAdmin).

Built (V1 plan, Phases 1-5): secure login with session control, change
password, user profile, User Master, Cost Center Master, Location Master
(3 levels), SD Master, SD Transaction (with SD Balance and SD Balance
Repayable), User Rights Master, email notifications and reminders, SD Balance
Report, Email Log, Audit Log,
Excel template / upload with row-level validation reports, Excel export and
an audit trail.

---

## 1. Project Structure

```
sd-maintenance-app/
├── client/                 # React.js frontend
│   ├── public/
│   └── src/
│       ├── components/     # Navbar, DataTable, Modal, ExcelUpload, UploadReport,
│       │                     FilterBar, Pager, SdPicker, ProtectedRoute
│       ├── config/         # screens.js - screen codes and menu
│       ├── context/        # AuthContext (JWT session, rights, idle timeout)
│       ├── hooks/          # useDebounce
│       ├── pages/          # Login, ForgotPassword, ResetPassword, Dashboard,
│       │                     UserMaster, CostCenterMaster, LocationMaster, SdMaster,
│       │                     SdTransactions, SdBalanceReport, EmailLog, AuditLog,
│       │                     UserRightsMaster,
│       │                     ChangePassword, Profile
│       ├── services/       # axios API client + file download helper
│       ├── utils/          # password policy, date / amount formatting
│       ├── App.js
│       ├── index.js
│       └── styles.css
│
├── server/                 # Node.js / Express.js backend
│   ├── config/db.js        # PostgreSQL (pg) pool + withTransaction helper
│   ├── controllers/        # auth, user, costCenter, location, sdMaster, sdTransaction,
│   │                         userRights, upload, report (reports, logs, reminder run)
│   ├── middleware/         # JWT auth, rights check, error handler, multer upload
│   ├── models/             # user, costCenter, location, sdMaster, sdTransaction, userRights,
│   │                         log, report
│   ├── routes/             # auth, users, cost-centers, locations, sd-master, sd-transactions,
│   │                         lookups, report (reports / logs / notifications),
│   │                         user-rights, uploads
│   ├── services/           # sdMaster / sdTransaction rules; notificationService (emails,
│   │                         daily reminder scheduler)
│   ├── scripts/            # migrate.js (schema), seedAdmin.js (admin user)
│   ├── utils/              # audit, bulkUpload, dates, excel, emailService, validators
│   ├── tests/              # npm test (node:test) - unit + API tests on a throwaway database
│   ├── uploads/            # temp storage for Excel bulk-upload files
│   ├── app.js              # Express app (routes, middleware)
│   └── server.js           # starts app.js + the reminder scheduler
│
├── database/
│   ├── migrations/         # 001_initial, 002_foundation, ... 005_sd_transactions, 006_notifications_reports, 007_notification_templates, 008_mail_settings (npm run migrate)
│   └── seed.sql            # Sample cost centers
│
└── README.md
```

---

## 2. Prerequisites

* Node.js v18+ and npm
* PostgreSQL with pgAdmin (this project's scripts and `server/config/db.js`
  are written for PostgreSQL using the `pg` package)
* An SMTP account (e.g. Gmail with an App Password) for sending
  password-reset emails

---

## 3. Database Setup

1. Open pgAdmin, right-click **Databases** under your server, and choose
   **Create > Database**. Name it `sd_maintenance`.
2. Create the tables from the `server/` folder (see step 4 below for
   `npm install` / `.env` setup first):

   ```bash
   npm run migrate
   ```

   This applies every file in `database/migrations` that has not run yet and
   records it in `schema_migrations`. Run it again after every update. It is
   safe on a database created from the old `schema.sql`.
3. Optional: open `database/seed.sql` in pgAdmin's Query Tool and run it to
   create a few sample cost centers.
4. Create the default admin user from the `server/` folder:

   ```bash
   npm run seed
   ```

   This generates a correct bcrypt hash and inserts an Active
   **administrator** (full access to every screen; cannot be deactivated or
   deleted).

   * Default login: **UserName:** `admin` **Password:** `Admin@123`
   * To use your own credentials instead:
     `npm run seed -- --username=admin --email=you@company.com --password=YourPassword123`
   * **Change this password immediately** after your first login.

---

## 4. Backend Setup

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env` with your actual PostgreSQL credentials (the ones you use to log
into pgAdmin), JWT secret, and SMTP credentials, then:

```bash
npm run migrate  # create / update tables
npm run dev      # starts with nodemon (auto-restart)
# or
npm start        # plain node
```

The API will run at `http://localhost:5000/api` by default.
Health check: `GET http://localhost:5000/api/health`

### Key API Endpoints

"Needs" names the User Rights flag required (View / Add / Edit / Delete /
Upload on a screen). Administrators pass every check. A new user has no
rights until they are assigned in the User Rights Master.

| Method | Endpoint                          | Description                        | Needs                 |
|--------|-----------------------------------|------------------------------------|-----------------------|
| POST   | `/api/auth/login`                 | Login (Active users only)          | -                     |
| POST   | `/api/auth/forgot-password`       | Send password reset email          | -                     |
| POST   | `/api/auth/reset-password/:token` | Reset password using emailed token | -                     |
| GET    | `/api/auth/me`                    | Current user + rights              | Login                 |
| POST   | `/api/auth/change-password`       | Change own password                | Login                 |
| POST   | `/api/auth/logout`                | End all sessions of current user   | Login                 |
| GET    | `/api/users`                      | List users (`?search=&status=`)    | User: View            |
| GET    | `/api/users/export`               | Export list to Excel               | User: View            |
| GET    | `/api/users/template`             | Download upload template           | User: Upload          |
| POST   | `/api/users`                      | Create user                        | User: Add             |
| PUT    | `/api/users/:id`                  | Update user                        | User: Edit            |
| PUT    | `/api/users/:id/password`         | Administrator password reset       | User: Edit            |
| DELETE | `/api/users/:id`                  | Delete user                        | User: Delete          |
| POST   | `/api/users/bulk-upload`          | Excel bulk upload (field: `file`)  | User: Upload          |
| GET    | `/api/cost-centers`               | List (`?search=&status=`)          | Cost Center: View     |
| GET    | `/api/cost-centers/export`        | Export list to Excel               | Cost Center: View     |
| GET    | `/api/cost-centers/template`      | Download upload template           | Cost Center: Upload   |
| POST   | `/api/cost-centers`               | Create (code auto-generated)       | Cost Center: Add      |
| PUT    | `/api/cost-centers/:id`           | Update name / status               | Cost Center: Edit     |
| DELETE | `/api/cost-centers/:id`           | Delete                             | Cost Center: Delete   |
| POST   | `/api/cost-centers/bulk-upload`   | Excel bulk upload (field: `file`)  | Cost Center: Upload   |
| GET    | `/api/locations/:level`           | List level 1, 2 or 3 (`?search=&status=&l1Id=&l2Id=`) | Location: View |
| GET    | `/api/locations/:level/export`    | Export level to Excel              | Location: View        |
| GET    | `/api/locations/:level/template`  | Download level upload template     | Location: Upload      |
| POST   | `/api/locations/:level`           | Create (code auto-generated)       | Location: Add         |
| PUT    | `/api/locations/:level/:id`       | Update name / status / parent      | Location: Edit        |
| DELETE | `/api/locations/:level/:id`       | Delete (only with no children)     | Location: Delete      |
| POST   | `/api/locations/:level/bulk-upload` | Excel bulk upload (field: `file`) | Location: Upload      |
| GET    | `/api/sd-master`                 | Paged list (`?page=&pageSize=&search=&costCenterId=&l1Id=&l2Id=&l3Id=&landlordStatus=&buildingStatus=`) | SD Master: View |
| GET    | `/api/sd-master/:id`             | One record + status history        | SD Master: View       |
| GET    | `/api/sd-master/export`          | Export (same filters, all pages)   | SD Master: View       |
| GET    | `/api/sd-master/template`        | Download upload template           | SD Master: Upload     |
| POST   | `/api/sd-master`                 | Create (SD Code auto-generated)    | SD Master: Add        |
| PUT    | `/api/sd-master/:id`             | Update                             | SD Master: Edit       |
| DELETE | `/api/sd-master/:id`             | Delete                             | SD Master: Delete     |
| POST   | `/api/sd-master/bulk-upload`     | Excel upload: new rows + bulk update by SD Code | SD Master: Upload |
| GET    | `/api/sd-transactions`           | Paged list with running balances (`?sdId=&search=&sdType=&fy=&agreementStatus=&costCenterId=&dateFrom=&dateTo=`) | SD Transaction: View |
| GET    | `/api/sd-transactions/summary/:sdId` | SD Master details + balances   | SD Transaction: View  |
| GET    | `/api/sd-transactions/sd-search` | Find SD Codes (`?q=`)             | SD Transaction: View  |
| GET    | `/api/sd-transactions/:id`       | One transaction                    | SD Transaction: View  |
| GET    | `/api/sd-transactions/export`    | Export (same filters, all pages)   | SD Transaction: View  |
| GET    | `/api/sd-transactions/template`  | Download upload template           | SD Transaction: Upload |
| POST   | `/api/sd-transactions`           | Add transaction                    | SD Transaction: Add   |
| PUT    | `/api/sd-transactions/:id`       | Update transaction                 | SD Transaction: Edit  |
| DELETE | `/api/sd-transactions/:id`       | Delete transaction                 | SD Transaction: Delete |
| POST   | `/api/sd-transactions/bulk-upload` | Excel upload: new rows + bulk update by Transaction No. | SD Transaction: Upload |
| GET    | `/api/reports/sd-balance`        | SD Balance report + totals (SD Master filters, `leaseEndFrom/To`, `balanceDue`, `repayableDue`) | SD Balance Report: View |
| GET    | `/api/reports/sd-balance/export` | Report to Excel with totals row    | SD Balance Report: View |
| GET    | `/api/logs/email`                | Email log (`?search=&notificationType=&status=&dateFrom=&dateTo=`) | Email Log: View |
| GET    | `/api/logs/email/export`         | Email log to Excel                 | Email Log: View       |
| GET    | `/api/logs/audit`                | Audit log (`?search=&tableName=&action=&dateFrom=&dateTo=`) | Audit Log: View |
| GET    | `/api/logs/audit/export`         | Audit log to Excel                 | Audit Log: View       |
| POST   | `/api/notifications/run-reminders` | Run date reminders now (`{ asOf?: 'DD/MM/YYYY' }`) | Administrator |
| GET    | `/api/notification-templates`    | Email templates with settings and placeholders | Email Notification Master: View |
| POST   | `/api/notification-templates/:type/preview` | Render unsaved edits with sample data | Email Notification Master: View |
| PUT    | `/api/notification-templates/:type` | Save a template                  | Email Notification Master: Edit |
| POST   | `/api/notification-templates/:type/reset` | Restore the default template | Email Notification Master: Edit |
| GET    | `/api/mail-settings`            | Mail server and sender settings (no password) | Administrator |
| PUT    | `/api/mail-settings`            | Save mail server settings          | Administrator         |
| POST   | `/api/mail-settings/test`       | Check connection and send a test email | Administrator     |
| GET    | `/api/lookups/cost-centers`      | Cost center dropdown list          | Login                 |
| GET    | `/api/lookups/locations/:level`  | Location dropdown list (`?parentId=`) | Login            |
| GET    | `/api/user-rights/users`          | Users to assign rights to          | User Rights: View     |
| GET    | `/api/user-rights/screens`        | Screens rights apply to            | User Rights: View     |
| GET    | `/api/user-rights/:userId`        | A user's rights on every screen    | User Rights: View     |
| PUT    | `/api/user-rights/:userId`        | Save a user's rights               | User Rights: Edit     |
| GET    | `/api/uploads/:batchId/report`    | Upload validation report (Excel)   | Upload on that screen |

---

## 5. Frontend Setup

```bash
cd client
npm install
cp .env.example .env
```

Edit `.env` if your API is not running on `http://localhost:5000/api`, then:

```bash
npm start
```

The app opens at `http://localhost:3000`.

### Branding

| File | Used for |
|---|---|
| `client/src/assets/indiqube-logo.png` | Full logo above the sign-in form (transparent background) |
| `client/src/assets/indiqube-mark.png` | Square symbol on a white tile: menu bar and login brand panel |
| `client/public/favicon.png` | Browser tab icon |
| `client/src/assets/indiqube-logo-original.png` | The logo as supplied, kept for reference |

Replace these files (same names) to update the branding. Colours and other design
values are the variables at the top of `client/src/styles.css`.

---

## 6. Excel Bulk Upload Format

Use **Download Template** on each screen to get the exact columns. Files must be
Excel Workbooks (`.xlsx`); the older `.xls` format is not accepted.

**User Master (`.xlsx`)** — columns:
`User Name | User Email ID | Password | Status`
(Password is optional — `DEFAULT_USER_PASSWORD` is assigned if left blank.)

**Cost Center Master (`.xlsx`)** — columns:
`Cost Center Name | Status`
(Cost Center Code is generated automatically; a Code column in the file is ignored.)

**Location Master (`.xlsx`, one upload per level)** — columns:
* Level 1: `Level 1 Name | Status`
* Level 2: `Level 1 Name | Level 2 Name | Status`
* Level 3: `Level 1 Name | Level 2 Name | Level 3 Name | Status`

Parents are matched by name and must already exist and be Active, so upload
Level 1 first, then Level 2, then Level 3. Codes (L1-0001, L2-0001,
L3-0001) are generated automatically. Level 1 names are unique; Level 2 names
are unique within their Level 1; Level 3 names within their Level 2.

**SD Master (`.xlsx`)** — columns:
`SD Code | Lease ID | Agreement No. | Cost Center | Location Level 1 | Location Level 2 | Location Level 3 | Landlord Name | Landlord Status | Building Status | Floor | Agreement Value | Lease Commencement Date | Rent Commencement Date | Lease End Date`

* **SD Code blank** = new record (SD Code is generated). Mandatory: Cost
  Center, Location Level 1-3, Landlord Status, Building Status, Floor,
  Agreement Value.
* **SD Code filled** = bulk update of that record. Only non-blank cells are
  changed; blank cells keep the stored value.
* Cost Center and locations may be given by code or by name (locations by
  name within their parent). They must be Active unless the record already
  uses them.
* Statuses are Active / Passive. Dates are DD/MM/YYYY (real Excel date cells
  also work). Agreement Value is a positive number, commas allowed.
* Lease ID + Agreement No. + Floor must be unique (checked when Lease ID or
  Agreement No. is filled in), in the database and within the file.
* An export has the same columns, so it can be edited and uploaded back.

**SD Transaction (`.xlsx`)** — columns:
`Transaction No. | SD Code | SD Type | FY | SD Transaction Date | Agreement Status | SD Paid Amount | SD Transfer Amount | SD Adjustment Amount | SD Refund Amount | Remarks`

* **Transaction No. blank** = new transaction (Transaction No. is generated,
  e.g. TXN0000001). **Filled** = bulk update of that transaction; blank cells
  keep the stored value. A transaction cannot move to another SD Code.
* SD Type: Landlord SD, Electricity SD, Additional Parking SD, Other SD,
  Fitout SD, CAM SD, Solar SD. Agreement Status: LOI, Agreement, Registered
  Agreement, Addendum Agreement, Mail Approval (case-insensitive).
* FY as `2024-2025`; SD Transaction Date as DD/MM/YYYY; at least one amount.
* Each SD Code's ledger is checked row by row in file order, together with
  its stored transactions: total SD Paid may not exceed the Agreement Value,
  and SD Balance Repayable may not go below zero on any date.

### SD calculations

* **SD Balance** = Agreement Value − Total SD Paid
* **SD Balance Repayable** = Total SD Paid − Transfer − Refund − Adjustment
* Running values are calculated per SD Code in transaction-date order (views
  `v_sd_ledger` and `v_sd_balance`), so screens, exports and reports agree.
* A transfer only reduces the source SD Code; note the receiving SD Code in
  Remarks.
* New transactions are refused while the SD Code's Landlord or Building
  Status is Passive; existing ones stay visible and editable.
* Agreement Value in SD Master cannot be lowered below the total SD Paid.

---

## 6a. Email Notifications

Each notification is managed on **Masters > Email Notification Master**:
switch it on or off, set To / CC addresses (blank To = the `NOTIFY_TO`
mailbox from the server `.env`), set the trigger days for the date reminders
(0-365), and edit the subject and body using placeholders such as
`{{sd_code}}`, `{{landlord_name}}` or `{{due_date}}`. A live preview shows
the finished email with sample data, and **Restore default** puts back the
original wording. Access follows User Rights (View to see and preview, Edit to
change), and every change is written to the Audit Log. Every email sent is
recorded in `email_log` (Administration > Email Log).

The same screen has a **Mail Server (SMTP)** tab for administrators only:
sender name and email, default recipients, SMTP server, port, security,
username and password, plus **Send test email** (checks the connection and
login, then sends a short message). Blank fields use the `server/.env`
values. The SMTP password is stored encrypted (AES-256-GCM, key from
`SETTINGS_SECRET`, else `JWT_SECRET`), is never sent to the browser, and
must be re-entered if that key changes. Saved settings apply from the next
email without a restart.

| Notification | When |
|---|---|
| Landlord Status changed to Passive | Straight after an SD Master save or upload changes it Active -> Passive |
| Building Status changed to Passive | Same, for Building Status |
| Lease Commencement reminder | Daily job, when the date is within the template's trigger days (default 15) |
| Rent Commencement reminder | Same |
| Lease End reminder | Same |

* The daily job runs at `NOTIFY_TIME` (server time) and once a minute after
  start-up, so a day the server was down is caught up. Each SD Code + reminder
  + date is emailed once; a failed send is retried on the next run.
* Reminders only cover SD Codes whose Landlord and Building Status are Active.
* Administrators can run the job from the Email Log screen, optionally "as of"
  another date (useful in UAT to test reminders without waiting).
* `EMAIL_DRY_RUN=true` builds and logs every email as "Dry run" without
  sending anything - use it in test and UAT environments.
* `NOTIFY_ENABLED=false` stops the daily job on that server (e.g. when
  several API servers run and only one should send reminders; a database
  lock also prevents two runs at the same moment).

Every row is validated first (mandatory fields, allowed values, duplicates in
the database and within the file). Valid rows are saved together in one
transaction; failed rows are not saved. The screen then shows a report with
Row, Key, Field, Uploaded Value, Status and Error, which can also be
downloaded as Excel. Each upload is stored in `upload_batches`.

---

## 6b. Automated Tests

```bash
cd server
npm test
```

Runs unit tests and API tests (auth and rights, masters, SD Master, SD
Transactions and calculations, notifications, report and logs) with Node's
built-in test runner (Node 20+). Each test file drops and re-creates a
separate database, `sd_maintenance_test` (override with `TEST_DB_NAME`; the
name must end in `_test`), using the credentials in `server/.env`. Your
real database is never touched and no emails are sent.

---

## 7. Security Notes

* Passwords are hashed with **bcrypt** before storage — plain text passwords
  are never stored.
* Passwords must be at least 8 characters with at least one letter and one number.
* Only users with `Status = 'Active'` can log in.
* Every API call re-checks the user, so deactivation, logout and password
  changes end existing sessions immediately. The client also logs out after
  `REACT_APP_IDLE_MINUTES` (default 30) without activity.
* Screen and button access follows the User Rights Master, and the API
  enforces the same rights, so a hidden button cannot be bypassed.
* Records in use are never deleted, only made Inactive: an SD Code with
  transactions, a cost center or location used by SD records, a location with records under it, and a user
  who has created or changed any record.
  New records can only pick Active parents.
* Every add, edit, delete, upload, status change, login, logout, password
  change and rights change is written to `audit_log` with before/after values.
* Every email sent (or failed) is recorded in `email_log`.
* Password-reset tokens are single-use and expire after
  `RESET_TOKEN_EXPIRES_MINUTES` (default 30 minutes).
* `helmet` and basic rate-limiting (`AUTH_RATE_LIMIT` attempts per 15 minutes,
  default 20) are applied on the auth endpoints to reduce brute-force risk.
* Excel files are read with `exceljs`; `npm audit` reports no known
  vulnerabilities in the server dependencies.
* Before production deployment: rotate `JWT_SECRET`, restrict CORS to your
  real domain, enable HTTPS, and put the PostgreSQL server behind a
  firewall/VPN (don't expose port 5432 publicly).

---

## 8. Deployment Guide (Summary)

**Backend (e.g. Azure App Service, AWS EC2, or any Node host):**
1. Push the `server/` folder to your host.
2. Set the environment variables from `.env.example` in your host's config.
3. Run `npm install --production` then `npm start` (or use PM2 /
   a process manager for resilience).
4. Point the `DB_*` environment variables at your production PostgreSQL
   database.

**Frontend (e.g. Netlify, Vercel, Azure Static Web Apps, or Nginx):**
1. In `client/`, set `REACT_APP_API_URL` to your production API URL.
2. Run `npm run build` — this produces a static `build/` folder.
3. Deploy the `build/` folder to your static host, or serve it with Nginx.

**Database:**
1. Provision a PostgreSQL instance (Azure Database for PostgreSQL, AWS RDS
   for PostgreSQL, etc.).
2. Run `npm run migrate` (with production `.env` values), then
   `npm run seed` to create the admin user with a real password of your
   choosing. `seed.sql` (sample cost centers) is optional.

**CORS:** Set `CLIENT_URL` in the server `.env` to your deployed frontend URL
so the API accepts requests from it.

---

## 9. Local Development Quick Start

```bash
# Terminal 1 — create the sd_maintenance database in pgAdmin first, then:
cd server && npm install && cp .env.example .env
# edit .env with your PostgreSQL credentials, then:
npm run migrate     # creates / updates the tables
npm run seed        # creates the default admin user
npm run dev

# Terminal 2
cd client && npm install && cp .env.example .env && npm start
```

Then log in at `http://localhost:3000/login` with `admin` / `Admin@123`.

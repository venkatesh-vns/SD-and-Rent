# SD and Rent Maintenance Application — UAT Deployment Notes

**Date:** 13/10/2026 · **Version:** 2.0 (Rent Management module) · **Git branch:** `rent-module`

## 1. Access

| Item | Value |
|---|---|
| Application URL (this PC) | **http://localhost:5200** |
| Office network URL | http://172.30.10.127:5200 (allow Node.js in Windows Firewall when asked) |
| Port | **5200** (screens and API on one port) |
| Database | **sd_rent_uat** (PostgreSQL 18, localhost:5432) |
| Login | Same users and passwords as production at the time of the backup (e.g. `admin`) |
| Emails | **Dry-run**: reminders and alerts are logged in Email Log as "DryRun", never sent |

Production is untouched: http://localhost:3000 (API 5000) on database `sd_maintenance`.

## 2. Start / stop

- Start: double-click **`D:\DatabasePostger\SD and Rent App\start-uat.bat`**
  (installs packages and builds the screens the first time, applies any new
  migration, then starts the server). Keep the window open while testing.
- Stop: close that window (or Ctrl+C).
- After changing client code: `cd client` then `npm run build`, and refresh the browser.

## 3. Backup taken before deployment

Folder: `D:\DatabasePostger\backups\2026-10-13_before_rent_module\`

| File | Contents |
|---|---|
| `sd_maintenance_db.dump` | Full production database (pg_dump custom format, 17 tables) |
| `sd-maintenance-app_files.zip` | All application files (without node_modules / build output) |
| `sd-maintenance-app_git.bundle` | Complete git history (all branches) |
| `server.env` | Production server settings |

Restore the database if ever needed (into a new database, then point the app at it):

```
createdb -U postgres -T template0 sd_maintenance_restored
pg_restore -U postgres -d sd_maintenance_restored --no-owner "D:\DatabasePostger\backups\2026-10-13_before_rent_module\sd_maintenance_db.dump"
```

The UAT database `sd_rent_uat` was created from this backup, then migration
`010_rent_module.sql`, `011_rent_multi_component.sql` and `012_sd_rent_report.sql` were applied to it only.

## 4. What is new — Rent Transaction menu

| Screen | Path | Main functions |
|---|---|---|
| Rent Master | /rent/master | Rent Code (RENT0001…) per SD Code + landlord; Cost Center, Floor, LCD, RCD, LED read from SD Master; LL Status with Inactive End Date; Business Key duplicate check |
| Rent Agreement Master | /rent/agreements | Nine components (Quantity × Rate × %) plus Rent Other Charges (Rate / Month × %, from the RCD, like Solar), Individual / Transfer, Active / Inactive, lock once used |
| Rule Master | /rent/rules | RCD / LCD escalation chains, Normal Day periods, positive / zero / negative %; Bulk Edit (download existing rules, edit in Excel, upload) |
| Waiver Master | /rent/waivers | Rent-free periods (Yes / No), overlap and range checks; Bulk Edit (download existing waivers, edit in Excel, upload) |
| Rent Schedule | /rent/schedule | Generate / Regenerate, multi-select filters, period presets, summaries by Agreement Header / Cost Center / Landlord / Rent Code / Month, Excel and PDF export, generation history; Delete Schedule for a period. Rules and waivers (manual add / edit / delete, Upload, Bulk Edit) cannot change months already generated: delete those lines first, then regenerate |

**Reports > SD & Rent Transaction Summary Report** (/reports/sd-rent): SD transactions
(Expense Category "Security Deposit", Expense Head = SD Type, amount = Paid − Transfer −
Adjustment − Refund) and generated Rent Schedule months ("Rent" / "Maintenance", Expense
Head = component, amount = final monthly rent) in one list with Cost Center, SD Code,
Landlord, Floor, Rent Code, Agreement No., Effective Date and Status. Multi-select filters
(Cost Center, Landlord, Floor, SD Code, Expense Head, Category, Status) and a date range;
views by Cost Center / Landlord / Expense Head / Floor / Month; Excel and PDF export.

All four masters: Add, Edit, Delete, Search, View, Excel template, bulk upload / update,
Export. Upload results download as Excel with each row **Success** (green) or
**Rejected** (red) and a **Remark**. Every add / edit / delete / upload / generation
is in the Audit Log. User Rights: five new screens (admins have access; grant
others in User Rights Master).

Automatic regeneration: after any change in Rent Master, Rent Agreement, Rule,
Waiver, or an SD Master LCD / RCD / LED, months already generated **from the
current month onward** are recalculated. Earlier months stay as generated (audit).

## 5. Decisions taken on the scope document's open points (7.2)

Please confirm or tell us to change any of these.

| # | Open point | Decision in this build |
|---|---|---|
| 1 | Business Key format | `COST CENTER NAME \| SD CODE \| FLOOR \| LANDLORD NAME`, trimmed, upper-case (case-insensitive) |
| 2 | Editing SD fields in Rent Master | Not editable; always read live from SD Master (upload values must match it) |
| 3 | Agreement duplicate rule | Blocked when Rent Code + Agreement Status + **all nine** trigger values match another agreement; plus only one Active agreement per Rent Code + Agreement Status |
| 4 | Agreement status field | Added: **Status** Active / Inactive. A used agreement can only change Status / Remark |
| 5 | Transfer fields | **Transfer From Rent Code** (same SD Code) + **Transfer Effective Date**. Blank components are copied from the source; its rules (if the new Rent Code has none) and later Yes waivers are copied. Source rent stops the day before the date |
| 6 | Escalation Month values | Any whole number 1–600 |
| 7 | LED limit | As written: RCD escalation must be **before** LED; LCD escalation **on or before** LED |
| 8 | Normal Day with RCD / LCD | Allowed together. Normal Day applies its % only between From and To, on top of the escalated rent |
| 9 | Rule scope | **Applies to** multi-select: one or more components; empty = all components |
| 10 | Compounding | Yes — each escalation applies to the already-escalated rent |
| 11 | Lease start for waivers | LCD (RCD if the SD has no LCD) |
| 12 | Partial-month waivers | Day-level: in the 6.4 example, 31/10/2026 is charged pro-rata (₹37.10), so October = ₹37.10, not ₹0 |
| 13 | Pro-rata basis and rounding | Actual days in the month; each month line rounded to 2 decimals |
| 14 | Remark field | Up to 500 characters; included in the Agreement and Waiver upload templates |

Also: Waivers have the same **Applies to** multi-select (empty = all components).
In the Rule and Waiver upload templates, each component has its own column
`Applies to: <component>` — **Yes** = selected, **No** = not selected; leave all
of them blank for all components (on an update, blank keeps the stored selection).
Rent Master requires the SD record to have an RCD and LED; a blank LCD means no
Maintenance Charges (scope 3.3).

## 6. Testing performed

- **93 automated tests pass** (66 existing SD tests unchanged + 27 new): every
  example in the scope document (component samples, 4.2 escalation dates, 4.3
  percentages, 6.3 pro-rating, 6.4 worked scenario, Inactive End Date, waivers,
  transfers), validations, locking, bulk uploads, report output, regeneration.
- Browser walk-through on UAT: Rent Master → Agreement → Rule → Waiver →
  Generate (LCD/RCD starts, waiver months ₹0, mid-month escalation split);
  summary, Excel export; SD Master, SD Transaction and SD Dashboard checked.
- Test records were removed afterwards; UAT holds the production SD data only.

## 7. Known limitations

- Excel upload of a "Normal Day" rule needs From / To dates; RCD / LCD rules ignore them.
- Removing a component from an agreement is done on screen (clear its first
  field); a blank upload cell keeps the stored value.
- PDF export uses the browser's print dialog (Save as PDF).
- The Windows desktop installer (setup.exe) does not yet include the Rent module.

## 8. UAT Release 1 — v2.0.0-uat.1 (desktop installer)

- Installer: `desktop/dist/SD-and-Rent-UAT-Setup-2.0.0-uat.1.exe` (also on the GitHub
  pre-release `v2.0.0-uat.1`). Build again with `cd desktop` then `npm run dist:uat`.
- Installs as **"SD and Rent UAT"**, side by side with the live SD Maintenance app: own
  data folder (`%APPDATA%\SD and Rent UAT`), port **5250**, private PostgreSQL on 5545,
  own firewall rule. Emails are dry-run (Email Log only).
- Install on one main PC ("This PC holds the data", creates the admin), then on testers'
  PCs ("Connect to the main PC" with the address shown under Settings > Address for
  other PCs). The UAT app starts with an empty database: testers create or upload data.
- Test cases: `docs/UAT/SD_and_Rent_UAT_Test_Cases_v2.0.0-uat.1.xlsx` (68 cases, Summary
  sheet counts Pass / Fail / Blocked / Not Run automatically).
- Feedback, bugs and enhancements are fixed in the next UAT release (uat.2, ...);
  production is deployed only after final approval.

## 9. Performance and load balancing (22/10/2026)

- The server runs several web workers sharing one port (load balancing over CPU cores):
  `WEB_WORKERS` in `.env` (default one per core, up to 4; `1` = single process). The daily
  reminders run in one worker only. The desktop app's main PC does the same.
- Migration 019 adds performance indexes (applied automatically by `npm run migrate` / on start).
- Desktop app: PostgreSQL performance settings are written on every start (shared buffers
  25% of RAM up to 1 GB, etc.). Separate PostgreSQL server: see `database/tuning/postgresql_performance.sql`
  (DBA to apply and restart PostgreSQL; affects every database on that server).
- Load test results and how to repeat them: `docs/Performance_Test_Report.md`.

## 10. One login session per User ID (22/10/2026)

- A User ID can be logged in on one browser / PC at a time. A second login (another browser,
  another PC, incognito, the desktop app) is refused with a message saying where and since when
  it is logged in. Tabs of the same browser share one session.
- The login is freed by Logout, after 30 minutes without activity (`SESSION_IDLE_MINUTES`), or
  about 3 minutes after the browser was closed (`SESSION_LIVE_MINUTES`; the app sends a heartbeat
  every minute while open).
- Administrators: User Master > Active sessions lists who is logged in (browser, IP, since, last
  activity) with End session. Deactivating a user, resetting or changing a password also ends sessions.
- Refused logins (LOGIN_BLOCKED) and ended sessions (SESSION_END) are in the Audit Log.
- Migration 020 (user_sessions). After this update everyone must log in again once.

## 11. Log retention — 5 months (23/10/2026)

- Nightly at 02:30, log entries older than 5 months (Audit Log, Email Log, upload history, ended
  login sessions, backup / clean-up history) are archived to gzip files in `serverlog-archive`
  (checked before anything is deleted) and removed from the database. Expired password-reset links
  are deleted; monthly monitoring log files are moved to the archive folder; desktop app log files
  are rotated.
- Email Log reminders for lease dates still to come are kept, so no reminder is sent twice.
- Business data (masters, transactions, schedules, status history, users) is never touched.
- System Health > Log retention shows the policy, the archive folder and each run, with
  **Run log clean-up now**. Settings: LOG_RETENTION_MONTHS (5), LOG_RETENTION_TIME (02:30),
  LOG_ARCHIVE_DIR, LOG_ARCHIVE (true), LOG_RETENTION_ENABLED (true). Details: docs/Operations_Guide.md.
- Migration 023 (maintenance_runs + date indexes on the log tables). Replaces the old housekeeping job.
- Tests: server/tests/logRetention.test.js (127 tests pass).

## 12. SD Master documents (24/10/2026)

- SD Master > Documents (button on each row, with the number attached) opens the documents of
  that SD Code: upload PDF / Word (.pdf, .doc, .docx) with a Document Type, Title and Remarks;
  View opens a PDF in a new browser tab; Download saves any version; New version keeps the
  earlier ones (History lists them); Delete asks for a reason.
- Files are checked by extension and by content (a renamed file is refused), up to
  DOCUMENT_MAX_MB (default 20 MB); the same file cannot be attached twice to an SD Code.
- Details are kept in the new SD Document Master table (sd_document_master, migration 024): one
  row per version with type, title, file name, size, SHA-256, uploaded by / date and, when
  deleted, by whom, when and why. Deleted documents and their files are kept.
- Files are stored on disk in DOCUMENT_DIR (web server: server\documents; desktop app:
  %APPDATA%\SD Maintenance\documents), one folder per SD Code. The nightly backup copies new
  document files to BACKUP_DIR\documents.
- Rights follow SD Master: View = see / view / download, Add or Edit = upload and new versions,
  Delete = delete. An SD Code with documents cannot be deleted until its documents are deleted.
- Audit Log: DOC_UPLOAD, DOC_VERSION, DOC_VIEW, DOC_DOWNLOAD, DOC_DELETE (table sd_document_master).
- Tests: server/tests/sdDocuments.test.js (140 tests pass).

## 13. SD Document Upload - bulk documents (26/10/2026)

- New menu SD Transaction > SD Document Upload (screen SD_DOCUMENT_UPLOAD; give users View and
  Upload in User Rights Master - administrators have it already).
- Download Template: S.No, SD Code / SD ID, Document Type (drop-down: LOI, Agreement, Registered
  Agreement, Addendum Agreement, Mail Approval, Payment Proof, Correspondence, Other), File Path;
  an Instructions sheet explains it.
- Bulk upload: choose the filled template and the folder holding the documents (or the files).
  Each row's File Path is matched to the chosen files by file name (folders decide when two files
  share a name). The browser cannot hand the server a path on the user's PC, so the files are sent
  from the chosen folder. Paths inside a shared folder listed in DOCUMENT_IMPORT_ROOTS (e.g.
  \fileserver\SD Documents; several separated by ;) are read by the server directly.
- Every row gets Success or Failed with the reason (SD not found, wrong type, not PDF/Word,
  duplicate row, file not chosen, invalid file content, same file already attached...). Each
  upload is a batch DOCB000001...; Upload history lists them and opens their rows.
- Deleting one document: SD Master > Documents (unchanged).
- Bulk delete (administrators only): by Upload Batch Number or Upload Date, with a check showing
  what will be deleted and a required reason. Documents are marked Deleted (kept for audit); a
  document that has had a new version uploaded outside the batch is skipped and listed.
- Migration 025 (sd_document_batches, sd_document_batch_rows, sd_document_master.batch_id, screen).
  Audit Log: DOC_BULK_UPLOAD, DOC_BULK_DELETE (plus DOC_UPLOAD per document).
- Tests: server/tests/sdDocumentBatches.test.js (145 tests pass).

## 14. Rent Schedule: escalation and waiver explained (26/10/2026)

- New columns on the Rent Schedule lines and in the export: Escalation Date (when the rate in
  force that month started, with the rule, e.g. "+5% · RCD rule, every 12 months"; "Base rent"
  before the first escalation), Waiver Period (rent-free dates touching the month and the number
  of rent-free days in it) and Remarks ("Escalation +5% from 02/05/2026 (RCD rule, every 12
  months)", "Rent-free 03/03/2026 - 02/05/2026 (30 days this month)", "Next escalation +5% on
  03/03/2027").
- Months where an escalation starts are shaded amber, rent-free months blue (screen and Excel),
  with a legend above the table. Export: new columns Escalation Date, Escalation Rule, Next
  Escalation Date, Waiver From, Waiver To, Waiver Days, Remarks (added at the end).
- Worked out when the schedule is read, from the Rent Code's rules and waivers (which cannot
  change for generated months), so schedules already generated show it without regenerating.
  No migration. A year of all Rent Codes (151,200 lines) adds about 0.7 s to the export.

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
| Rent Agreement Master | /rent/agreements | Nine components (Quantity × Rate × %), Individual / Transfer, Active / Inactive, lock once used |
| Rule Master | /rent/rules | RCD / LCD escalation chains, Normal Day periods, positive / zero / negative %; Bulk Edit (download existing rules, edit in Excel, upload) |
| Waiver Master | /rent/waivers | Rent-free periods (Yes / No), overlap and range checks; Bulk Edit (download existing waivers, edit in Excel, upload) |
| Rent Schedule | /rent/schedule | Generate / Regenerate, multi-select filters, period presets, summaries by Agreement Header / Cost Center / Landlord / Rent Code / Month, Excel and PDF export, generation history; Delete Schedule for a period (before a Bulk Edit) |

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

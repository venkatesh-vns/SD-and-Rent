# Security Deposit & Rent Management — Operations Guide

For whoever runs the server PC. Covers what runs by itself, what to check, and what to do when something needs attention.

## 1. Architecture

```
 Browsers / desktop app on office PCs ──HTTP(S)──►  Server PC (one, always on)
                                                    ├─ Primary process  (starts and watches the workers)
                                                    ├─ Web worker 1 … N (WEB_WORKERS, default = cores − 1, max 4)
                                                    │    load balanced round robin, each with its own response cache
                                                    │    worker 1 also runs reminders, nightly backup, log retention
                                                    └─ PostgreSQL (same PC; data, change notifications for the caches)
```

- **Load balancing:** requests are spread across the web workers; a long export, upload or schedule run keeps one worker busy while the others go on serving. A worker that stops is restarted automatically (System Health shows the restart count).
- **Sessions:** one login session per User ID; 30 minutes idle timeout; administrators can end sessions (User Master › Active sessions).
- **Caching:** the dashboard, reports' option lists, lookups and report pages are cached per worker and dropped the moment the underlying data changes (PostgreSQL notifies every worker). If the change notifications stop, caching switches itself off — figures are never stale.

## 2. Daily automatic jobs (no action needed)

| Time | Job | Where to see it |
|---|---|---|
| 08:00 | Lease-date reminder emails | Email Log |
| 01:30 | Database backup (`BACKUP_TIME`), checked by reading it back | System Health › Backups |
| 02:30 | Log retention (`LOG_RETENTION_TIME`): log entries older than 5 months archived and removed — see below | System Health › Log retention |

Backups kept: the last **14 daily** plus the newest of each of the last **12 months** (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY`), in `BACKUP_DIR` (desktop app: `%APPDATA%\SD Maintenance\backups`; web server: `server\backups`).

### Log retention (5 months)

Every night, log entries older than **5 months** (`LOG_RETENTION_MONTHS`) are written to a compressed archive file, the file is read back and its row count checked, and only then are those entries removed from the database. If the check fails nothing is deleted.

| Log | Kept for 5 months, then archived |
|---|---|
| Audit Log (`audit_log`) | by action date |
| Email Log (`email_log`) | by sent date — **except** reminders for a lease date still to come (they stop the same reminder being sent twice) |
| Upload history (`upload_batches`) | by upload date |
| Login sessions (`user_sessions`) | ended sessions (open sessions are never touched) |
| Backup and clean-up history (`backup_runs`, `maintenance_runs`) | by start time |
| Password-reset links | expired/used links are deleted (not archived) |
| Monitoring log files (`serverlogs*-YYYY-MM.log`) | moved to `log-archivemonitoring-logs` |
| Desktop app `app.log`, `postgres.log` | rotated at 10 MB; rotated files deleted after 5 months |

- **Never touched:** masters, SD and rent transactions, schedules and schedule runs, status history, users, settings — the job only works on the log tables above.
- **Archive folder:** `LOG_ARCHIVE_DIR` (web server: `serverlog-archive`; desktop app: `%APPDATA%SD Maintenancelog-archive`). One file per log and run: `audit_log_before_YYYY-MM-DD_<run>.jsonl.gz` — gzip, one JSON row per line; open with 7-Zip and any text editor, or load back with a short script if an old entry is ever needed. Copy it off the server along with the backups; delete archive files when your record-keeping policy allows.
- `LOG_ARCHIVE=false` deletes without archiving; `LOG_RETENTION_ENABLED=false` turns the job off.
- **Run log clean-up now** (System Health) runs it at once; only one run at a time. Each run is listed with what it archived.
- Measured on the 10-year test database: 100,800 audit entries archived and removed in 2 seconds (0.6 MB archive), all business tables unchanged; users can keep working while it runs (rows are removed in small batches).

**Copy backups off the server PC.** A backup on the same disk does not survive a disk failure. Point `BACKUP_DIR` at a network share or copy the folder to another location daily (for example with Windows Task Scheduler + `robocopy`).

## 3. System Health (Administration › System Health, administrators only)

| Tile | Healthy | Act when |
|---|---|---|
| Application | all workers running | a worker restarts repeatedly — check the server console / `logs\errors-YYYY-MM.log` |
| Requests | few or no errors; slow < 1% | errors appear — open the Server errors log on the page |
| Response cache | "listening for changes" | "not listening" — PostgreSQL restarted; it reconnects within seconds |
| Database | ping < 50 ms, ≥ 95% from memory | lower — the PC is short of memory or other programs compete |
| Connections | < 70% of the maximum | near the maximum — raise `max_connections` or reduce `WEB_WORKERS` |
| Last backup | within the last day, verified | older or failed — see the Backups table; run **Back up now** |
| Backup disk free | > 10 GB | low — clean the folder / move `BACKUP_DIR` |

Logs (`LOG_DIR`, default `server\logs`): `slow-requests-YYYY-MM.log` (requests over `SLOW_REQUEST_MS`, default 2 s; exports and uploads excluded) and `errors-YYYY-MM.log`. PostgreSQL logs statements slower than 2 s when the tuning script is applied.

## 4. Restoring a backup

Restore always goes into a **new** database first, so the live data is never at risk:

```
cd server
node scripts/restore.js --file=backups\sd_maintenance_20261023_013000.dump --db=sd_restore_check
```

It prints the record counts of the restored copy. To switch to it after checking: stop the application, rename the databases in pgAdmin (or set `DB_NAME` in `server\.env` to the restored one), start the application. Practise this once a quarter.

## 5. Security settings

| Setting | Default | Meaning |
|---|---|---|
| Account lockout | 5 wrong passwords → 15 minutes (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`) | shown in User Master (Login column); Reset Password unlocks |
| Login attempts per PC | 20 per 15 minutes (`AUTH_RATE_LIMIT`) | slows password guessing |
| Requests per PC | 3,000 per minute per worker (`API_RATE_LIMIT`) | stops a runaway script; normal use is far below |
| Sessions | one per User ID, 30 min idle (`SESSION_IDLE_MINUTES`) | Audit Log: LOGIN, LOGIN_BLOCKED, LOGIN_LOCKED, SESSION_END |
| Uploads | Excel only, 5 MB | |
| HTTPS | off | set `HTTPS_PFX_FILE` (+ `HTTPS_PFX_PASSPHRASE`) or `HTTPS_CERT_FILE` + `HTTPS_KEY_FILE` to a certificate from your IT team; users then open `https://<server>:<port>` |

Also: passwords are stored hashed (bcrypt), every change is in the Audit Log, PostgreSQL only listens on the server itself (desktop app), and dependencies are checked with `npm audit` before each release (the server and the screens' runtime packages have no known vulnerabilities as of 23/10/2026).

## 6. Scaling over the years

Measured limits and the tests behind them: `docs/Performance_Test_Report.md`. In short:

| Growth | What to do |
|---|---|
| Up to ~600 buildings / 3,500 landlords / 12 years of schedules (tested) | nothing beyond the recommended server |
| More users at once (40+) or a busier server | 8-core server, `WEB_WORKERS=6`; PostgreSQL settings script |
| Beyond ~1,200 buildings / 7,000 landlords (stress-tested) | dedicated database server; partition `rent_schedule_lines` by year (it is the only table that grows into the millions) |
| Each release | run `npm audit`, the automated tests and the load test (section 6 of the test report) |

Recommended server: 8 cores, 16 GB RAM, SSD, wired network, UPS; Windows updates scheduled outside office hours; the PostgreSQL settings in `database/tuning/postgresql_performance.sql` applied by a DBA.

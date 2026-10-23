# SD and Rent Application — Performance and Load Test Report

> Round 1 (22/10/2026). The latest results (round 2, 23/10/2026: 150 → 200 buildings, 600 → 1,000+ landlords, ₹100 Cr a month, 10-year projection, caching, monitoring, backups, endurance) are in docs/SD_Rent_Performance_Scalability_Report.docx and docs/SD_Rent_Performance_Report_Round2.html.

Branch `rent-module`, 22/10/2026. Tests ran on separate performance databases; UAT and production data were not used or changed.

## 1. Summary

| Question | Answer |
|---|---|
| Can 10–20 people use the application at the same time? | **Yes.** With 20 simultaneous, very active users on **3× today's volume**, a typical screen opened in **55 ms** and 95% of screens in under **1.3 s**, with no failures. |
| Will it keep up as buildings and landlords grow? | **Yes, to at least 5× today** (600 buildings, 3,000 landlords, 7.3 lakh Rent Schedule lines): typical screen **0.2 s**, no failures, heavy jobs completed while people kept working. |
| Is there headroom? | At **40 simultaneous users** (twice the expected peak) on 3× volume the application stayed error-free; typical screen 0.17 s, slowest screens 3–9 s. |
| Do bulk uploads, reports and dashboards slow everyone down? | Not any more. A Rent Schedule generation and a 1,000-row upload ran in the middle of each test; other screens stayed fast (typical 50–230 ms). Before the changes, one heavy job held everyone up for several seconds. |

The tests were run on a laptop (Intel i5-1235U, 16 GB RAM) that ran the database, the application **and** the 20–40 simulated users at the same time, so a dedicated server will do better than these figures.

## 2. What was tested

**Data volumes** (generated; amounts calibrated to today's ₹80 Cr a month at 1×):

| | Today (1×) | 3× | 5× |
|---|---|---|---|
| Buildings (cost centers) | 120 | 360 | 600 |
| Landlords | 600 | 1,800 | 3,000 |
| SD records / Rent Codes | 720 | 2,160 | 3,600 |
| SD transactions | 2,460 | 7,380 | 12,300 |
| Rules / waivers | 2,160 / 720 | 6,480 / 2,160 | 10,800 / 3,600 |
| Rent Schedule lines (7 financial years) | 1.46 lakh | 4.39 lakh | 7.32 lakh |
| Audit log entries | 28,800 | 86,400 | 1,44,000 |
| Rent per month (FY 2025-26) | ₹80 Cr | ₹339 Cr | ₹597 Cr |

**Users:** each simulated user logs in and keeps opening screens — SD Dashboard, SD Master, SD Transaction (all / one SD), SD Balance Report, Rent Schedule, SD & Rent Report, Rent masters, Audit Log — exactly as the browser does (all of a screen's requests together), with **2 seconds** between screens. Some users export to Excel or save an SD transaction. A real user pauses far longer, so 20 test users represent well over 20 real ones.

**Heavy jobs during the test:** Rent Schedule generation for one financial year for **all** Rent Codes, and a **1,000-row** SD transaction upload.

Timings are for a whole screen (the slowest of its requests). "Typical" = median; "95%" = 95 of 100 screen opens were at or below this.

## 3. Results

### Before and after the changes — 20 users, 3× volume

| Screen | Before: typical / 95% | After: typical / 95% |
|---|---|---|
| SD Dashboard | 410 ms / 2.8 s | 335 ms / 0.6 s |
| SD Master list | 27 ms / 1.7 s | 21 ms / 65 ms |
| SD Transaction (one SD) | 13 ms / 1.4 s | 11 ms / 23 ms |
| SD Transaction (all) | 85 ms / 1.1 s | 52 ms / 149 ms |
| SD Balance Report | 364 ms / 2.2 s | 215 ms / 495 ms |
| Rent Schedule | 216 ms / 1.1 s | 192 ms / 484 ms |
| SD & Rent Report (full year) | 4.6 s / 7.8 s | 1.2 s / 1.6 s |
| Save SD transaction | 35 ms / **13.7 s** | 21 ms / 36 ms |
| Export to Excel | 2.3 s / 4.8 s | 0.8 s / 3.5 s |
| **All screens** | **175 ms / 4.0 s** (slowest 16 s) | **55 ms / 1.3 s** (slowest 3.6 s) |
| 1,000-row SD transaction upload | 51 s | 6.9 s |

The "before" saves that failed were test-data validation refusals, not system errors; after the changes no request failed in any run.

### Growth and headroom

| Run | Requests / s | Typical screen | 95% of screens | Errors | Rent Schedule generation (1 FY, all Rent Codes) | 1,000-row upload |
|---|---|---|---|---|---|---|
| 3× volume, 20 users | 28 | 55 ms | 1.3 s | 0 | 15 s | 6.9 s |
| 3× volume, **40 users** | 46 | 169 ms | 3.7 s | 0 | 31 s | 19 s |
| **5× volume**, 20 users | 23 | 195 ms | 3.6 s | 0 | 38 s | 11 s |

At 5× volume with 20 users, per screen (typical / 95%): Dashboard 381 ms / 1.2 s, SD Master 57 ms / 0.7 s, SD Transaction 18 ms / 0.9 s, SD Balance 538 ms / 2.2 s, Rent Schedule 516 ms / 3.0 s, SD & Rent Report (full year) 2.9 s / 5.1 s, Excel exports 4.8 s / 12 s.

Full 7-year Rent Schedule generation for every Rent Code (an occasional, one-off task): 25 s at 1×, 78 s at 3×, 129 s at 5×.

## 4. What was changed

1. **Load balancing over the CPU cores.** The server now runs several web workers (default: one per core, up to 4) that share the same port; requests are handed out in turn. A long export, upload or schedule calculation keeps one worker busy while the others go on serving. Workers hold no session state (logins are tokens checked against the database), a worker that stops is restarted automatically, and the daily reminder emails run in exactly one worker. This applies to both the web server (`server.js`) and the desktop app's main PC. Setting: `WEB_WORKERS` (1 = single process).
2. **SD transaction look-ups.** Reading one transaction computed running balances for *every* SD Code first; it now reads only that SD Code's ledger. This made bulk uploads about 8× faster and removes a cost that grew with every transaction ever entered.
3. **Saving during an upload.** A save waited for a running upload to finish (up to 16 s) because of a stricter-than-needed lock; it now uses a lock that still prevents two conflicting ledger changes but does not wait for uploads.
4. **Indexes** (migration 019) for code look-ups used by uploads and screens (SD Code, Txn No., Rent Code, Cost Center), landlord, agreement and schedule-date filters, and the audit log.
5. **SD & Rent report filter list** no longer scans every transaction and schedule line (0.7 s → 24 ms).
6. **Compression** of responses (the dashboard sends about 1.4 MB of data at 5× volume; compressed it is roughly a tenth of that over the office network).
7. **Dashboard** sections are queried in parallel (up to 4 at a time) instead of one after another.
8. **Rent Schedule generation**: lines are saved in batches of 5,000 with array inserts, and the calculation pauses briefly every 25 Rent Codes so other requests on the same worker are not held up.
9. **PostgreSQL settings** for the desktop app's database are set on every start from the PC's memory (see section 5); before, PostgreSQL ran with its very small defaults.
10. Idle browser connections are kept open for 65 s (Node's default is 5 s), avoiding occasional dropped requests.

All 114 automated tests pass after the changes.

## 5. Recommendations

**Server PC.** Run the application on one always-on PC or server that everyone opens in the browser (the desktop app's "This PC holds the data" mode, or `server.js`): at least **4 CPU cores (8 preferred), 16 GB RAM, SSD storage**, wired network. Keep it free of other heavy work. The database can stay on the same machine at these volumes.

**PostgreSQL settings.** The desktop app applies these automatically. For a separately installed PostgreSQL, a DBA should apply `database/tuning/postgresql_performance.sql` and restart the PostgreSQL service (it raises shared memory from 128 MB to 1 GB, sets sort memory, SSD cost settings and slow-query logging). It affects every database on that PostgreSQL server, so it was **not** applied to this PC's PostgreSQL, which also holds production.

**Working practices.**
- Generate the Rent Schedule one financial year at a time (15–40 s); full multi-year regeneration is a one-off task for a quiet period.
- Excel exports of a full year at 5× volume take several seconds; a quarter is much quicker.

**When to look again** (none needed for the stated growth):
- beyond about **5× today's volume or 40 people working at once**: move PostgreSQL to its own server, raise `WEB_WORKERS` on a larger machine, and pre-calculate the dashboard and SD & Rent report totals;
- if the dashboard's Pending SD and landlord lists grow past a few thousand rows, page them instead of sending them all.

**Repeat the test** before major releases or when volumes grow (commands in section 6).

## 6. How to repeat the tests

From `server/` (performance databases are named `sd_rent_perf_*` and are dropped and re-created — never point these scripts at UAT or production):

```
node scripts/perf/seed.js --scale=3                       # builds sd_rent_perf_3x (about 2 minutes)
..\start-perf.bat sd_rent_perf_3x 5300                    # performance server on port 5300 (separate window)
node scripts/perf/loadtest.js --url=http://localhost:5300 --users=20 --duration=120 --think=2000 --jobs --out=result.json
node scripts/perf/profile.js --db=sd_rent_perf_3x "GET /api/dashboard"   # SQL time per statement for one request
```

Raw results of the runs above: `docs/perf/*.json`.

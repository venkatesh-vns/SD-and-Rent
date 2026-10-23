@echo off
rem Performance test server: port 5300 (or %2) against a performance database
rem made by server\scripts\perf\seed.js (default sd_rent_perf_3x). Never UAT or production.
rem   start-perf.bat sd_rent_perf_5x
cd /d "%~dp0server"
set DB_NAME=%~1
if "%DB_NAME%"=="" set DB_NAME=sd_rent_perf_3x
set PORT=%~2
if "%PORT%"=="" set PORT=5300
set EMAIL_DRY_RUN=true
set AUTH_RATE_LIMIT=100000
set API_RATE_LIMIT=1000000
set BACKUP_ENABLED=false
rem 3rd argument: CACHE_ENABLED (true / false) for a with / without cache comparison
if not "%~3"=="" set CACHE_ENABLED=%~3
node server.js

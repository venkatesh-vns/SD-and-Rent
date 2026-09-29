@echo off
REM Starts the SD Maintenance Application on this computer:
REM   API  -> http://localhost:5000  (server window)
REM   App  -> http://localhost:3000  (client window, opens the browser)
REM Close the two windows to stop the application.

cd /d "%~dp0"

start "SD Maintenance - API (port 5000)" cmd /k "cd /d "%~dp0server" && npm run dev"
start "SD Maintenance - App (port 3000)" cmd /k "cd /d "%~dp0client" && npm start"

echo.
echo Starting the SD Maintenance Application...
echo Your browser will open at http://localhost:3000 in about 20 seconds.
echo To stop the application, close the two windows that just opened.
timeout /t 8 >nul

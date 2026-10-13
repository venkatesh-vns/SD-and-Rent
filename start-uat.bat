@echo off
REM SD and Rent Maintenance Application - UAT
REM   App + API: http://localhost:5200   (database sd_rent_uat, emails in dry-run mode)
REM The screens are served by the API from client\build; rebuild them after
REM changing client code:  cd client  &&  npm run build
title SD and Rent UAT (port 5200)
cd /d "%~dp0server"
if not exist node_modules (
  echo Installing server packages...
  call npm install --no-audit --no-fund
)
if not exist "%~dp0client\build\index.html" (
  echo Building the screens...
  pushd "%~dp0client"
  if not exist node_modules call npm install --no-audit --no-fund
  call npm run build
  popd
)
call npm run migrate
node server.js

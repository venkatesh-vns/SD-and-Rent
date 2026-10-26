<#
  SD and Rent UAT - install the background service (same as the app's
  Settings > Run in the background). For IT, on the MAIN PC (the one that holds the data).

  Creates the scheduled task "SD and Rent UAT Server":
    - starts when Windows starts (30 s delay), whether or not anyone is logged on
    - runs as the Windows user who set up "This PC holds the data" (no password stored: S4U)
    - restarts every minute if it stops; no time limit; runs on battery too
  It keeps the database and the application server running while the screen is locked,
  the user is signed out or the app window is closed/minimised, and keeps the PC awake.

  Run in PowerShell **as Administrator**, signed in as (or naming) the user whose
  %APPDATA%\SD and Rent UAT folder holds the data:
    powershell -ExecutionPolicy Bypass -File .\Install-Background-Service.ps1
  Options: -InstallDir "<folder of SD and Rent UAT.exe>" -DataDir "<data folder>" -User "DOMAIN\user"
#>
param(
  [string]$InstallDir = "$env:ProgramFiles\SD and Rent UAT",
  [string]$DataDir = "$env:APPDATA\SD and Rent UAT",
  [string]$User = "$env:USERDOMAIN\$env:USERNAME"
)
$ErrorActionPreference = 'Stop'
$TaskName = 'SD and Rent UAT Server'
$Exe = Join-Path $InstallDir 'SD and Rent UAT.exe'
$Res = Join-Path $InstallDir 'resources'
$Script = Join-Path $Res 'app.asar.unpacked\service.js'
$Config = Join-Path $DataDir 'config.json'

if (-not (Test-Path $Exe)) { throw "SD and Rent UAT is not installed in $InstallDir (use -InstallDir)." }
if (-not (Test-Path $Script)) { throw "This install has no background service ($Script). Install UAT 2 (2.0.0-uat.2) or later first." }
if (-not (Test-Path $Config)) { throw "No data folder at $DataDir. Open SD and Rent UAT once and choose 'This PC holds the data' (or use -DataDir)." }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json
if ($cfg.mode -ne 'server') { throw "This PC is not set up to hold the data (config.json mode is '$($cfg.mode)')." }

# 1. Close the app first: it runs the server itself until it knows the service does
if (Get-Process 'SD and Rent UAT' -ErrorAction SilentlyContinue) {
  throw 'Close SD and Rent UAT on this PC first (File > Exit), then run this script again.'
}

# 2. The launcher the task runs
$ServiceDir = Join-Path $DataDir 'service'
New-Item -ItemType Directory -Force $ServiceDir | Out-Null
$Cmd = Join-Path $ServiceDir 'run-server.cmd'
@(
  '@echo off',
  'rem SD and Rent UAT background service - written by Install-Background-Service.ps1',
  'set ELECTRON_RUN_AS_NODE=1',
  "`"$Exe`" `"$Script`" --res `"$Res`" --data `"$DataDir`""
) | Set-Content -Path $Cmd -Encoding ASCII

# 3. The scheduled task
$action = New-ScheduledTaskAction -Execute $Cmd -WorkingDirectory $Res
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'SD and Rent UAT: database and application server for the connected PCs. Starts with Windows, runs whether or not the user is logged on.' -Force | Out-Null

# 4. Tell the app the service serves (the window then only shows the screens)
$cfg | Add-Member -NotePropertyName background -NotePropertyValue $true -Force
[IO.File]::WriteAllText($Config, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false)) # UTF-8 without BOM

# 5. Start it now and wait until it serves
Remove-Item (Join-Path $DataDir 'service.stop') -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
$port = $cfg.server.httpPort
for ($i = 0; $i -lt 90; $i++) {
  try { if ((Invoke-WebRequest "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { break } } catch { }
  Start-Sleep -Seconds 2
}
try {
  Invoke-WebRequest "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 3 | Out-Null
  Write-Host "OK: '$TaskName' is running on port $port for $User. Other PCs: http://$($env:COMPUTERNAME):$port" -ForegroundColor Green
} catch {
  Write-Warning "The task is registered but the server did not answer on port $port yet. See $DataDir\logs\service.log"
}

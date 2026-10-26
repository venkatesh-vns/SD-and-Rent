<#
  SD and Rent UAT - remove the background service (same as unticking the app's
  Settings > Run in the background). The data is not touched; afterwards the app
  window runs the server again whenever it is open.

  Run in PowerShell as Administrator on the main PC:
    powershell -ExecutionPolicy Bypass -File .\Remove-Background-Service.ps1
#>
param([string]$DataDir = "$env:APPDATA\SD and Rent UAT")
$ErrorActionPreference = 'Stop'
$TaskName = 'SD and Rent UAT Server'

# Ask the service to stop cleanly (database shut down properly), then remove the task
if (Test-Path (Join-Path $DataDir 'service-status.json')) {
  Set-Content -Path (Join-Path $DataDir 'service.stop') -Value 'remove'
  for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $DataDir 'service-status.json')); $i++) { Start-Sleep -Seconds 1 }
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$Config = Join-Path $DataDir 'config.json'
if (Test-Path $Config) {
  $cfg = Get-Content $Config -Raw | ConvertFrom-Json
  $cfg | Add-Member -NotePropertyName background -NotePropertyValue $false -Force
  [IO.File]::WriteAllText($Config, ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false)) # UTF-8 without BOM
}
Write-Host "Removed '$TaskName'. Open SD and Rent UAT to serve the other PCs from the app window." -ForegroundColor Green

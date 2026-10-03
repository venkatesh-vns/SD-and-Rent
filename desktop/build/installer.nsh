; Extra installer steps: let other PCs reach this one when it holds the data
; ("This PC holds the data" mode listens on the office network).
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SD Maintenance"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="SD Maintenance" dir=in action=allow program="$INSTDIR\SD Maintenance.exe" enable=yes profile=domain,private'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="SD Maintenance"'
!macroend

; Extra installer steps.
;  - Let other PCs reach this one when it holds the data ("This PC holds the data"
;    listens on the office network). The firewall rule is for the app's program,
;    which the background service also runs. The rule is named after the product,
;    so the production and UAT apps keep their own rules.
;  - Updates: the background service ("<product> Server" scheduled task, if turned
;    on) is asked to stop cleanly before files are replaced and started again after.
;    The data folder (%APPDATA%\<product>) is never touched by install, update or
;    uninstall.

!macro customInit
  ; Stop the background service, if it runs, so its files can be replaced
  Push $0
  Push $1
  SetShellVarContext current
  StrCpy $1 "$APPDATA\${PRODUCT_NAME}"
  SetShellVarContext all
  IfFileExists "$1\service-status.json" 0 sdm_no_service
    FileOpen $0 "$1\service.stop" w
    FileWrite $0 "installer"
    FileClose $0
    StrCpy $0 0
    sdm_wait:
      IfFileExists "$1\service-status.json" 0 sdm_no_service
      IntOp $0 $0 + 1
      IntCmp $0 90 sdm_give_up
      Sleep 1000
      Goto sdm_wait
    sdm_give_up:
      nsExec::Exec 'schtasks /End /TN "${PRODUCT_NAME} Server"'
  sdm_no_service:
  Pop $1
  Pop $0
!macroend

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="${PRODUCT_NAME}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=domain,private'
  ; Start the background service again (nothing happens when it is not turned on)
  nsExec::Exec 'schtasks /Run /TN "${PRODUCT_NAME} Server"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Real uninstall (not an update): remove the firewall rule and the background service
    nsExec::Exec 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
    nsExec::Exec 'schtasks /End /TN "${PRODUCT_NAME} Server"'
    nsExec::Exec 'schtasks /Delete /TN "${PRODUCT_NAME} Server" /F'
  ${endIf}
!macroend

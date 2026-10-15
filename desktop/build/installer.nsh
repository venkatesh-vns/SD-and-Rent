; Extra installer steps: let other PCs reach this one when it holds the data
; ("This PC holds the data" mode listens on the office network).
; The rule is named after the product, so the production and UAT apps keep their own rules.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="${PRODUCT_NAME}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=domain,private'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${PRODUCT_NAME}"'
!macroend

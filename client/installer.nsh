!macro customInstall
  ; Write the registry keys for the context menu
  WriteRegStr HKCR "*\shell\Shadownloader" "" "Share with Shadownloader"
  WriteRegStr HKCR "*\shell\Shadownloader\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1" --upload'

  WriteRegStr HKCR "*\shell\ShadownloaderE2EE" "" "Share with Shadownloader (E2EE)"
  WriteRegStr HKCR "*\shell\ShadownloaderE2EE\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1" --upload-e2ee'
!macroend

!macro customUninstall
  ; Clean up the registry keys on uninstall
  DeleteRegKey HKCR "*\shell\Shadownloader"
  DeleteRegKey HKCR "*\shell\ShadownloaderE2EE"
!macroend
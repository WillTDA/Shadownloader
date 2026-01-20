!macro customInstall
  ; Write the registry keys for the context menu
  WriteRegStr HKCR "*\shell\Dropgate" "" "Share with Dropgate"
  WriteRegStr HKCR "*\shell\Dropgate\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1" --upload'

  WriteRegStr HKCR "*\shell\DropgateE2EE" "" "Share with Dropgate (E2EE)"
  WriteRegStr HKCR "*\shell\DropgateE2EE\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1" --upload-e2ee'
!macroend

!macro customUninstall
  ; Clean up the registry keys on uninstall
  DeleteRegKey HKCR "*\shell\Dropgate"
  DeleteRegKey HKCR "*\shell\DropgateE2EE"
!macroend
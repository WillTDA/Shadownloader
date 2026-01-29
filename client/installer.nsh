!macro customInstall
  ; Write the registry keys for the context menu
  WriteRegStr HKCR "*\shell\Dropgate" "" "Share with Dropgate"
  WriteRegStr HKCR "*\shell\Dropgate\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1" --upload'
!macroend

!macro customUninstall
  ; Clean up the registry keys on uninstall
  DeleteRegKey HKCR "*\shell\Dropgate"
!macroend
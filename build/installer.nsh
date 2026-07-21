; Custom NSIS hooks for EG Launcher (electron-builder "nsis.include")
; Adds a Start Menu shortcut that launches the built-in uninstaller.

!macro customInstall
  ; Installer already creates "EG Launcher.lnk"; add matching uninstall entry.
  CreateShortCut "$SMPROGRAMS\Uninstall EG Launcher.lnk" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" "" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall EG Launcher.lnk"
!macroend

; Custom NSIS hooks for EG Launcher (electron-builder nsis.include)
;
; - Start Menu "Uninstall EG Launcher" shortcut
; - Uninstall checkbox: optionally remove all user data
;
; Uninstaller-only code must be guarded with BUILD_UNINSTALLER so the
; main installer compile does not hit NSIS warning 6020 (treated as error).

; ---- Install: Start Menu uninstall shortcut ----
!macro customInstall
  CreateShortCut "$SMPROGRAMS\Uninstall EG Launcher.lnk" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" "" "$INSTDIR\Uninstall ${PRODUCT_NAME}.exe" 0
!macroend

; ---- Uninstall UI + data wipe (uninstaller compile only) ----
!ifdef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"

  Var EgDeleteDataDialog
  Var EgDeleteDataCheckbox
  Var EgDeleteDataState

  Function un.EgDeleteDataPageCreate
    nsDialogs::Create 1018
    Pop $EgDeleteDataDialog

    ${NSD_CreateLabel} 0 0 100% 36u "This will uninstall EG Launcher from your computer.$\r$\n$\r$\nYour game data is kept by default so you can reinstall later without losing instances."
    Pop $0

    ${NSD_CreateCheckbox} 0 50u 100% 24u "Remove all data (settings, Microsoft/offline accounts, instances, mods, cache)"
    Pop $EgDeleteDataCheckbox
    ${NSD_SetState} $EgDeleteDataCheckbox ${BST_UNCHECKED}

    ${NSD_CreateLabel} 0 80u 100% 28u "If checked, this permanently deletes EG Launcher folders under your AppData."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function un.EgDeleteDataPageLeave
    ${NSD_GetState} $EgDeleteDataCheckbox $EgDeleteDataState
  FunctionEnd
!endif

; Inserted only when building the uninstaller (assistedInstaller.nsh)
!macro customUnWelcomePage
  UninstPage custom un.EgDeleteDataPageCreate un.EgDeleteDataPageLeave
!macroend

; Runs at end of uninstall section
!macro customUnInstall
  Delete "$SMPROGRAMS\Uninstall EG Launcher.lnk"

  !ifdef BUILD_UNINSTALLER
    ${If} $EgDeleteDataState == ${BST_CHECKED}
      ; Electron userData is %APPDATA%\eg-launcher (migrate.ts)
      SetShellVarContext current

      RMDir /r "$APPDATA\eg-launcher"
      RMDir /r "$APPDATA\EG Launcher"
      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif

      RMDir /r "$APPDATA\pulse-launcher"
      RMDir /r "$APPDATA\hive-launcher"

      RMDir /r "$LOCALAPPDATA\eg-launcher"
      RMDir /r "$LOCALAPPDATA\EG Launcher"
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
      !endif
    ${EndIf}
  !endif
!macroend

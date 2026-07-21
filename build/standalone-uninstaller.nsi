; Standalone helper: finds EG Launcher uninstall entry and runs it.
; Optional checkbox: pass --delete-app-data (and our custom UI still shows in the main uninstaller).
; Compiled by scripts/build-win-uninstaller.mjs

!include "LogicLib.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"
!include "MUI2.nsh"

Name "Uninstall EG Launcher"
BrandingText "EG Launcher"
OutFile "${OUT_FILE}"
Unicode true
RequestExecutionLevel user
ShowInstDetails show

Var UninstallCmd
Var Found
Var EnumIndex
Var KeyName
Var DisplayName
Var DeleteDataState
Var Dialog
Var DeleteCheckbox

!define MUI_ABORTWARNING
!define MUI_PAGE_CUSTOMFUNCTION_SHOW StandaloneWelcomeShow
!insertmacro MUI_PAGE_WELCOME
Page custom DeleteDataPageCreate DeleteDataPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function StandaloneWelcomeShow
  ; MUI welcome text is fine as-is
FunctionEnd

Function DeleteDataPageCreate
  nsDialogs::Create 1018
  Pop $Dialog

  ${NSD_CreateLabel} 0 0 100% 40u "This helper will launch the EG Launcher uninstaller registered on this PC.$\r$\n$\r$\nChoose whether to also wipe all launcher data."
  Pop $0

  ${NSD_CreateCheckbox} 0 55u 100% 24u "Remove all data (settings, accounts, instances, mods, cache)"
  Pop $DeleteCheckbox
  ${NSD_SetState} $DeleteCheckbox ${BST_UNCHECKED}

  nsDialogs::Show
FunctionEnd

Function DeleteDataPageLeave
  ${NSD_GetState} $DeleteCheckbox $DeleteDataState
FunctionEnd

Function .onInit
  StrCpy $Found "0"
  StrCpy $UninstallCmd ""
  StrCpy $DeleteDataState ${BST_UNCHECKED}

  Call SearchHKCU
  ${If} $Found == "0"
    SetRegView 64
    Call SearchHKLM
    ${If} $Found == "0"
      SetRegView 32
      Call SearchHKLM
    ${EndIf}
    SetRegView lastused
  ${EndIf}

  ${If} $Found == "0"
    MessageBox MB_ICONEXCLAMATION|MB_OK "EG Launcher does not appear to be installed.$\r$\n$\r$\nYou can also remove it from Windows Settings → Apps → Installed apps."
    Abort
  ${EndIf}
FunctionEnd

Function IsEgLauncherName
  StrCpy $R9 "0"
  StrCmp $DisplayName "EG Launcher" match
  StrCpy $R8 $DisplayName 11
  StrCmp $R8 "EG Launcher" match
  Return
  match:
    StrCpy $R9 "1"
FunctionEnd

Function SearchHKCU
  StrCpy $EnumIndex 0
  cu_loop:
    EnumRegKey $KeyName HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $EnumIndex
    StrCmp $KeyName "" cu_done
    ReadRegStr $DisplayName HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "DisplayName"
    Call IsEgLauncherName
    ${If} $R9 == "1"
      ; Prefer interactive UninstallString so our custom checkbox page appears
      ReadRegStr $UninstallCmd HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "UninstallString"
      ${If} $UninstallCmd == ""
        ReadRegStr $UninstallCmd HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "QuietUninstallString"
      ${EndIf}
      ${If} $UninstallCmd != ""
        StrCpy $Found "1"
        Goto cu_done
      ${EndIf}
    ${EndIf}
    IntOp $EnumIndex $EnumIndex + 1
    Goto cu_loop
  cu_done:
FunctionEnd

Function SearchHKLM
  StrCpy $EnumIndex 0
  lm_loop:
    EnumRegKey $KeyName HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $EnumIndex
    StrCmp $KeyName "" lm_done
    ReadRegStr $DisplayName HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "DisplayName"
    Call IsEgLauncherName
    ${If} $R9 == "1"
      ReadRegStr $UninstallCmd HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "UninstallString"
      ${If} $UninstallCmd == ""
        ReadRegStr $UninstallCmd HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "QuietUninstallString"
      ${EndIf}
      ${If} $UninstallCmd != ""
        StrCpy $Found "1"
        Goto lm_done
      ${EndIf}
    ${EndIf}
    IntOp $EnumIndex $EnumIndex + 1
    Goto lm_loop
  lm_done:
FunctionEnd

Section "Remove EG Launcher"
  ; If user checked "remove all data", append electron-builder flag AND our page will also run
  ${If} $DeleteDataState == ${BST_CHECKED}
    StrCpy $UninstallCmd "$UninstallCmd --delete-app-data"
    DetailPrint "Will request full data removal (--delete-app-data)"
  ${EndIf}

  DetailPrint "Running: $UninstallCmd"
  ExecWait '$UninstallCmd' $0
  DetailPrint "Exit code: $0"
  ${If} $0 == 0
    MessageBox MB_ICONINFORMATION|MB_OK "EG Launcher uninstall finished."
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Uninstall returned code $0.$\r$\nIf the app is still present, use Windows Settings → Apps."
  ${EndIf}
SectionEnd

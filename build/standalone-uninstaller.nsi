; Standalone helper: finds EG Launcher in Windows Uninstall registry and runs it.
; Compiled by scripts/build-win-uninstaller.mjs

!include "LogicLib.nsh"
!include "x64.nsh"

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

Function .onInit
  StrCpy $Found "0"
  StrCpy $UninstallCmd ""

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
  ; $DisplayName in → $R9 = 1 if match
  StrCpy $R9 "0"
  StrCmp $DisplayName "EG Launcher" match
  ; Starts with "EG Launcher" (versioned names)
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
      ReadRegStr $UninstallCmd HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "QuietUninstallString"
      ${If} $UninstallCmd == ""
        ReadRegStr $UninstallCmd HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "UninstallString"
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
      ReadRegStr $UninstallCmd HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "QuietUninstallString"
      ${If} $UninstallCmd == ""
        ReadRegStr $UninstallCmd HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$KeyName" "UninstallString"
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

Section "Uninstall"
  DetailPrint "Running: $UninstallCmd"
  ; UninstallString is typically quoted path + args — ExecWait needs proper parsing
  ExecWait '$UninstallCmd' $0
  DetailPrint "Exit code: $0"
  ${If} $0 == 0
    MessageBox MB_ICONINFORMATION|MB_OK "EG Launcher uninstall finished."
  ${Else}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Uninstall returned code $0.$\r$\nIf the app is still present, use Windows Settings → Apps."
  ${EndIf}
SectionEnd

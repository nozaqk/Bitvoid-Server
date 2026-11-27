; BitVoid Server Windows Installer (Inno Setup 6+)
; Bundles: pinned Node.js runtime, BitVoid Server core, native Qt 6 Desktop Dashboard,
; Start Menu shortcuts, and Windows Service lifecycle integration.
; Upgrades and uninstalls NEVER delete %ProgramData%\BitVoidServer user data automatically.

#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif

[Setup]
AppId={{8D4F62C1-4287-4929-9F6B-74C9C1F3B82A}
AppName=BitVoid Server
AppVersion={#MyAppVersion}
AppPublisher=BitVoid
DefaultDirName={autopf}\BitVoid Server
DefaultGroupName=BitVoid Server
DisableProgramGroupPage=yes
OutputDir=..\..\dist
OutputBaseFilename=BitVoid-Server-{#MyAppVersion}-windows-x64-setup
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Staged bundle directory prepared by CI: dist\stage-windows\*
Source: "..\..\dist\stage-windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\BitVoid Server Dashboard"; Filename: "{app}\desktop\bitvoid-server-desktop.exe"
Name: "{group}\Uninstall BitVoid Server"; Filename: "{uninstallexe}"
Name: "{autodesktop}\BitVoid Server Dashboard"; Filename: "{app}\desktop\bitvoid-server-desktop.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for BitVoid Server Dashboard"; GroupDescription: "Additional shortcuts:"
Name: "installservice"; Description: "Install and start BitVoid Server background Windows Service"; GroupDescription: "Background service:"; Flags: checkedonce

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\windows\install-service.ps1"" -Action install -InstallDir ""{app}"""; StatusMsg: "Configuring BitVoid Server background service..."; Flags: runhidden waituntilterminated; Tasks: installservice
Filename: "{app}\desktop\bitvoid-server-desktop.exe"; Description: "Launch BitVoid Server Dashboard"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\windows\install-service.ps1"" -Action uninstall -InstallDir ""{app}"""; Flags: runhidden waituntilterminated

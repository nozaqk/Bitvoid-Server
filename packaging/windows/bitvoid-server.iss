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
Filename: "{app}\desktop\bitvoid-server-desktop.exe"; Description: "Launch BitVoid Server Dashboard"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\windows\install-service.ps1"" -Action uninstall -InstallDir ""{app}"""; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  ServiceScript: string;
  PowerShellParams: string;
begin
  if CurStep = ssInstall then
  begin
    { Stop the previous service before Inno Setup replaces the wrapper executable. }
    PowerShellParams :=
      '-NoProfile -ExecutionPolicy Bypass -Command "$s=Get-Service -Name BitVoidServer -ErrorAction SilentlyContinue; if($s -and $s.Status -ne ''Stopped''){ Stop-Service -InputObject $s -Force; $s.WaitForStatus(''Stopped'', [TimeSpan]::FromSeconds(30)) }"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      PowerShellParams, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Could not start PowerShell to stop the previous BitVoid Server service.');
    if ResultCode <> 0 then
      RaiseException('Could not stop the previous BitVoid Server service before upgrading.');
  end;

  if CurStep = ssPostInstall then
  begin
    ServiceScript := ExpandConstant('{app}\packaging\windows\install-service.ps1');
    if WizardIsTaskSelected('installservice') then
      PowerShellParams := '-NoProfile -ExecutionPolicy Bypass -File "' + ServiceScript +
        '" -Action install -InstallDir "' + ExpandConstant('{app}') + '"'
    else
      PowerShellParams := '-NoProfile -ExecutionPolicy Bypass -File "' + ServiceScript +
        '" -Action uninstall -InstallDir "' + ExpandConstant('{app}') + '"';

    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      PowerShellParams, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Could not start PowerShell to configure the BitVoid Server service.');
    if ResultCode <> 0 then
      RaiseException('BitVoid Server service configuration failed. Review the installer log and try again.');
  end;
end;

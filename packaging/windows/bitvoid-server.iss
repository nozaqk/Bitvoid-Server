; AirMesh Server Windows Installer (Inno Setup 6+)
; Bundles: pinned Node.js runtime, AirMesh Server core, native Qt 6 Desktop Dashboard,
; Start Menu shortcuts, and Windows Service lifecycle integration.
; Upgrades and uninstalls NEVER delete %ProgramData%\BitVoidServer user data automatically.

#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif

[Setup]
AppId={{8D4F62C1-4287-4929-9F6B-74C9C1F3B82A}
AppName=AirMesh Server
AppVersion={#MyAppVersion}
AppPublisher=AirMesh
DefaultDirName={autopf}\BitVoid Server
DefaultGroupName=AirMesh Server
DisableProgramGroupPage=yes
OutputDir=..\..\dist
OutputBaseFilename=AirMesh-Server-{#MyAppVersion}-windows-x64-setup
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "stop-previous-service.ps1"; DestDir: "{tmp}"; Flags: dontcopy deleteafterinstall
; Staged bundle directory prepared by CI: dist\stage-windows\*
Source: "..\..\dist\stage-windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AirMesh Server Dashboard"; Filename: "{app}\desktop\bitvoid-server-desktop.exe"
Name: "{group}\Uninstall AirMesh Server"; Filename: "{uninstallexe}"
Name: "{autodesktop}\AirMesh Server Dashboard"; Filename: "{app}\desktop\bitvoid-server-desktop.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for AirMesh Server Dashboard"; GroupDescription: "Additional shortcuts:"
Name: "installservice"; Description: "Install and start AirMesh Server background Windows Service"; GroupDescription: "Background service:"; Flags: checkedonce

[Run]
Filename: "{app}\desktop\bitvoid-server-desktop.exe"; Description: "Launch AirMesh Server Dashboard"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\windows\install-service.ps1"" -Action uninstall -InstallDir ""{app}"""; Flags: runhidden waituntilterminated

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  ServiceScript: string;
  PowerShellParams: string;
  StopLog: string;
begin
  if CurStep = ssInstall then
  begin
    // Stop the previous service before Inno Setup replaces the wrapper executable.
    // The script is extracted to the temp dir and logs to airmesh-stop.log there for diagnosis.
    ExtractTemporaryFile('stop-previous-service.ps1');
    StopLog := ExpandConstant('{tmp}\airmesh-stop.log');
    PowerShellParams := '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\stop-previous-service.ps1') +
      '" -ServiceName BitVoidServer -InstallDir "' + ExpandConstant('{app}') +
      '" -LogPath "' + StopLog + '"';
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      PowerShellParams, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      RaiseException('Could not start PowerShell to stop the previous AirMesh Server service.');
    if ResultCode <> 0 then
      RaiseException('Could not stop the previous AirMesh Server service before upgrading. ' +
        'Stop the "AirMesh Server" service in Services (or uninstall the previous version), then run setup again. ' +
        'Details: ' + StopLog);
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
      RaiseException('Could not start PowerShell to configure the AirMesh Server service.');
    if ResultCode <> 0 then
      RaiseException('AirMesh Server service configuration failed. Review the installer log and try again.');
  end;
end;

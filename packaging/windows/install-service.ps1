param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("install", "uninstall", "start", "stop", "restart")]
    [string]$Action,

    [string]$InstallDir = "$env:ProgramFiles\BitVoid Server",
    [string]$DataDir = "$env:ProgramData\BitVoidServer"
)

$ErrorActionPreference = "Stop"
$ServiceName = "BitVoidServer"
$EnvFile = Join-Path $DataDir "server.env"

function Ensure-DataAndConfig {
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
    if (-not (Test-Path $EnvFile)) {
        $bytes = New-Object byte[] 48
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes)
        @(
            "BITVOID_TOKEN_SECRET=$secret"
            "BITVOID_HOST=0.0.0.0"
            "BITVOID_PORT=8787"
            "BITVOID_DISPLAY_NAME=BitVoid Local Server"
            "BITVOID_USE_OS_DATA_DIR=true"
            "BITVOID_DATA_DIR=$DataDir"
            "BITVOID_DEPLOYMENT_MODE=self-hosted"
            "BITVOID_NETWORK_MODE=lan"
        ) | Set-Content -Path $EnvFile -Encoding UTF8
        # Restrict permissions on server.env to Administrators and SYSTEM
        icacls $EnvFile /inheritance:r /grant:r "SYSTEM:(F)" "Administrators:(F)" | Out-Null
    }
}

switch ($Action) {
    "install" {
        Ensure-DataAndConfig
        $NodeExe = Join-Path $InstallDir "runtime\node.exe"
        $EntryJs = Join-Path $InstallDir "server\src\server.js"
        $RunnerCmd = "`"$NodeExe`" `"$EntryJs`""

        # Create or update scheduled boot task / service launcher cleanly preserving user data.
        $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            sc.exe delete $ServiceName | Out-Null
            Start-Sleep -Seconds 2
        }

        # Register private-network firewall rule only (NEVER public profile)
        if (-not (Get-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private | Out-Null
        }

        Write-Host "BitVoid Server data directory initialized at $DataDir (existing data preserved)."
        Write-Host "Configured runner: $RunnerCmd"
    }
    "uninstall" {
        $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            sc.exe delete $ServiceName | Out-Null
        }
        Write-Host "BitVoid Server service removed. User data at $DataDir was intentionally preserved."
    }
    "start"   { Start-Service -Name $ServiceName }
    "stop"    { Stop-Service -Name $ServiceName -Force }
    "restart" { Restart-Service -Name $ServiceName -Force }
}

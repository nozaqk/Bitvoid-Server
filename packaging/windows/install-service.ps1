param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("install", "uninstall", "start", "stop", "restart")]
    [string]$Action,
    [string]$InstallDir = "$env:ProgramFiles\BitVoid Server",
    [string]$DataDir = "$env:ProgramData\BitVoidServer"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ServiceName = "BitVoidServer"
$EnvFile = Join-Path $DataDir "server.env"
$WrapperExe = Join-Path $InstallDir "BitVoidServer.exe"

function Invoke-WinSw {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    if (-not (Test-Path -LiteralPath $WrapperExe -PathType Leaf)) {
        throw "The BitVoid Server service wrapper is missing: $WrapperExe"
    }
    & $WrapperExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "BitVoid Server service wrapper command failed: $($Arguments -join ' ') (exit $LASTEXITCODE)"
    }
}

function Ensure-DataAndConfig {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $DataDir "service-logs") -Force | Out-Null
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        $bytes = New-Object byte[] 48
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = [Convert]::ToBase64String($bytes)
        $lines = @(
            "BITVOID_TOKEN_SECRET=$secret"
            "BITVOID_HOST=0.0.0.0"
            "BITVOID_PORT=8787"
            "BITVOID_DISPLAY_NAME=BitVoid Local Server"
            "BITVOID_USE_OS_DATA_DIR=true"
            "BITVOID_DATA_DIR=$DataDir"
            "BITVOID_DEPLOYMENT_MODE=self-hosted"
            "BITVOID_NETWORK_MODE=lan"
        )
        [System.IO.File]::WriteAllText(
            $EnvFile,
            (($lines -join [Environment]::NewLine) + [Environment]::NewLine),
            [System.Text.UTF8Encoding]::new($false)
        )
    }

    # Restrict the database, media, backups, logs, and token secret to SYSTEM and local administrators.
    & icacls.exe $DataDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" /T /C | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not secure the BitVoid Server data directory ACL."
    }
}

function Remove-ExistingService {
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $existing) { return }

    if ($existing.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    if (Test-Path -LiteralPath $WrapperExe -PathType Leaf) {
        try {
            Invoke-WinSw -Arguments @("uninstall")
        } catch {
            & sc.exe delete $ServiceName | Out-Null
        }
    } else {
        & sc.exe delete $ServiceName | Out-Null
    }
    $remaining = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "The previous BitVoid Server service could not be removed."
}

switch ($Action) {
    "install" {
        Ensure-DataAndConfig
        if (-not (Test-Path -LiteralPath (Join-Path $InstallDir "runtime\node.exe") -PathType Leaf)) {
            throw "Bundled Node.js runtime was not found under $InstallDir."
        }
        if (-not (Test-Path -LiteralPath (Join-Path $InstallDir "server\src\server.js") -PathType Leaf)) {
            throw "BitVoid Server entry point was not found under $InstallDir."
        }
        if (-not (Test-Path -LiteralPath (Join-Path $InstallDir "BitVoidServer.xml") -PathType Leaf)) {
            throw "BitVoid Server service configuration is missing."
        }

        Remove-ExistingService
        Invoke-WinSw -Arguments @("install")
        Start-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

        if (-not (Get-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private | Out-Null
        }
        Write-Host "BitVoid Server Windows Service installed and started."
        Write-Host "Persistent data is stored at $DataDir and will be preserved by upgrades and uninstall."
    }
    "uninstall" {
        Remove-ExistingService
        Remove-NetFirewallRule -DisplayName "BitVoid Server (Private LAN)" -ErrorAction SilentlyContinue
        Write-Host "BitVoid Server service removed. Persistent data at $DataDir was intentionally preserved."
    }
    "start" {
        Start-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
    }
    "stop" {
        Stop-Service -Name $ServiceName -Force
        (Get-Service -Name $ServiceName).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    "restart" {
        Restart-Service -Name $ServiceName -Force
        (Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
    }
}

# Stops a previously installed AirMesh Server service before the installer replaces its files.
# Called by bitvoid-server.iss (ssInstall). Windows PowerShell 5.1 compatible.
#
# Exit codes:
#   0  service absent, or stopped (possibly after a forced stop of its own processes)
#   2  service (or its wrapper/node processes) still running; installer must not overwrite files
param(
    [string]$ServiceName = "BitVoidServer",
    [string]$InstallDir = "",
    [string]$LogPath = ""
)

$ErrorActionPreference = "Continue"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "s"), $Message
    Write-Output $line
    if ($LogPath) {
        try { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 } catch { }
    }
}

function Get-ServiceState {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -eq $svc) { return "Absent" }
    return [string]$svc.Status
}

function Wait-ServiceStopped([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $state = Get-ServiceState
        if ($state -eq "Absent" -or $state -eq "Stopped") { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

try {
    $state = Get-ServiceState
    Write-Log "Service '$ServiceName' state before upgrade: $state"
    if ($state -eq "Absent" -or $state -eq "Stopped") {
        exit 0
    }

    # 1. Ask the service control manager to stop it.
    Write-Log "Requesting stop of '$ServiceName' via sc.exe."
    & sc.exe stop $ServiceName | ForEach-Object { Write-Log "sc: $_" }
    if (Wait-ServiceStopped 45) {
        Write-Log "Service '$ServiceName' stopped."
        exit 0
    }

    # 2. Force-stop the service's own process tree (WinSW wrapper and node child).
    Write-Log "Service did not stop in time. Force-stopping its processes."
    $pids = @()
    $cim = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if ($cim -and [int]$cim.ProcessId -gt 0) { $pids += [int]$cim.ProcessId }
    if ($InstallDir) {
        $prefix = $InstallDir.TrimEnd('\') + '\'
        Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
            ForEach-Object { $pids += [int]$_.ProcessId }
    }
    $pids | Select-Object -Unique | ForEach-Object {
        try {
            Stop-Process -Id $_ -Force -ErrorAction Stop
            Write-Log "Stopped process $_."
        } catch {
            Write-Log "Could not stop process ${_}: $($_.Exception.Message)"
        }
    }

    if (Wait-ServiceStopped 20) {
        Write-Log "Service '$ServiceName' stopped after forced process stop."
        exit 0
    }

    Write-Log "Service '$ServiceName' is still $(Get-ServiceState). Files cannot be replaced safely."
    exit 2
} catch {
    Write-Log "Unexpected error: $($_.Exception.Message)"
    exit 2
}

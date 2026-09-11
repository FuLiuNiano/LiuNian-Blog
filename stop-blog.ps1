$ErrorActionPreference = 'Continue'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runDir = Join-Path $projectRoot '.run'
$pidFile = Join-Path $runDir 'leaf-server.pid'

function Stop-TrackedProcess([int]$processId) {
    if ($processId -le 0) { return $false }
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return $false }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Stop-ProjectJsonServer {
    $projectPattern = [regex]::Escape($projectRoot)
    $stoppedAny = $false
    $listeners = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $ownerPid = [int]$listener.OwningProcess
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
        $commandLine = [string]$processInfo.CommandLine
        if ($commandLine -match $projectPattern -and $commandLine -match '(?i)(node|node\.exe).*server\.js') {
            if (Stop-TrackedProcess -processId $ownerPid) { $stoppedAny = $true }
        }
    }
    return $stoppedAny
}

$stopped = $false
if (Test-Path -LiteralPath $pidFile) {
    $pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    $blogPid = 0
    if ([int]::TryParse($pidText, [ref]$blogPid)) {
        $stopped = Stop-TrackedProcess -processId $blogPid
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (Stop-ProjectJsonServer) { $stopped = $true }

if (Test-NetConnection 127.0.0.1 -Port 8080 -InformationLevel Quiet -WarningAction SilentlyContinue) {
    Write-Warning 'Port 8080 is still in use. It may belong to another program or require Administrator permission.'
}

if ($stopped) {
Write-Host 'Leaf blog stopped.' -ForegroundColor Green
} else {
Write-Host 'No Leaf blog process recorded by the start script was found.' -ForegroundColor Yellow
}

Write-Host 'Runtime: Node.js with SQLite storage.'

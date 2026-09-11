param(
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$blogPort = if ($Port -gt 0) {
    $Port
} elseif ($env:BLOG_PORT -match '^\d+$') {
    [int]$env:BLOG_PORT
} elseif ($env:PORT -match '^\d+$') {
    [int]$env:PORT
} else {
    8080
}
if ($blogPort -lt 1 -or $blogPort -gt 65535) {
    throw 'Port must be between 1 and 65535.'
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runDir = Join-Path $projectRoot '.run'
$logDir = Join-Path $projectRoot 'logs'
$pidFile = Join-Path $runDir 'leaf-server.pid'
$logFile = Join-Path $logDir 'json-server.log'
$errorLogFile = Join-Path $logDir 'json-server-error.log'

New-Item -ItemType Directory -Path $runDir, $logDir -Force | Out-Null

function Find-NodeExecutable {
    $nodeHome = [Environment]::GetEnvironmentVariable('NODE_HOME')
    if ($nodeHome) {
        $candidate = Join-Path $nodeHome 'node.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    $fallback = 'D:\\node.js\\node.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }

    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Test-LocalPort([int]$port) {
    return Test-NetConnection 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
}

function Stop-TrackedProcess([int]$processId) {
    if ($processId -le 0) { return }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

if (Test-LocalPort $blogPort) {
    Write-Host "Blog is already running: http://localhost:$blogPort" -ForegroundColor Green
    exit 0
}

$nodeExe = Find-NodeExecutable
if (-not $nodeExe) { throw 'Node.js was not found. Expected D:\\node.js\\node.exe.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'server.js'))) {
    throw 'server.js was not found in the project directory.'
}

# Use -Port NUMBER or BLOG_PORT to override the default port 8080.
$env:PORT = [string]$blogPort
if (-not $env:BLOG_HOST) { $env:BLOG_HOST = '127.0.0.1' }
$env:HOST = $env:BLOG_HOST

Remove-Item -LiteralPath $logFile, $errorLogFile -Force -ErrorAction SilentlyContinue
$nodeProcess = Start-Process -FilePath $nodeExe `
    -ArgumentList @('server.js') `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errorLogFile `
    -WindowStyle Hidden `
    -PassThru

Set-Content -LiteralPath $pidFile -Value $nodeProcess.Id -Encoding ASCII
$started = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-LocalPort $blogPort) {
        $started = $true
        break
    }
    if (-not (Get-Process -Id $nodeProcess.Id -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Seconds 1
}

if (-not $started) {
    Stop-TrackedProcess -processId $nodeProcess.Id
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Leaf blog failed to start. Recent logs:' -ForegroundColor Red
    if (Test-Path -LiteralPath $errorLogFile) { Get-Content -LiteralPath $errorLogFile -Tail 30 }
    if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Tail 30 }
    exit 1
}

Write-Host "Leaf blog started: http://localhost:$blogPort" -ForegroundColor Green
Write-Host 'Runtime: Node.js with SQLite storage.'
Write-Host "Log directory: $logDir"

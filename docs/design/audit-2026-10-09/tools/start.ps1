$ErrorActionPreference = 'Stop'
$taskRoot = 'D:/CodexScratch/Taskira-UI-Audit-20261009'
$taskRuntime = "$taskRoot-runtime"
$taskPgBin = 'C:/Program Files/PostgreSQL/18/bin'
$taskProcessFile = "$taskRuntime/processes.json"
if ((Resolve-Path -LiteralPath $taskRoot).Path -notlike 'D:\*') { throw 'Audit checkout must be on D' }
$env:TEMP = "$taskRuntime/temp"
$env:TMP = $env:TEMP
$env:npm_config_cache = "$taskRuntime/npm-cache"
New-Item -ItemType Directory -Path "$taskRuntime/temp","$taskRuntime/logs" -Force | Out-Null
$taskNode = (Get-Command node).Source
function Get-RegisteredProcess($Record, [string]$Kind) {
    if ($null -eq $Record -or $Record.root -ne $taskRoot) { return $null }
    $taskId = $Record."${Kind}Pid"
    $taskStart = $Record."${Kind}StartedAt"
    if (-not $taskId -or -not $taskStart) { return $null }
    $taskProcess = Get-Process -Id $taskId -ErrorAction SilentlyContinue
    if ($null -eq $taskProcess) { return $null }
    if ($taskProcess.StartTime.ToUniversalTime().Ticks -ne ([datetime]$taskStart).ToUniversalTime().Ticks) { return $null }
    return $taskProcess
}
Push-Location -LiteralPath $taskRoot
try {
    & $taskNode './docs/design/audit-2026-10-09/tools/setup.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Database setup failed' }
    if (-not (Test-Path -LiteralPath "$taskRuntime/fixture.json")) {
        & $taskNode '--env-file=server/.env.audit' '--import' 'tsx' './docs/design/audit-2026-10-09/tools/seed.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Fixture seed failed' }
    }
    if (-not (Test-Path -LiteralPath "$taskRoot/server/dist/index.js")) {
        & npm.cmd run build --prefix server
        if ($LASTEXITCODE -ne 0) { throw 'API build failed' }
    }
    $taskPrevious = if (Test-Path -LiteralPath $taskProcessFile) { Get-Content -LiteralPath $taskProcessFile -Raw | ConvertFrom-Json } else { $null }
    $taskApi = Get-RegisteredProcess $taskPrevious 'api'
    $taskVite = Get-RegisteredProcess $taskPrevious 'vite'
    foreach ($taskPort in @(8080,3000)) {
        $taskExisting = Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue
        $taskOwned = if ($taskPort -eq 8080) { $taskApi } else { $taskVite }
        if ($taskExisting -and ($null -eq $taskOwned -or (@($taskExisting.OwningProcess | Select-Object -Unique) -notcontains $taskOwned.Id))) { throw "Port $taskPort is occupied by an unregistered process; nothing stopped" }
    }
    if ($null -eq $taskApi) {
        $taskApi = Start-Process -FilePath $taskNode -ArgumentList '--env-file=.env.audit','dist/index.js' -WorkingDirectory "$taskRoot/server" -WindowStyle Hidden -RedirectStandardOutput "$taskRuntime/logs/api.log" -RedirectStandardError "$taskRuntime/logs/api-error.log" -PassThru
    }
    if ($null -eq $taskVite) {
        $taskVite = Start-Process -FilePath $taskNode -ArgumentList 'node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3000','--strictPort' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput "$taskRuntime/logs/vite.log" -RedirectStandardError "$taskRuntime/logs/vite-error.log" -PassThru
    }
    @{root=$taskRoot;runtime=$taskRuntime;apiPid=$taskApi.Id;apiStartedAt=$taskApi.StartTime.ToUniversalTime().ToString('o');vitePid=$taskVite.Id;viteStartedAt=$taskVite.StartTime.ToUniversalTime().ToString('o');url='http://localhost:3000';dbPort=55432} | ConvertTo-Json | Set-Content -LiteralPath $taskProcessFile -Encoding UTF8
    Write-Output "Taskira http://localhost:3000; login $taskRuntime/LOGIN.txt"
} finally { Pop-Location }
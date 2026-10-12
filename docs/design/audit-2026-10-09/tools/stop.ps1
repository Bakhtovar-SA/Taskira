$ErrorActionPreference = 'Stop'
$taskRoot = 'D:/CodexScratch/Taskira-UI-Audit-20261009'
$taskRuntime = "$taskRoot-runtime"
$taskProcessFile = "$taskRuntime/processes.json"
if ((Resolve-Path -LiteralPath $taskRoot).Path -notlike 'D:\*') { throw 'Audit checkout must be on D' }
if (Test-Path -LiteralPath $taskProcessFile) {
    $taskRecord = Get-Content -LiteralPath $taskProcessFile -Raw | ConvertFrom-Json
    if ($taskRecord.root -ne $taskRoot -or $taskRecord.runtime -ne $taskRuntime) { throw 'Unexpected process registry' }
    foreach ($taskKind in @('api','vite')) {
        $taskId = $taskRecord."${taskKind}Pid"
        $taskStart = $taskRecord."${taskKind}StartedAt"
        if (-not $taskId) { continue }
        $taskProcess = Get-Process -Id $taskId -ErrorAction SilentlyContinue
        if ($null -eq $taskProcess) { continue }
        if (-not $taskStart -or $taskProcess.StartTime.ToUniversalTime().Ticks -ne ([datetime]$taskStart).ToUniversalTime().Ticks) { throw "PID $taskId ownership cannot be verified; nothing stopped for $taskKind" }
        Stop-Process -Id $taskId
    }
}
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' '-D' "$taskRuntime/postgres" 'status' 2>$null
if ($LASTEXITCODE -eq 0) {
    & 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' '-D' "$taskRuntime/postgres" '-m' 'fast' '-w' 'stop'
    if ($LASTEXITCODE -ne 0) { throw 'Audit PostgreSQL did not stop' }
}
Write-Output 'Audit stand stopped. Database and local files preserved on D.'
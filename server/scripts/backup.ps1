<#
  Taskira — снимок PostgreSQL с проверкой целостности и ротацией (Windows).
  Настройка Task Scheduler и восстановление — см. server\BACKUP.md.

  Конфиг: server\scripts\backup.env (см. backup.env.example) либо переменные
  окружения. Обязателен DATABASE_URL.
#>
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Log($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }

# --- конфиг ---
$envFile = Join-Path $scriptDir "backup.env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($k)) { Set-Item -Path "env:$k" -Value $v }
  }
}

$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) { Log "ОШИБКА: DATABASE_URL не задан (backup.env или окружение)"; exit 1 }

$backupDir = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { Join-Path $scriptDir "..\..\backups" }
$retentionDays = if ($env:RETENTION_DAYS) { [int]$env:RETENTION_DAYS } else { 14 }
$weeklyRetentionDays = if ($env:WEEKLY_RETENTION_DAYS) { [int]$env:WEEKLY_RETENTION_DAYS } else { 56 }
$pgDump = if ($env:PGDUMP) { $env:PGDUMP } else { "pg_dump" }
$pgRestore = if ($env:PGRESTORE) { $env:PGRESTORE } else { "pg_restore" }

foreach ($tool in @($pgDump, $pgRestore)) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Log "ОШИБКА: $tool не найден (задайте PGDUMP/PGRESTORE в backup.env)"; exit 1
  }
}

$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
New-Item -ItemType Directory -Force -Path $backupDir, (Join-Path $backupDir "weekly") | Out-Null
$file = Join-Path $backupDir "taskira_$ts.dump"

Log "pg_dump -> $file"
& $pgDump --dbname=$dbUrl --format=custom --no-owner --no-privileges --file=$file
if ($LASTEXITCODE -ne 0) { Remove-Item $file -ErrorAction SilentlyContinue; Log "ОШИБКА: pg_dump завершился с ошибкой"; exit 1 }

Log "проверка целостности: pg_restore --list"
& $pgRestore --list $file > $null
if ($LASTEXITCODE -ne 0) { Log "ОШИБКА: снимок повреждён"; exit 1 }

$sizeMb = [math]::Round((Get-Item $file).Length / 1MB, 2)
Log "снимок ок: $file ($sizeMb MB)"

if ((Get-Date).DayOfWeek -eq "Monday") {
  Copy-Item $file (Join-Path $backupDir "weekly\taskira_$ts.dump")
  Log "еженедельная копия: weekly\taskira_$ts.dump"
}

# Ротация
$cutDaily = (Get-Date).AddDays(-$retentionDays)
$cutWeekly = (Get-Date).AddDays(-$weeklyRetentionDays)
$nd = @(Get-ChildItem (Join-Path $backupDir "taskira_*.dump") -ErrorAction SilentlyContinue | Where-Object LastWriteTime -lt $cutDaily)
$nw = @(Get-ChildItem (Join-Path $backupDir "weekly\taskira_*.dump") -ErrorAction SilentlyContinue | Where-Object LastWriteTime -lt $cutWeekly)
$nd | Remove-Item -Force
$nw | Remove-Item -Force
Log ("ротация: удалено ежедневных {0}, еженедельных {1}" -f $nd.Count, $nw.Count)

Log "готово"

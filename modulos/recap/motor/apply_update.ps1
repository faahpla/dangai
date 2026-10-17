# AnCut HUB — Elevated update applier.
#
# Called by the app's updater after downloading + extracting the delta zip.
# Runs with admin rights (spawned via ShellExecuteW "runas") so it can copy
# files into Program Files. Steps:
#
#   1) Wait for the main app process to exit (up to 15s, then force-kill)
#   2) Copy the extracted files over the installation folder
#   3) Optionally re-launch the app
#
# Params:
#   -Source      Folder containing the extracted zip contents
#   -Install     Target install folder (usually C:\Program Files\CorteCenas)
#   -Exe         Executable name to relaunch (e.g. "CorteCenas.exe")
#   -NoRelaunch  Skip the relaunch step (for scripted use)

param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Install,
    [string]$Exe = "CorteCenas.exe",
    [switch]$NoRelaunch
)

$ErrorActionPreference = "Continue"

# 1) Wait for the main app to close
$maxWait = 15
$waited = 0
while ($waited -lt $maxWait) {
    $proc = Get-Process -Name ($Exe -replace '\.exe$','') -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    Start-Sleep -Seconds 1
    $waited++
}
Get-Process -Name ($Exe -replace '\.exe$','') -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 2) Copy files. Use robocopy for reliability (retries, handles locked files).
$logPath = Join-Path $env:LOCALAPPDATA "CorteCenas\logs\apply_update.log"
New-Item -ItemType Directory -Path (Split-Path $logPath) -Force -ErrorAction SilentlyContinue | Out-Null
robocopy $Source $Install /E /R:3 /W:1 /NP /NDL /LOG+:$logPath | Out-Null

# robocopy exit codes 0-7 are success (0 = no change, 1 = files copied, etc.)
# 8+ means failure. Report a message either way — the app is closed so all we
# can do is write a file the user will find if things go wrong.
if ($LASTEXITCODE -ge 8) {
    "APPLY FAILED with exit $LASTEXITCODE" | Out-File -FilePath $logPath -Append
    exit 1
}

# 3) Relaunch — via explorer.exe de propósito: este script roda ELEVADO, e um
# Start-Process direto herdaria a elevação. App elevado = Windows bloqueia
# drag-and-drop vindo do Explorer (UIPI). Lançar através do explorer.exe faz
# o app nascer com os privilégios normais do usuário.
if (-not $NoRelaunch) {
    $exePath = Join-Path $Install $Exe
    if (Test-Path $exePath) {
        Start-Process -FilePath "explorer.exe" -ArgumentList "`"$exePath`""
    }
}

exit 0

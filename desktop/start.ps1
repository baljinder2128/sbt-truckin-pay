# SB Truckin Pay - starts the app on this Windows computer. Run by "Start SB Pay.bat".
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'SB Truckin Pay - keep this window open'
$NodeVersion = 'v24.22.3'
$Port = 3000
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail($text) { Say ''; Say $text 'Red'; Say ''; Read-Host 'Press Enter to close'; exit 1 }

# Where the app's code is: "app" next to this script (the ready-made zip) or the folder above (the GitHub copy).
$App = @("$Here\app", "$Here\..") | Where-Object { Test-Path "$_\server\index.js" } | Select-Object -First 1
if (-not $App) { Fail 'Could not find the app files. Keep this script inside the "SB Truckin Pay" folder you unzipped.' }
$App = (Resolve-Path $App).Path

# Everything the app saves lives here, on this computer. No size limit apart from your disk.
$Home2 = Join-Path $env:USERPROFILE 'SB Truckin Pay'
$Data = Join-Path $Home2 'data'
$Backups = Join-Path $Home2 'backups'
New-Item -ItemType Directory -Force -Path $Data, $Backups | Out-Null

# Already running? Just open it.
try {
  Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 2 | Out-Null
  Say 'SB Truckin Pay is already running. Opening it...' 'Green'
  Start-Process "http://localhost:$Port"
  Start-Sleep 2; exit 0
} catch { }

# Node.js: use the one in the zip, else one already installed, else download a private copy (no admin needed).
function NodeOk($exe) {
  try { $v = (& $exe -v) -replace '^v', ''; return ([version]$v -ge [version]'22.13.0') } catch { return $false }
}
$Node = $null
foreach ($c in @("$Here\node\node.exe", "$App\..\node\node.exe", "$env:LOCALAPPDATA\SB Truckin Pay\node\node.exe")) {
  if ((Test-Path $c) -and (NodeOk $c)) { $Node = (Resolve-Path $c).Path; break }
}
if (-not $Node) {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys -and (NodeOk $sys.Source)) { $Node = $sys.Source }
}
if (-not $Node) {
  Say "First start: downloading Node.js $NodeVersion (about 35 MB, one time only)..." 'Yellow'
  $dest = Join-Path $env:LOCALAPPDATA 'SB Truckin Pay'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $zip = Join-Path $env:TEMP "node-$NodeVersion.zip"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $dest -Force
    if (Test-Path "$dest\node") { Remove-Item "$dest\node" -Recurse -Force }
    Rename-Item "$dest\node-$NodeVersion-win-x64" 'node'
    Remove-Item $zip -Force
  } catch { Fail "Could not download Node.js. Check the internet is working and try again.`n$($_.Exception.Message)" }
  $Node = "$dest\node\node.exe"
}
$NodeDir = Split-Path -Parent $Node
$env:Path = "$NodeDir;$env:Path"

# App libraries (already inside the ready-made zip).
if (-not (Test-Path "$App\node_modules\express")) {
  Say 'First start: installing the app (one time only, needs internet)...' 'Yellow'
  Push-Location $App
  try { & "$NodeDir\npm.cmd" ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE) { throw "npm exited with $LASTEXITCODE" } }
  catch { Pop-Location; Fail "Could not install the app. Check the internet is working and try again.`n$($_.Exception.Message)" }
  Pop-Location
}

# Desktop shortcuts, made once.
try {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sh = New-Object -ComObject WScript.Shell
  $bat = Get-ChildItem $Here -Filter 'Start SB Pay.bat' | Select-Object -First 1
  if ($bat -and -not (Test-Path "$desk\SB Truckin Pay.lnk")) {
    $l = $sh.CreateShortcut("$desk\SB Truckin Pay.lnk")
    $l.TargetPath = $bat.FullName; $l.WorkingDirectory = $Here
    $icon = "$App\public\icons\favicon.ico"; if (Test-Path $icon) { $l.IconLocation = $icon }
    $l.Save()
  }
  if (-not (Test-Path "$desk\SB Truckin Pay data and backups.lnk")) {
    $l = $sh.CreateShortcut("$desk\SB Truckin Pay data and backups.lnk")
    $l.TargetPath = $Home2; $l.Save()
  }
} catch { }

$env:SBT_DESKTOP = '1'
$env:PORT = "$Port"
$env:TZ = 'Australia/Melbourne'
$env:DATA_DIR = $Data
$env:BACKUP_DIR = $Backups
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

$ips = @()
try { $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object IPAddress } catch { }

Clear-Host
Say '==============================================================' 'DarkRed'
Say '   SB TRUCKIN PAY is running on this computer' 'White'
Say '==============================================================' 'DarkRed'
Say ''
Say "   Open it here:      http://localhost:$Port" 'Green'
foreach ($ip in $ips) { Say "   Phone on same Wi-Fi: http://${ip}:$Port" 'Cyan' }
Say ''
Say "   Your data:         $Data"
Say "   Daily backups:     $Backups"
Say ''
Say '   KEEP THIS WINDOW OPEN (you can minimise it).' 'Yellow'
Say '   Closing it stops the app. Double-click "SB Truckin Pay" on the desktop to start again.' 'Yellow'
Say ''

# Open the browser once the app answers.
Start-Job -ScriptBlock {
  param($p)
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-RestMethod "http://localhost:$p/api/health" -TimeoutSec 1 | Out-Null; Start-Process "http://localhost:$p"; return } catch { Start-Sleep 1 }
  }
} -ArgumentList $Port | Out-Null

Set-Location $App
& $Node --disable-warning=ExperimentalWarning server/index.js
Say ''
Say 'The app has stopped.' 'Red'
Read-Host 'Press Enter to close'

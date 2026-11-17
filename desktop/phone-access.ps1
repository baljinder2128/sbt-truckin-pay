# Gives a temporary https link so phones can open the app from anywhere (free, no account: Cloudflare quick tunnel).
# The link changes every time this window is started. The app itself must be running ("Start SB Pay").
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'SB Truckin Pay - phone access (keep open)'
$Port = 3000
$dir = Join-Path $env:LOCALAPPDATA 'SB Truckin Pay'
$exe = Join-Path $dir 'cloudflared.exe'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
try { Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 2 | Out-Null }
catch { Write-Host 'Start the app first (double-click "SB Truckin Pay" on the desktop), then run this again.' -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
if (-not (Test-Path $exe)) {
  Write-Host 'Downloading Cloudflare tunnel (one time only)...' -ForegroundColor Yellow
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe -UseBasicParsing
}
$log = Join-Path $dir 'tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
# Runs inside this window, so closing the window also switches the tunnel off.
$p = Start-Process $exe -ArgumentList "tunnel --no-autoupdate --url http://localhost:$Port" -NoNewWindow -PassThru -RedirectStandardError $log
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep 1
  if (Test-Path $log) { $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
}
Clear-Host
if (-not $url) { Write-Host 'Could not get a link. Check the internet and try again.' -ForegroundColor Red; Stop-Process $p -ErrorAction SilentlyContinue; Read-Host 'Press Enter to close'; exit 1 }
try { Set-Clipboard $url } catch { }
Write-Host ''
Write-Host '  Phones can now open the app here (link copied, paste it into WhatsApp):' -ForegroundColor White
Write-Host ''
Write-Host "     $url" -ForegroundColor Green
Write-Host ''
Write-Host '  This link works only while this window AND the app window are open.' -ForegroundColor Yellow
Write-Host '  It changes every time you start phone access.' -ForegroundColor Yellow
Write-Host ''
Write-Host '  Close this window to switch phone access off.'
Wait-Process -Id $p.Id

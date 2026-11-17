# Makes SB Truckin Pay start (minimised) every time you sign in to Windows.
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut("$startup\SB Truckin Pay.lnk")
$l.TargetPath = Join-Path $Here 'Start SB Pay.bat'
$l.WorkingDirectory = $Here
$l.WindowStyle = 7
$l.Save()
Write-Host ''
Write-Host 'Done. SB Truckin Pay will now start by itself when you turn on the computer and sign in.' -ForegroundColor Green
Write-Host "To stop that, delete the shortcut in: $startup"
Write-Host ''
Read-Host 'Press Enter to close'

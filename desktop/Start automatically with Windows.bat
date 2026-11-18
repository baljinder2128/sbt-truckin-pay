@echo off
rem Makes SB Truckin Pay start (minimised) every time you sign in to Windows.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo @echo off
  echo start "SB Truckin Pay" /min "%~dp0Start SB Pay.bat"
) > "%STARTUP%\SB Truckin Pay.bat"
echo.
echo Done. SB Truckin Pay will now start by itself when you turn on the computer and sign in.
echo To stop that, delete "SB Truckin Pay.bat" in:
echo %STARTUP%
echo.
pause

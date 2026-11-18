@echo off
rem Free temporary https link so phones can open the app from anywhere (Cloudflare quick tunnel, no account).
rem The app must be running. The link changes each time. Close this window to switch it off.
title SB Truckin Pay - phone access (keep open)
set "DIR=%LOCALAPPDATA%\SB Truckin Pay"
set "EXE=%DIR%\cloudflared.exe"
if not exist "%DIR%" mkdir "%DIR%"
if not exist "%EXE%" (
  echo Downloading Cloudflare tunnel, one time only...
  curl -L -s -o "%EXE%" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)
echo.
echo Look below for a line with  https://....trycloudflare.com  - that is the link for phones.
echo It works while this window and the app window stay open.
echo.
"%EXE%" tunnel --no-autoupdate --url http://localhost:3000
pause

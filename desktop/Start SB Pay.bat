@echo off
rem Starts SB Truckin Pay and opens it in your browser. Keep this window open (you can minimise it).
title SB Truckin Pay - keep this window open
set "HERE=%~dp0"
set "APP=%HERE%app"
if not exist "%APP%\server\index.js" set "APP=%HERE%.."
set "NODE=%HERE%node\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%APP%"
"%NODE%" --disable-warning=ExperimentalWarning server\index.js --desktop
echo.
echo The app has stopped. If you did not close it, take a photo of this window and send it to Claude.
pause

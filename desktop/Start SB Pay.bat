@echo off
rem Starts SB Truckin Pay in the background (no window to keep open) and opens it in your browser.
rem The first start also makes it start by itself at every sign-in and puts an "SB Truckin Pay" icon on the desktop.
set "HERE=%~dp0"
set "APP=%HERE%app"
if not exist "%APP%\server\index.js" set "APP=%HERE%.."
set "NODE=%HERE%node\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%APP%"
"%NODE%" --disable-warning=ExperimentalWarning server\index.js --desktop --background
if errorlevel 1 pause

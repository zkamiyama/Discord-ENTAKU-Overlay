@echo off
setlocal
cd /d "%~dp0"
echo ENTAKU Overlay - Discord compatibility connection
echo.
echo This uses the Discord StreamKit application identity for authentication.
echo It is NOT an independently approved Discord application.
echo Only RPC and voice-state read scopes are requested. No audio is recorded.
echo Discord may display a StreamKit consent dialog.
echo Keep the local Dock and Overlay URLs private.
echo Close any running ENTAKU demo before continuing.
echo.
choice /C YN /N /M "Start compatibility authentication? [Y/N] "
if errorlevel 2 exit /b 0
"%~dp0ENTAKU-Overlay.exe" --live --compat-auth --accept-streamkit-compat
pause

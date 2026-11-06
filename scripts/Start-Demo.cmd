@echo off
setlocal
cd /d "%~dp0"
"%~dp0ENTAKU-Overlay.exe" --demo
if errorlevel 1 pause

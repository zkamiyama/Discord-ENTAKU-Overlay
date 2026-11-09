@echo off
setlocal
cd /d "%~dp0"
echo ENTAKU VC Chat Probe - terminal only, no saved chat.
echo Start Discord and join a test server voice channel first.
echo This uses existing StreamKit compatibility auth: rpc and rpc.voice.read only.
echo New posts and author names will appear in this terminal. Do not save this output.
choice /C YN /M "Accept StreamKit compatibility authentication"
if errorlevel 2 exit /b 2
set "ENTAKU_PROBE_VC_CHAT=1"
set /p "ENTAKU_PROBE_DISCORD_VERSION=Discord version from Settings (optional): "
"%~dp0ENTAKU-VC-Chat-Probe.exe" --accept-streamkit-compat --seconds 120
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%

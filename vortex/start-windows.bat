@echo off
REM Serves Vortex on http://localhost:8000 (Web Bluetooth needs localhost or https) and opens it in Edge.
cd /d "%~dp0"
where python >nul 2>nul && (start "" msedge "http://localhost:8000" & python -m http.server 8000 & goto :eof)
where npx >nul 2>nul && (start "" msedge "http://localhost:8000" & npx --yes http-server -p 8000 -c-1 & goto :eof)
echo Install Python from python.org (tick "Add to PATH"), then run this again.
pause

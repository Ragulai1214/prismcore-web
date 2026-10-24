@echo off
cd /d "%~dp0"
echo.
echo  PRISM CORE - Local web server
echo  Open http://127.0.0.1:8080 in your browser.
echo  Press Ctrl+C to stop the server.
echo.
python -m http.server 8080 --bind 127.0.0.1
pause

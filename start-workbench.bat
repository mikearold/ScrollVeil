@echo off
echo Starting ScrollVeil Workbench server...
echo.
echo Open this URL in Chrome: http://localhost:8080/workbench.html
echo.
echo Press Ctrl+C to stop the server when done.
echo.
cd /d "%~dp0"
start "" "http://localhost:8080/workbench.html"
python -m http.server 8080

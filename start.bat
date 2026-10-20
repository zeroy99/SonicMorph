@echo off
echo =======================================================
echo   Starting SONICMORPH Audio Converter (Rust + WASM)
echo =======================================================
echo.
echo Launching local server at http://127.0.0.1:3000 ...
start http://127.0.0.1:3000
node server.js
pause

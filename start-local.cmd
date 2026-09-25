@echo off
chcp 65001 >nul
title EcoHub — локальный сервер
cd /d "%~dp0server"

echo.
echo   Запуск EcoHub на вашем компьютере...
echo   Дождитесь строки:  EcoHub API running on http://localhost:3001
echo   Затем откройте в браузере:  http://localhost:3001
echo   Остановить: закройте это окно.
echo.

call npm.cmd start

echo.
echo   Сервер остановлен.
pause
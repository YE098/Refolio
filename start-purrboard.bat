@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Starting PurrBoard...
call npm run dev
if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo Failed to start PurrBoard.
pause
exit /b 1

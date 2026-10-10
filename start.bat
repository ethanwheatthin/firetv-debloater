@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

if not exist vendor\platform-tools\adb.exe (
  echo Downloading Google's Android platform-tools ^(adb^)...
  call npx tsx scripts\fetch-platform-tools.ts windows
  if errorlevel 1 ( echo Download failed. Check your internet connection. & pause & exit /b 1 )
)

call npx tsx src\index.ts
pause

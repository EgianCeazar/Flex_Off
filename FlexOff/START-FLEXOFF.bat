@echo off
title FlexOff
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, then double-click this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing everything. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo Starting FlexOff. Your browser will open at http://localhost:5173
call npm start
pause

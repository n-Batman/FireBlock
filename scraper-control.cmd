@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Create the project Python environment first. See docs\scraper-control.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m fireblock_analysis.scraper_ui

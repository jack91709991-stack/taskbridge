@echo off
chcp 65001 > nul
title TaskBridge Launcher
cd /d "%~dp0"
echo ===================================================
echo  TaskBridge (スケジュール・作業指示・進捗報告) を起動中...
echo ===================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_app.ps1"
pause

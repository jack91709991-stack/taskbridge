@echo off
chcp 65001 > nul
title TaskBridge - Push to GitHub
cd /d "%~dp0"

echo ===================================================
echo  TaskBridge: GitHubへのプッシュを実行します
echo  送信先: https://github.com/jack91709991-stack/taskbridge.git
echo ===================================================
echo.

git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo  [成功] GitHubへのプッシュが完了しました！
    echo ===================================================
) else (
    echo.
    echo ===================================================
    echo  [失敗] GitHub上にリポジトリが見つからないか、認証が必要です。
    echo  https://github.com/new で 'taskbridge' を作成してください。
    echo ===================================================
)

echo.
pause

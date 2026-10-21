<#
.SYNOPSIS
    TaskBridge ローカルサーバー起動スクリプト (PowerShell HttpListener)
.DESCRIPTION
    Node.js等のインストール不要で、Windows標準のPowerShellのみで動作するWebサーバーです。
    ブラウザを自動起動し、TaskBridgeを利用できます。
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

$port = 3400
$taskBridgeDir = "c:\Users\BS227\Documents\antigravity\TaskBridge"
$prefix = "http://localhost:$port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "[ERROR] ポート $port でサーバーを開始できませんでした: $_" -ForegroundColor Red
    Write-Host "代わりに index.html を直接ブラウザで開きます..." -ForegroundColor Yellow
    Start-Process (Join-Path $taskBridgeDir "index.html")
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " TaskBridge Local Server Started!" -ForegroundColor Green
Write-Host " URL: $prefix" -ForegroundColor Yellow
Write-Host " 終了するにはこの画面で Ctrl + C を押してください" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan

# ブラウザで自動オープン
Start-Process $prefix

# 静的ファイル配信ループ
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # URLパスの解決
        $urlPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($urlPath)) {
            $urlPath = "index.html"
        }

        $localFilePath = Join-Path $taskBridgeDir ($urlPath -replace '/', '\')

        if (Test-Path $localFilePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localFilePath).ToLower()
            $contentType = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".htm"  { "text/html; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".svg"  { "image/svg+xml" }
                ".ico"  { "image/x-icon" }
                Default { "application/octet-stream" }
            }

            $bytes = [System.IO.File]::ReadAllBytes($localFilePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        } else {
            $response.StatusCode = 404
            $errBytes = $utf8NoBom.GetBytes("404 Not Found: $urlPath")
            $response.ContentType = "text/plain; charset=utf-8"
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    } catch {
        # エラー時はスキップしてリスナー維持
    }
}

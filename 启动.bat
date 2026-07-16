@echo off
cd /d "%~dp0"

:: 启动 Supermium，数据目录和扩展都在U盘上
start "" "supermium\chrome.exe" ^
  --user-data-dir=".\Data" ^
  --load-extension=".\extension" ^
  --no-first-run ^
  --disable-background-networking ^
  --disable-sync

echo 浏览器已启动，扩展和数据均存储在U盘

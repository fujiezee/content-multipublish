@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 点物助手
echo 不要关这个窗口。回到网站点同步即可。
echo.
where py >nul 2>&1 && py helper.py && goto :eof
where python >nul 2>&1 && python helper.py && goto :eof
where node >nul 2>&1 && node start.cjs && goto :eof
echo 请先安装 Python：https://www.python.org/downloads/
echo 装好后再双击这个文件。
pause

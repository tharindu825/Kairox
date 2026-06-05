@echo off
title Kairox Trading Platform
color 0A

echo.
echo  ========================================================
echo            KAIROX TRADING PLATFORM
echo         App + Worker (LAN Visible Mode)
echo  ========================================================
echo.

cd /d "%~dp0"

:: Check if Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

:: Get the PC's Local Network IP Address dynamically (prioritizing physical LAN subnets)
set "LOCAL_IP=localhost"
for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '192.168.1.*' | Select-Object -First 1 -ExpandProperty IPAddress"`) do set LOCAL_IP=%%a
if "%LOCAL_IP%"=="localhost" (
    for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '192.168.0.*' | Select-Object -First 1 -ExpandProperty IPAddress"`) do set LOCAL_IP=%%a
)
if "%LOCAL_IP%"=="localhost" (
    for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -like '10.0.0.*' | Select-Object -First 1 -ExpandProperty IPAddress"`) do set LOCAL_IP=%%a
)
if "%LOCAL_IP%"=="localhost" (
    for /f "usebackq tokens=*" %%a in (`powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -notlike '127.*' | Where-Object IPAddress -notlike '169.254.*' | Where-Object IPAddress -notlike '192.168.56.*' | Where-Object IPAddress -notlike '26.*' | Select-Object -First 1 -ExpandProperty IPAddress"`) do set LOCAL_IP=%%a
)

:: Mode Selection Menu
echo  Please select execution mode:
echo  [1] Production Mode (Recommended - loads fast, optimized)
echo  [2] Development Mode (For local development - supports hot-reloading)
echo.
set /p CHOICE="Enter choice (1 or 2, default is 1): "

if "%CHOICE%"=="" set CHOICE=1
if "%CHOICE%"=="2" goto DEV_MODE

:PROD_MODE
echo.
set /p REBUILD="Do you want to rebuild the app first? (Y/N, default is Y): "
if "%REBUILD%"=="" set REBUILD=Y
if /i "%REBUILD%"=="N" goto START_PROD

echo.
echo  Building application for Production...
call npm run build
if %errorlevel% neq 0 (
    echo  [ERROR] Build failed. Cannot start in Production Mode.
    pause
    exit /b 1
)

:START_PROD
echo.
echo  Starting everything in Production Mode...
echo  Local Access:   http://localhost:3000
echo  Network Access: http://%LOCAL_IP%:3000
echo  (Other PCs on the same Wi-Fi/network can use the Network Access URL)
echo  Press Ctrl+C to stop everything.
echo.
npx concurrently -n prod,worker -c blue,green "npm run start" "npm run worker"
goto END

:DEV_MODE
echo.
echo  Starting everything in Development Mode...
echo  Local Access:   http://localhost:3000
echo  Network Access: http://%LOCAL_IP%:3000
echo  (Other PCs on the same Wi-Fi/network can use the Network Access URL)
echo  Press Ctrl+C to stop everything.
echo.
npx concurrently -n dev,worker -c blue,green "npm run dev" "npm run worker"

:END
pause

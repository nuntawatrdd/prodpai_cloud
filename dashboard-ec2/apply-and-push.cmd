@echo off
rem Double-click: terraform apply in WSL, then send the output to the dashboard.
rem Reads AWS credentials from %USERPROFILE%\.aws\credentials.txt (AWS Academy "AWS CLI" text).
wsl.exe -d Ubuntu -u root --cd "%~dp0." -- env AWS_CREDS_TXT=/mnt/c/Users/%USERNAME%/.aws/credentials.txt bash ./apply-and-push.sh
echo.
pause

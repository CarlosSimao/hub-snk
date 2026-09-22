@echo off
rem Duplo clique aqui remove o HUB SNK. O cadastro nao e apagado.
rem
rem Mesmo motivo do instalar-hub-snk.bat: o duplo clique num .ps1 nao executa
rem nada, e a politica de execucao padrao barra script sem assinatura.

setlocal
set "SCRIPT=%~dp0desinstalar-hub-snk.ps1"

where pwsh.exe >nul 2>&1
if %errorlevel%==0 (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)

echo.
pause

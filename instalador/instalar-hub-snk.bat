@echo off
rem Duplo clique aqui instala o HUB SNK.
rem
rem O .bat existe porque o Windows recusa rodar .ps1 baixado da internet: a
rem política de execução padrao barra o arquivo, e o duplo clique num .ps1 abre
rem o Bloco de Notas em vez de executar. O -ExecutionPolicy Bypass vale so para
rem esta chamada, e nao altera a configuracao da maquina.

setlocal
set "SCRIPT=%~dp0instalar-hub-snk.ps1"

where pwsh.exe >nul 2>&1
if %errorlevel%==0 (
    pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)

echo.
pause

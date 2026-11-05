@echo off
rem Duplo clique: inicia o app. Fechar esta janela encerra a mesa e tira tudo da internet.
title Cronicas de Zehenia
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instalando o app, so desta vez...
  call npm install || goto erro
)
if not exist "server\node_modules\fastify\" (
  pushd server
  call npm ci || (popd & goto erro)
  popd
)

call npm run mesa -- %*
if errorlevel 1 goto erro
exit /b 0

:erro
echo.
echo Algo deu errado. Leia a mensagem acima.
pause
exit /b 1

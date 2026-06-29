@echo off
title Bond - Rodar Captura
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\jfn\bond\rodar-captura-manual.ps1"
if errorlevel 1 pause

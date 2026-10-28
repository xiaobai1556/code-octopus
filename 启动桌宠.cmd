@echo off
rem Start Code Octopus (the desktop pet) without leaving a console window open
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."

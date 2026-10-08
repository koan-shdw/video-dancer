@echo off
rem Launch the current source with hot reload and the installed app's data on I:.
title vi-dance dev
cd /d "%~dp0.."
set "VIDEO_DANCER_DATA_DIR=I:\APPS\Video Dancer\Data"
set "VIDEO_DANCER_DEV_INSTALL=1"
node node_modules\electron-vite\bin\electron-vite.js dev

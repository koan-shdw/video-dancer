@echo off
rem vi-dance dev — launches the dev build (live source, hot reload) via Photoshop's node.exe
rem (this machine has no system Node). The Start menu "vi-dance dev" shortcut points here.
title vi-dance dev
cd /d "%~dp0.."
"C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe" node_modules\electron-vite\bin\electron-vite.js dev

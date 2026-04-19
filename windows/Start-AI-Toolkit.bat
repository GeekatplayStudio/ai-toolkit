@echo off&&cd /d %~dp0
:: Mirrored copy for the outer AI-Toolkit-Easy-Install wrapper root.
Title AI-Toolkit-Easy-Install v0.5.1 by ivo
setlocal

set "delay=2"

set PYTHONPATH=
set PYTHONHOME=
set PYTHON=
set PYTHONSTARTUP=
set PYTHONUSERBASE=
set PIP_CONFIG_FILE=
set PIP_REQUIRE_VIRTUALENV=
set VIRTUAL_ENV=
set CONDA_PREFIX=
set CONDA_DEFAULT_ENV=
set PYENV_ROOT=
set PYENV_VERSION=

set warning=[33m
set    gray=[90m
set     red=[91m
set   green=[92m
set  yellow=[93m
set    blue=[94m
set magenta=[95m
set    cyan=[96m
set   white=[97m
set   reset=[0m

set "path=%~dp0\python_embeded;%~dp0\python_embeded\Scripts;%path%"
if not exist .\AI-Toolkit\ (
	echo %warning%WARNING:%reset% '%bold%AI-Toolkit%reset%' folder NOT exists!
	echo %green%Please reinstall 'AI-Toolkit-Easy-Install'.%reset%
	echo Press any key to Exit...&Pause>nul
	goto :eof
)
if not exist .\python_embeded\ (
	echo %warning%WARNING:%reset% '%bold%python_embeded%reset%' folder NOT exists!
	echo %green%Please reinstall 'AI-Toolkit-Easy-Install'.%reset%
	echo Press any key to Exit...&Pause>nul
	goto :eof
)

set GIT_LFS_SKIP_SMUDGE=1
set "local_serv=http://localhost:8675"
echo.
cd ./ai-toolkit
    echo %green%::::::::::::::: Starting AI-Toolkit ::::::::::::::%reset%
    echo.
git.exe fetch --quiet >nul 2>&1
git.exe status -uno | findstr /C:"Your branch is behind" >nul
if %errorlevel%==0 (
    echo  - %red%UPDATES%reset% available.%green% Run Update-AI-Toolkit.bat%reset%
    echo.
    set "delay=5"
)

if exist ".\aitk_db.db" (
    findstr /i /c:"HF_TOKEN" ".\aitk_db.db" >nul 2>&1
    if errorlevel 1 (echo  - %magenta%Hugging Face Token%reset% not found. Set in Settings.)
)
echo  - Stop the server with %green%Ctrl+C twice%reset%, not with %red%X%reset%
echo.
echo %green%::::::: Starting the server. Please wait... ::::::

timeout %delay%

echo %reset%

node .\ui\scripts\check-port.js
if errorlevel 1 (
	echo.
	echo %yellow%Start aborted. Resolve the running AI Toolkit process above, then launch again.%reset%
	echo Press any key to Exit...&Pause>nul
	goto :eof
)

if not exist ".\ui\node_modules\" (
	echo %green%::::::: Installing UI dependencies for the first run. Please wait... :::::::%reset%
	pushd .\ui
	call npm run prepare_ui
	if errorlevel 1 (
		popd
		echo %red%UI dependency installation failed.%reset%
		echo Press any key to Exit...&Pause>nul
		goto :eof
	)
	popd
	echo.
)

set "path=%windir%\System32\WindowsPowerShell\v1.0;%path%"

start /b powershell -NoProfile -ExecutionPolicy Bypass -Command "while(1){Start-Sleep 2;try{Invoke-WebRequest 'http://localhost:8675' -TimeoutSec 2 -UseBasicParsing -EA Stop|Out-Null;Start-Process 'http://localhost:8675';break}catch{}}"

cd ./ui
npm run build_and_start
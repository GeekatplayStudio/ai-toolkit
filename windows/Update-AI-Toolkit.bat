@echo off&&cd /d %~dp0
:: Mirrored copy for the outer AI-Toolkit-Easy-Install wrapper root.
Title AI-Toolkit Update by ivo


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
set     red=[91m
set   green=[92m
set  yellow=[93m
set    bold=[97m
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
cd ./ai-toolkit

echo.
echo %green%::::::::::::::: Installing %yellow%AI-Toolkit%green% updates... :::::::::::::::%reset%
echo.
git.exe reset --hard
git.exe clean -fd
git.exe pull
echo.
echo %green%::::::: Installing %yellow%requirements %green%and updating %yellow%diffusers%green% :::::::::%reset%
echo.
..\python_embeded\python.exe -I -m pip uninstall diffusers -y
..\python_embeded\python.exe -I -m pip install -r requirements.txt --no-cache --no-warn-script-location

echo.
echo %green%::::::: Updating %yellow%UI dependencies %green%and Prisma client :::::::::%reset%
echo.
node .\ui\scripts\check-port.js
if errorlevel 1 (
	echo %red%Stop AI Toolkit before running the updater.%reset%
	if "%~1"=="" (
		echo %yellow%::::::::::::::: Press any key to exit :::::::::::::::%reset%&Pause>nul
	)
	exit /b 1
)

pushd .\ui
call npm run prepare_ui
if errorlevel 1 (
	popd
	echo %red%UI update failed.%reset%
	if "%~1"=="" (
		echo %yellow%::::::::::::::: Press any key to exit :::::::::::::::%reset%&Pause>nul
	)
	exit /b 1
)
popd

echo.
echo %green%:::::::::::::::   Update completed    :::::::::::::::%reset%
if "%~1"=="" (
    echo %yellow%::::::::::::::: Press any key to exit :::::::::::::::%reset%&Pause>nul
    exit
)

exit
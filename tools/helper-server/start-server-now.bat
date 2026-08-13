@echo off
chcp 65001 >nul
REM 하이라인닷넷 통합 도우미 서버를 켜고, 업무 도구 화면을 브라우저로 연다.
REM
REM 서버가 이미 실행 중이면 새로 띄우지 않고 브라우저만 연다(여러 번 눌러도 안전).
REM PC를 재시작하면 install-startup.js로 등록해둔 숨김 버전이 자동으로 실행되므로,
REM 그때는 화면만 열면 되고 이 파일을 실행해도 브라우저만 열린다.
cd /d "%~dp0"
node server.js --open

REM 오류로 끝난 경우 창이 바로 닫히면 메시지를 못 읽으므로 멈춰준다
if errorlevel 1 pause

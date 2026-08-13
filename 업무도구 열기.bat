@echo off
REM 하이라인닷넷 업무 자동화 도구를 http://localhost 로 띄우고 브라우저를 연다.
REM
REM index.html을 파일로 직접 열면(file://) 브라우저 제약이 많아서
REM (PDF 인쇄 불가, 필요서류 저장 공간 좁음 등) 이 방법으로 여는 것을 권장한다.
REM 서버가 이미 켜져 있으면 브라우저만 새로 열린다.

cd /d "%~dp0tools\helper-server"

REM 서버가 이미 떠 있는지 확인 (8787 포트가 LISTENING 이면 실행 중)
netstat -ano | findstr /R /C:"TCP.*:8787 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo 도우미 서버가 이미 실행 중입니다.
) else (
  echo 도우미 서버를 시작합니다...
  start "하이라인닷넷 도우미 서버" cmd /c node server.js
  REM 서버가 뜰 때까지 잠깐 기다린다
  timeout /t 2 /nobreak >nul
)

echo 브라우저를 엽니다: http://localhost:8787/
start "" "http://localhost:8787/"

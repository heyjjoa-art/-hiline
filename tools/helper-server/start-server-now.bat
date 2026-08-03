@echo off
REM 하이라인닷넷 통합 도우미 서버를 지금 바로 띄운다 (콘솔 창이 보이는 상태로 실행됨).
REM PC를 재시작하면 install-startup.js로 등록해둔 숨김 버전이 자동으로 실행되므로
REM 평소에는 이 파일을 실행할 필요가 없다 — 방금 PC를 켰거나 서버가 꺼져있을 때만 쓴다.
cd /d %~dp0
node server.js

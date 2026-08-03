@echo off
REM 하이웍스 일정(연차휴가) 연동 전용 Chrome을 원격 디버깅 포트(9224)와 함께 띄운다.
REM chrome-profile-hiworks 폴더는 이 용도로만 쓰는 새 프로필이라 평소 쓰는 Chrome의
REM 로그인/쿠키/저장된 비밀번호와는 완전히 분리되어 있다 (처음 실행 시에만 로그인이
REM 필요하고, 그 다음부터는 이 프로필에 로그인 상태가 유지된다).
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9224 --user-data-dir="%~dp0chrome-profile-hiworks" https://scheduler.office.hiworks.com/calendar/checked

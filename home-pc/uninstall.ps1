# 집 PC 수집기 제거 (작업 스케줄러 등록만 지움)
Unregister-ScheduledTask -TaskName "JobBoardCollector" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "집 PC 자동 수집을 껐습니다." -ForegroundColor Green
Read-Host "Enter를 누르면 닫힙니다"

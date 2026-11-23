# 집 PC 수집기 설치: 1시간마다 (설정한 수집 간격이 됐을 때만) 수집하도록 작업 스케줄러에 등록
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Write-Host "관심 채용공고 - 집 PC 수집기 설치" -ForegroundColor Green

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요." -ForegroundColor Red
  Read-Host "Enter를 누르면 닫힙니다"; exit 1
}
$envFile = Join-Path $here "home.env"
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $here "home.env.example") $envFile
  Write-Host "home.env 파일을 만들었습니다. 메모장이 열리면 값을 채우고 저장한 뒤 이 창으로 돌아오세요." -ForegroundColor Yellow
  Start-Process notepad.exe $envFile -Wait
}

Push-Location $root
Write-Host "필요한 부품 설치 중..."
npm ci --no-audit --no-fund | Out-Host
Pop-Location

$vbs = Join-Path $here "run-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 55)
Register-ScheduledTask -TaskName "JobBoardCollector" -Action $action -Trigger $trigger -Settings $settings -Description "관심 채용공고 수집 (집 PC)" -Force | Out-Null

Write-Host "등록했습니다. 지금 한 번 시험 수집을 합니다 (몇 분 걸립니다)..." -ForegroundColor Green
Push-Location $root
node --env-file=home-pc\home.env collector\run.js --force
Pop-Location
Write-Host "끝났습니다. 이제 1시간마다 확인해서, 수집 간격이 됐을 때 자동으로 수집합니다." -ForegroundColor Green
Read-Host "Enter를 누르면 닫힙니다"

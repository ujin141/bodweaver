$ErrorActionPreference = "Continue"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " BODWEAVER -> GitHub Push" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

Set-Location "C:\Users\ujin1\Desktop\보드게임"

# Git 초기화 (없을 때만)
if (!(Test-Path ".git")) {
    Write-Host "[1] Git 초기화..." -ForegroundColor Yellow
    git init
    git branch -M main
} else {
    Write-Host "[1] Git 이미 초기화됨" -ForegroundColor Green
}

# .gitignore 확인
if (!(Test-Path ".gitignore")) {
    ".env`nnode_modules/`nbackend/node_modules/" | Out-File -Encoding UTF8 ".gitignore"
    Write-Host "[2] .gitignore 생성" -ForegroundColor Green
}

# 원격 저장소 설정
Write-Host "[3] 원격 저장소 연결..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin https://github.com/ujin141/bodweaver.git

# 전체 파일 스테이징
Write-Host "[4] 파일 추가 중..." -ForegroundColor Yellow
git add .

# 변경사항 확인
$status = git status --porcelain
if ($status) {
    Write-Host "[5] 커밋 생성..." -ForegroundColor Yellow
    git commit -m "feat: Supabase 백엔드 연동, 소셜 로그인, 실시간 채팅, 전체 DB 스키마"
} else {
    Write-Host "[5] 변경사항 없음, 이미 최신 상태" -ForegroundColor Gray
}

# Push
Write-Host "[6] GitHub 업로드 중..." -ForegroundColor Yellow
Write-Host "    (로그인 창이 뜨면 GitHub 계정으로 로그인해 주세요)" -ForegroundColor Magenta
git push -u origin main --force

Write-Host "" 
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Push 완료! GitHub에 저장되었습니다." -ForegroundColor Green
Write-Host " https://github.com/ujin141/bodweaver" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

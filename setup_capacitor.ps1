$ErrorActionPreference = "Stop"

Write-Host "============================================="
Write-Host "BODWEAVER Capacitor App Build Setup Script"
Write-Host "============================================="

Write-Host "`n1. Setting up project structure (www folder)" -ForegroundColor Cyan
if (!(Test-Path "www")) {
    New-Item -ItemType Directory -Path "www" -Force | Out-Null
}
$filesToMove = Get-ChildItem -Path . -File | Where-Object { $_.Name -match "^(app\.js|index\.html|style\.css|.*\.png)$" }
foreach ($file in $filesToMove) {
    Copy-Item -Path $file.FullName -Destination "www" -Force
}
Write-Host "-> Moved web assets to www folder" -ForegroundColor Green

Write-Host "`n2. Initializing NPM and Installing Capacitor v6" -ForegroundColor Cyan
if (!(Test-Path "package.json")) {
    npm init -y | Out-Null
}
npm install @capacitor/core@6 @capacitor/cli@6

Write-Host "`n3. Capacitor initialization" -ForegroundColor Cyan
npx cap init "BODWEAVER" "com.bodweaver.app" --web-dir www

Write-Host "`n4. Installing Mobile platforms" -ForegroundColor Cyan
npm install @capacitor/android@6 @capacitor/ios@6

Write-Host "`n5. Adding Android & iOS packages" -ForegroundColor Cyan
npx cap add android
npx cap add ios

Write-Host "`n============================================="
Write-Host "Setup Complete! Mobile app project successfully created." -ForegroundColor Green
Write-Host "You can now open the android/ios folder in Android Studio/Xcode."
Write-Host "============================================="

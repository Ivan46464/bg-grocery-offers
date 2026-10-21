# Builds a signed release APK locally (no EAS). Requires JDK 17 and the Android SDK.
# Usage (from the mobile folder):  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
$ErrorActionPreference = "Stop"
$mobile = Split-Path -Parent $PSScriptRoot
Set-Location $mobile

if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Android\jdk" }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = "C:\Android\sdk" }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;" + $env:Path

Write-Host "== prebuild (regenerates android/)"
npx expo prebuild --platform android --no-install --clean
if ($LASTEXITCODE -ne 0) { throw "prebuild failed" }

Write-Host "== signing config"
python scripts\patch_signing.py
if ($LASTEXITCODE -ne 0) { throw "signing patch failed" }

"sdk.dir=" + ($env:ANDROID_HOME -replace "\\", "/") | Out-File -Encoding ascii android\local.properties
# Only the architecture real phones use (halves the build time)
(Get-Content android\gradle.properties) -replace "reactNativeArchitectures=.*", "reactNativeArchitectures=arm64-v8a" | Set-Content -Encoding ascii android\gradle.properties

Write-Host "== gradle assembleRelease"
Set-Location android
.\gradlew.bat :app:assembleRelease --no-daemon -q
if ($LASTEXITCODE -ne 0) { throw "gradle failed" }
Set-Location $mobile

$apk = "android\app\build\outputs\apk\release\app-release.apk"
$version = (Get-Content app.json | ConvertFrom-Json).expo.version
$out = Join-Path (Split-Path -Parent $mobile) "Market-$version.apk"
Copy-Item $apk $out -Force
Write-Host "== APK: $out"

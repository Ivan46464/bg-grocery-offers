# Builds a signed release APK locally (no EAS). Requires JDK 17 and the Android SDK.
# Usage (from the mobile folder):  powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1
$ErrorActionPreference = "Stop"
$mobile = Split-Path -Parent $PSScriptRoot
$MIRROR = "C:/g"
if ((($mobile -replace "\\", "/").TrimEnd("/")) -ne $MIRROR) {
  # Build from a short path copy: the C++ codegen produces paths longer than Windows' 260-char limit otherwise.
  Write-Host "== mirroring $mobile -> $MIRROR"
  New-Item -ItemType Directory -Force $MIRROR | Out-Null
  robocopy $mobile $MIRROR /MIR /XD "$mobilendroid" "$mobile.expo" /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
  $env:APK_OUT_DIR = Split-Path -Parent $mobile
  powershell -ExecutionPolicy Bypass -File "$MIRROR/scripts/build-apk.ps1"
  exit $LASTEXITCODE
}
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

# Newer CMake/ninja handle Windows long paths; keep native build output in a short folder.
$stage = "C:/b/" + (Split-Path -Leaf $mobile)
New-Item -ItemType Directory -Force $stage | Out-Null
Add-Content -Encoding ascii android/app/build.gradle "`nandroid { externalNativeBuild { cmake { version `"3.31.0`"; buildStagingDirectory `"$stage`" } } }`n"
$cmakeVersion = "3.31.0"

Write-Host "== gradle assembleRelease"
Set-Location android
.\gradlew.bat :app:assembleRelease --no-daemon -q
if ($LASTEXITCODE -ne 0) { throw "gradle failed" }
Set-Location $mobile

$apk = "android\app\build\outputs\apk\release\app-release.apk"
$version = (Get-Content app.json | ConvertFrom-Json).expo.version
$outDir = if ($env:APK_OUT_DIR) { $env:APK_OUT_DIR } else { Split-Path -Parent $mobile }
$out = Join-Path $outDir "Market-$version.apk"
Copy-Item $apk $out -Force
Write-Host "== APK: $out"

"""After `npx expo prebuild`, point the Android release build at credentials/release.p12 (gitignored).

Usage: python scripts/patch_signing.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GRADLE = ROOT / "android" / "app" / "build.gradle"
PROPS = ROOT / "credentials" / "release.properties"


def main() -> int:
    if not GRADLE.exists():
        print("android/app/build.gradle not found; run `npx expo prebuild --platform android` first")
        return 1
    if not PROPS.exists():
        print("credentials/release.properties not found")
        return 1
    props = dict(line.split("=", 1) for line in PROPS.read_text(encoding="utf-8").splitlines() if "=" in line)
    store = (ROOT / "credentials" / props["storeFile"]).resolve().as_posix()
    text = GRADLE.read_text(encoding="utf-8")
    if "marketRelease" in text:
        print("already patched")
        return 0

    release_cfg = (
        "        marketRelease {\n"
        f"            storeFile file('{store}')\n"
        f"            storePassword '{props['storePassword']}'\n"
        f"            keyAlias '{props['keyAlias']}'\n"
        f"            keyPassword '{props['keyPassword']}'\n"
        f"            storeType '{props.get('storeType', 'PKCS12')}'\n"
        "        }\n"
    )
    # 1. add our signing config next to the generated debug one
    text, n = re.subn(r"(signingConfigs\s*\{\n)", r"\1" + release_cfg.replace("\\", "\\\\"), text, count=1)
    if n != 1:
        print("could not find signingConfigs block")
        return 1
    # 2. make the release build type use it
    text, n2 = re.subn(r"(release\s*\{[^}]*?)signingConfig signingConfigs\.debug", r"\1signingConfig signingConfigs.marketRelease", text, count=1, flags=re.S)
    if n2 != 1:
        print("could not find release buildType signingConfig")
        return 1
    GRADLE.write_text(text, encoding="utf-8")
    print("patched", GRADLE)
    return 0


if __name__ == "__main__":
    sys.exit(main())

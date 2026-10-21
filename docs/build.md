# 빌드 · 테스트 · 릴리스

모든 빌드와 테스트는 **Windows 10/11 64비트**에서 실행한다. 스크립트에 Windows 경로(`C:\devkitPro`, Azahar)가 하드코딩되어 있다.

산출물 바이너리는 git에 커밋하지 않는다. `.gitignore` 대상: `engine/*.elf`, `converter/**/bin/`, `converter/**/obj/`, `dist/`, `out/`, `tools/`, `roms/`.

## 1. 엔진 빌드

필요: devkitPro (devkitARM, libctru), `C:\devkitPro` 설치.

```sh
bash scripts/build_engine.sh
```

- 산출물: `engine/engine.elf`
- 추가 make 인자 전달 가능 (`bash scripts/build_engine.sh clean`)
- msys2 bash를 직접 호출한다 (Git Bash에는 make가 없음)

## 2. 변환기 빌드

필요: .NET 10 SDK.

선행 준비:

1. 엔진 빌드 (§1) — csproj가 `engine/engine.elf`를 출력 폴더의 `tools\`에 복사한다
2. 외부 도구 배치 (릴리스에서 받아 둘 것, git 제외):
   - `tools/makerom/makerom.exe` ([makerom](https://github.com/3DSGuy/Project_CTR))
   - `tools/bannertool/windows-x86_64/bannertool.exe` ([bannertool](https://github.com/diasurgical/bannertool))

```sh
dotnet build -c Release converter/Neo3dsConverter
```

- 산출물: `converter/Neo3dsConverter/bin/Release/net10.0-windows/` — exe + `tools\` (`engine.elf`, `neo3ds.rsf`, `makerom.exe`, `bannertool.exe`)
- exe와 `tools\` 폴더는 항상 같이 둔다
- 버전: `converter/Directory.Build.props`의 `<Version>`이 단일 출처 (웹용 `version.js`는 `build_wasm.sh`가 생성, git 제외)

## 3. CIA 만들기 (수동 확인)

```sh
Neo3dsConverter.exe <게임.zip> [저장 폴더] [--title "이름"] [--icon 그림.png] [--banner 그림.png] [--set 롬셋] [--system aes|mvs] [--region eu|jp|us] [--pack] [--lang ko|en]
Neo3dsConverter.exe <게임.zip> [게임2.zip ...] [저장 폴더] [--system aes|mvs] [--region eu|jp|us] [--pack] [--lang ko|en]
Neo3dsConverter.exe --launcher [저장 폴더]
```

- 게임 롬 zip과 `neogeo.zip`을 같은 폴더에, zip 이름은 MAME 이름 유지
- Title ID는 zip 파일명에서 고정 생성 → 같은 zip으로 다시 만들면 기존 설치 위에 덮어쓴다
- `--title`·`--icon`·`--banner`·`--set`은 zip 1개일 때만 (여러 개와 함께 쓰면 오류)
- `--pack`: CIA 대신 런처용 `.neo3ds` 파일 생성
- `NEO3DS_CXI=1` 환경변수: CIA와 함께 Azahar용 CXI도 생성
- `NEO3DS_DEBUG=1`: 실패 시 스택 트레이스 출력

## 4. Azahar 테스트 (개발 루프)

필요 (git 제외, 로컬 준비): `tools/azahar/azahar-windows-msvc-2126.2/azahar.exe`, `roms/*.zip`.

```sh
scripts/azahar_test.sh [rom.zip]   # 기본 roms/kof98.zip
```

1. 엔진 재빌드 (`out/build.log`에 기록) → `dist/converter/tools/engine.elf`에 복사
2. `NEO3DS_CXI=1`로 CXI 빌드 → `out/` (CXI는 `out/<롬셋>.cxi`, 예: `out/kof98.cxi`)
3. Azahar 종료 후 CXI로 재실행

사전 준비: 변환기 빌드 산출물(exe + `tools\`)을 `dist/converter/`에 복사해 둔다. 스크립트는 `dist/converter/Neo3dsConverter.exe`를 사용한다.

회귀 확인:

```sh
scripts/azahar_bench.sh
```

어트랙트 데모와 대전 진입 스크린샷을 `$TEMP/claude/s/`에 저장한다 (`demo.png`, `fight.png`). 벤치 스크립트는 `roms/kof98.zip` 고정 → `out/kof98.cxi`로 실행한다.

## 5. 실기 테스트

1. 만든 `.cia`를 SD 카드에 복사
2. 3DS에서 FBI → SD → 파일 선택 → Install CIA
3. HOME 메뉴에서 실행, FPS·사운드·조작 확인
4. 아래 화면 Diagnostics에서 코어 시간·메모리 확인 가능

## 6. 게임 DB 갱신

MAME `src/mame/snk/neogeo.cpp`를 받아서:

```sh
py scripts/gen_gamedb.py neogeo.cpp converter/assets/neogeo_games.json
```

## 7. 릴리스 (웹 + 오프라인 3종)

릴리스는 두 산출물이다: 웹 변환기 배포(메인) + 오프라인 변환기 패키지(Windows GUI, Linux·macOS CLI).

공통: `converter/Directory.Build.props`의 `<Version>`을 올린다 (단일 출처, AGENTS.md 버전 규칙).
웹용 `site/vendor/conv/version.js`는 `build_wasm.sh`가 `<Version>`에서 자동 생성한다.

### 7.1 웹 변환기 (Pages)

`main` 푸시 1회로 GitHub Actions(`.github/workflows/pages.yml`)가 `site/`를 빌드·검증 후 Pages에 배포한다.

1. 커밋 후 `main` 푸시
2. Actions → Pages 워크플로 확인: `build`(devkitARM Docker로 `engine.elf` 빌드 +
   emsdk로 WASM 3종 빌드 + `site/` 검증 게이트 + `conv.test.mjs`) → `deploy`
3. https://zzcx88.github.io/neo3ds/convert.html 에서 변환 1회 확인

배포물 (`site/`, 전부 정적):

- `convert.html` — 웹 변환기 ( per-game CIA · 런처 CIA · `.neo3ds` 팩 · 배치)
- `vendor/` — WASM 3종 + `engine.elf` + `neogeo_games.json` (CI가 빌드·스테이징, git 제외)

수동 실행: Actions → Pages → Run workflow.
로컬 재현: `bash scripts/build_wasm.sh` (전제: §1 엔진 빌드 + emsdk) 후 `site/`를 정적 서버로.

### 7.2 오프라인 변환기 패키지 (Windows GUI + Linux·macOS CLI)

태그(`v1.2.3`) 푸시로 GitHub Actions(`.github/workflows/build-release.yml`)가 3종 패키지를 만들고
GitHub Release에 올린다 (#55에서 복원).

1. `<Version>` 올리기 + 태그(`v<Version>`)가 `<Version>`과 일치하는지 확인
   (CI가 검증: 태그 ≠ `<Version>`이면 실패)
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Actions → Release 워크플로 확인: `engine`(devkitARM Docker로 `engine.elf` 빌드) → `package` 매트릭스 3종
   (windows-latest + ubuntu-latest + macos-14) → `release`(Release 생성 + 4개 파일 첨부)
4. 릴리스 페이지에서 4개 파일 확인

산출물 (파일명 고정 — README·소개 페이지의 latest/download 링크가 깨지지 않게):

- `neo3ds-converter.zip` — Windows GUI (exe + `tools\` + 런처 CIA)
- `neo3ds-converter-linux-x64.zip`, `neo3ds-converter-osx-arm64.zip` — CLI (해당 OS용 makerom·bannertool 포함)
- `neo3ds-launcher.cia` — 별도 첨부

Windows 도구는 최신 릴리스 zip에서 부트스트랩한다(최초 1회는 수동 배치, §2).
Linux·macOS 도구는 CI가 `scripts/build_unix_tools.sh`로 소스에서 빌드한다(upstream 태그 고정).

수동 실행: Actions → Release → Run workflow (드라이런, Release 미생성. 3종 산출물은 Artifacts로 받음).
로컬 패키징: `pwsh scripts/package_release.ps1 -Runtimes win-x64 -WithLauncher`
(전제: §1 엔진 빌드 + §2 외부 도구 배치. Unix는 해당 OS에서 `bash scripts/build_unix_tools.sh` 먼저)

# 빌드 · 테스트 · 릴리스

릴리스 패키징은 OS별 러너에서 수행하고, 일상 개발·검증은 macOS/Linux/Windows에서 가능하다. 단 Azahar 테스트 스크립트(§4)는 Windows 경로(`C:\devkitPro`, Azahar)가 하드코딩되어 있어 Windows에서만 실행한다.

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

릴리스는 두 산출물이다: 웹 변환기 배포(메인) + 오프라인 변환기 패키지(3종 모두 GUI + 명령줄).

공통: `converter/Directory.Build.props`의 `<Version>`을 올린다 (단일 출처, AGENTS.md 버전 규칙).
웹용 `site/vendor/conv/version.js`는 `build_wasm.sh`가 `<Version>`에서 자동 생성한다.

### 7.1 웹 변환기 (Pages)

`main` 푸시 1회로 GitHub Actions(`.github/workflows/pages.yml`)가 `site/`를 빌드·검증 후 Pages에 배포한다.

1. 커밋 후 `main` 푸시
2. Actions → Pages 워크플로 확인: `build`(devkitARM Docker로 `engine.elf` 빌드 +
   emsdk로 WASM 3종 빌드 + `site/` 검증 게이트 + `conv.test.mjs`) → `deploy`
3. https://zzcx88.github.io/neo3ds/convert.html 에서 변환 1회 확인

배포물 (`site/`, 전부 정적):

**영어가 기본**(루트), 한국어는 `/ko/` (#141). 저작 원본은 한국어 `site/ko/*.html` + 게임 DB이고,
루트 6페이지는 생성물이다.

- `index.html` — 소개 (EN, 생성물). `ko/index.html` — 한국어 원본
- `convert.html` — 웹 변환기 (EN, 생성물) · per-game CIA · 런처 CIA · `.neo3ds` 팩 · 배치. `ko/convert.html` — 한국어 원본
- `compat.html` — 호환 롬셋 282종 표 (EN, 생성물, JS 없이 크롤 가능). `ko/compat.html` — 한국어판
- `privacy.html` — 사용 통계·개인정보 (EN, 생성물). `ko/privacy.html` — 한국어 원본.
  `index.html`·`convert.html` 푸터에서 링크한다 (#125)
- `manual.html` — 3DS 사용 안내: 런처·조작·아래 화면·키 설정·세이브 경로 (EN, 생성물).
  `ko/manual.html` — 한국어 원본. 조작 표는 README와 같아야 하고 `site_gate.sh`가 대조한다 (#162)
- `changelog.html` — 패치노트: 릴리스 타임라인 (EN·KO 둘 다 생성물, 출처 `site/releases.json`).
  릴리스마다 JSON 항목 하나를 추가하고 생성기를 돌린다. 최상단 버전이 `<Version>`과 다르면 게이트 실패 (#166)
- `sitemap.xml`, `media/og.png`(EN 카드), `media/og-ko.png`(KO 카드), `media/favicon.svg` — 색인·공유 (#130)
- `vendor/` — WASM 3종 + `engine.elf` + `neogeo_games.json` (CI가 빌드·스테이징, git 제외)

`index.html`·`convert.html`·`compat.html`·`manual.html`·`changelog.html`은 Umami Cloud 트래커(`data-domains="zzcx88.github.io"`)를 싣고,
변환 페이지는 `convert_start`(모드, 배치면 `batch:3-5`처럼 규모 접미), `convert_done`(게임),
`convert_fail`(게임, `load/bios`처럼 단계/사유), `convert_save`(다운로드 클릭의 출력 모드),
`feedback_submit`(제보 전송 1회, 속성 없음) 다섯 이벤트만 보낸다.
게임 식별자는 공개 카탈로그의 롬셋 이름(`set`)뿐이며 zip 파일명은 보내지 않는다 (#125·#175·#189, ADR 0001).

생성물은 손으로 고치지 않는다. 한국어 원본을 고치고 아래를 실행해 산출물을 같이 커밋한다:

```bash
python3 scripts/gen_site_games.py    # site/games.js + compat.html (EN) + ko/compat.html
python3 scripts/gen_site_changelog.py  # site/changelog.html + ko/changelog.html (출처: site/releases.json)
node scripts/gen_site_i18n.mjs       # site/{index,convert,privacy,manual}.html (EN 문자열 출처: site/app.js 의 EN 표)
python3 scripts/gen_site_seo.py      # site/sitemap.xml
```

공유 카드는 `scripts/og/og.html`을 1200×630으로 렌더해 만든다 (저장소 루트에서 `python3 -m http.server` 후):

```bash
chrome --headless=new --window-size=1200,630 --screenshot=site/media/og.png \
  "http://127.0.0.1:8099/scripts/og/og.html?lang=en"
chrome --headless=new --window-size=1200,630 --screenshot=site/media/og-ko.png \
  "http://127.0.0.1:8099/scripts/og/og.html?lang=ko"
```

CI는 같은 생성기를 돌려 산출물이 커밋본과 같은지 확인한다 (`--check` / `git diff --exit-code`).
`site/` 검증 게이트(`bash scripts/site_gate.sh`, PR에서도 실행): JS `node --check` · 12개 페이지 태그 균형 ·
KO 원본의 `data-i18n` 키가 모두 `app.js` EN 표에 존재 · 루트 6페이지에 `data-i18n`/한글 잔재 0 ·
통계 페이지 10개의 Umami 태그 존재 · `sitemap.xml`·canonical·hreflang·og:image(로케일별) 일치 ·
패치노트 최상단 버전 = `converter/Directory.Build.props` `<Version>`.

수동 실행: Actions → Pages → Run workflow.
로컬 재현: `bash scripts/build_wasm.sh` (전제: §1 엔진 빌드 + emsdk) 후 `site/`를 정적 서버로.

### 7.2 오프라인 변환기 패키지 (3종 GUI + 명령줄)

태그(`v1.2.3`) 푸시로 GitHub Actions(`.github/workflows/build-release.yml`)가 3종 패키지를 만들고
GitHub Release에 올린다 (#55에서 복원, #102에서 GUI 동봉).

1. `site/releases.json` 맨 위에 릴리스 항목(버전·날짜·KO/EN 불릿)을 추가하고
   `python3 scripts/gen_site_changelog.py` 실행 — `<Version>` 범프와 **같은 커밋**에 넣는다.
   JSON이 `<Version>`보다 뒤처지면 `site_gate.sh`가 실패해 Pages 배포가 막힌다 (§7.1)
2. `<Version>` 올리기 + 태그(`v<Version>`)가 `<Version>`과 일치하는지 확인
   (CI가 검증: 태그 ≠ `<Version>`이면 실패)
3. `git tag vX.Y.Z && git push origin vX.Y.Z`
4. Actions → Release 워크플로 확인: `engine`(devkitARM Docker로 `engine.elf` 빌드) → `package-windows` + `package-unix` 매트릭스 2종
   (windows-latest + ubuntu-latest + macos-15) → `release`(Release 생성 + 4개 파일 첨부)
5. 릴리스 페이지에서 4개 파일 확인

산출물 (파일명 고정 — README·소개 페이지의 latest/download 링크가 깨지지 않게):

- `neo3ds-converter.zip` — Windows GUI (exe + `tools\` + 런처 CIA)
- `neo3ds-converter-linux-x64.zip` — Linux Desktop 단일 바이너리 (인자 없으면 창, 있으면 명령줄) + 런처 CIA
- `neo3ds-converter-osx-arm64.zip` — macOS `.app` 번들 (폴더 안) + 런처 CIA
- `neo3ds-launcher.cia` — 별도 첨부 (Windows에서 1회 생성, 3종에 동일 파일 주입)

macOS `.app`은 macOS 러너에서 ad-hoc 서명(`codesign --force --deep --sign -`) 후 `ditto`로 재압축한다 (#164).
공증은 하지 않으므로 첫 실행 경고 대응은 README를 따른다.
Unix zip의 변환기·`makerom`·`bannertool`(평면·rid 사본)은 0755여야 한다 — 압축을 풀면 바로 실행되어야 하고
변환기의 chmod는 읽기 전용 미디어 폴백일 뿐이다 (#179). CI가 `bash scripts/check_zip_modes.sh <zip> <runtime>`로
패키징 직후와 macOS `ditto` 재압축 후 두 번 검사한다(로컬에서도 같은 명령으로 확인 가능).

Windows 도구는 최신 릴리스 zip에서 부트스트랩한다(최초 1회는 수동 배치, §2).
Linux·macOS 도구는 CI가 `scripts/build_unix_tools.sh`로 소스에서 빌드한다(upstream 태그 고정).

미지원: Intel Mac, linux-arm64. Linux는 X11/XWayland 기본, Wayland 네이티브 미지원.

릴리스 롤백: 깨진 Release는 GitHub에서 삭제 후 `<Version>`을 올린 새 태그로 다시 낸다. 기존 태그를 덮어쓰지 않는다.

Desktop CI (`.github/workflows/desktop.yml`): `converter/**` 변경 시 3 OS 빌드 + Headless 테스트 + Core 테스트(도구 실행 권한) + no-ROM 스모크가 자동 실행된다.

수동 실행: Actions → Release → Run workflow (드라이런, Release 미생성. 3종 산출물은 Artifacts로 받음).
로컬 패키징: `pwsh scripts/package_release.ps1 -Runtimes win-x64 -WithLauncher`
(전제: §1 엔진 빌드 + §2 외부 도구 배치. Unix는 해당 OS에서 `bash scripts/build_unix_tools.sh` 먼저)

### 7.3 익명 제보 Worker (Cloudflare)

소개 페이지의 문제 신고 폼은 정적 페이지에서 Cloudflare Worker(`worker/`)로 POST하고, Worker가 이 저장소에
`needs-triage` 라벨 이슈를 만든다 (#188). 제보자는 계정이 필요 없고, zip 파일명·롬 데이터는 전송되지 않는다.
BIOS는 파일 대신 구성 프로필(존재·읽기 실패 여부, AES/MVS 칩 이름·지역, sfix/lo 일치·불일치, mismatch 슬롯, unknown 엔트리 수, UniBIOS 감지)만 보낸다 (#202·#203).
프라이버시 고지는 §7.1의 `privacy.html`이 담당한다 (#192).

최초 1회:

1. `npx wrangler login`
2. fine-grained PAT 발급: 이 저장소만, `Issues: Read/Write`
3. `cd worker && npx wrangler secret put GITHUB_TOKEN`
4. (권장) `npx wrangler kv namespace create RATE` → `worker/wrangler.toml`의 KV 주석 해제 + id 입력.
   없으면 isolate 메모리 카운터로 대체된다(시간당 5건, 근사치)
5. `npx wrangler deploy` → 출력된 `https://neo3ds-report.<account>.workers.dev` 확인
6. `site/ko/index.html`의 `<meta name="neo3ds-report-endpoint" content="...">`에 그 URL을 넣고
   `node scripts/gen_site_i18n.mjs` 실행 → 같은 커밋에 KO 원본과 EN 생성물을 함께 넣는다
7. Pages 배포 후 소개 페이지에서 제보 1건 전송 → 이슈 생성 확인

운영 토큰 만료: **2027-01-28**. 만료 2주 전(2027-01-14)에 새 토큰을 발급해
`npx wrangler secret put GITHUB_TOKEN`으로 교체하고, 라이브 제보 1건 확인 후 이전 토큰을 Revoke한다.

endpoint가 비어 있으면 폼은 "지금은 제보를 받을 수 없습니다"만 표시하고 아무것도 보내지 않는다.

로컬 검증:

```bash
node --test worker/test/*.test.mjs      # 검증·본문·핸들러 계약 (GitHub 호출은 스텁)
npx wrangler dev                        # 로컬 KV/메모리 사용
curl -X POST http://127.0.0.1:8787/ -H 'Origin: http://localhost:8788' \
  -H 'Content-Type: application/json' \
  -d '{"type":"site-bug","summary":"test report","log":"","website":""}'
```

`wrangler dev`에 실제 `GITHUB_TOKEN`을 넣으면 로컬에서 진짜 이슈가 만들어진다 —
검증 후에는 스팸 이슈를 닫고, 테스트용 토큰은 쓰지 않는다.

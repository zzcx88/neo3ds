# 기여 안내

neo3ds는 NeoGeo 롬셋을 3DS CIA로 바꾸는 변환기와 3DS 엔진을 함께 관리한다. 사람과 AI 에이전트가 같은 규칙을 따르며, 규칙의 정본은 [`AGENTS.md`](AGENTS.md)와 [`docs/build.md`](docs/build.md)다. 이 문서는 그 요약이므로 충돌하면 정본을 따른다.

## 1. 이슈 먼저

1. `gh issue list --state open`으로 중복을 확인한다.
2. 이슈가 없으면 만든다. 웹에서는 이슈 템플릿을, 터미널에서는 `gh issue create`를 쓴다.
3. 착수 전에 Assignee를 지정하고 착수 코멘트를 남긴다. 같은 이슈를 두 사람이 동시에 잡지 않는다.
4. 한 세션을 넘기는 작업은 계획 코멘트(범위·대상 파일·검증 방법)를 먼저 남긴다.
5. 다인원이 공유하는 파일(`converter/assets/neogeo_games.json`, `site/games.js`, README 호환성 표)을 고치기 전에는 이슈에 미리 선언한다.

변환 실패 제보는 [웹 변환기](https://zzcx88.github.io/neo3ds/)의 제보 기능을 쓰면 게임 이름과 BIOS 구성이 함께 전달된다.

## 2. 작업 시작

```sh
git pull --ff-only
git status --short                              # 깨끗하지 않으면 새 작업을 시작하지 않는다
git switch -c feat/<이슈번호>-<짧은설명>        # feat | fix | docs
```

- 브랜치 하나에 이슈 하나. 이름은 `feat|fix|docs/<이슈번호>-<짧은설명>`.
- 커밋은 gitmoji + 영역 형식: `:sparkles: site: 제보에 BIOS 구성 프로필 추가`, 본문에 `관련 이슈 #202`.
- `Co-authored-by` 푸터는 넣지 않는다.
- 무관한 변경이 작업 트리에 보이면 되돌리고 따로 이슈를 만든다.

## 3. 개발 환경

| 대상 | 필요 도구 |
| --- | --- |
| 엔진 (`engine/`) | devkitPro (devkitARM, libctru) |
| 웹 변환기 (`site/vendor/conv/`) | Emscripten (emsdk) |
| 오프라인 변환기 (`converter/`) | .NET 10 SDK |
| 사이트·스크립트 | Python 3, Node.js |
| Azahar 개발 루프 (`scripts/azahar_test.sh`) | Windows + Azahar (선택) |
| 실기 확인 | 3DS + FBI (선택) |

`tools/`(makerom, bannertool, Azahar), `roms/`, `dist/`, `out/`는 git 제외 로컬 준비물이다. 받는 방법은 [`docs/build.md`](docs/build.md) §2·§4에 있다.

## 4. 검증 명령

```sh
# 엔진 → engine/engine.elf
bash scripts/build_engine.sh

# 웹 변환기 → site/vendor/ (git 제외 산출물)
bash scripts/build_wasm.sh

# 오프라인 변환기: Windows는 Neo3dsConverter, Linux·macOS는 Neo3dsConverter.Desktop
dotnet build -c Release converter/Neo3dsConverter
dotnet build -c Release converter/Neo3dsConverter.Desktop

# C# 테스트
dotnet test converter/Neo3dsConverter.Desktop.Tests -c Release
dotnet test converter/Neo3dsConverter.Core.Tests -c Release

# 웹 변환기 모듈 테스트 (roms/가 없으면 ROM 의존 테스트는 SKIP)
node site/vendor/conv/conv.test.mjs

# 제보 Worker 테스트
node --test worker/test/*.test.mjs

# 사이트 게이트: 문법, 태그 균형, i18n 누락, 생성 파일 드리프트
bash scripts/site_gate.sh

# 스크립트 문법
bash -n scripts/*.sh
python3 -m py_compile scripts/*.py
```

- 엔진 동작을 바꿨으면 `bash scripts/azahar_test.sh`까지 통과시킨다. 이 스크립트는 Windows 경로(`C:\devkitPro`)가 하드코딩되어 Windows 전용이다 (`docs/build.md` §4).
- CI가 도는 검사: `.github/workflows/desktop.yml`은 3개 OS에서 C# 빌드·테스트와 no-ROM 스모크를, `.github/workflows/pages.yml`은 PR에서 `scripts/site_gate.sh`와 Worker 테스트를 돌린다.
- 실기 확인 없이 호환성 표를 "확인"으로 바꾸지 않는다. 미확인은 "추정"으로 표기한다.
- 롬이 있어야 도는 검증(`scripts/azahar_test.sh`, `scripts/azahar_bench.sh`)은 로컬에서만 돌린다.

## 5. 문서 동기화

| 바꾼 것 | 같은 커밋에서 바꿀 것 |
| --- | --- |
| `README.md` | `README.ko.md` |
| `docs/TECHNICAL.md` | `docs/TECHNICAL.ko.md` |
| `site/ko/*.html` (i18n 원본) | `node scripts/gen_site_i18n.mjs` → 영어 페이지 생성 |
| `converter/assets/neogeo_games.json` | `python3 scripts/gen_site_games.py` → `site/games.js` |
| `site/releases.json` | `python3 scripts/gen_site_changelog.py` → 사이트 changelog, `python3 scripts/gen_changelog.py` → `CHANGELOG.md` |
| `<Version>` (`converter/Directory.Build.props`) | `site/releases.json` 최상단 항목 + 위 생성기 2개 |

생성 파일은 손으로 고치지 않는다: `site/games.js`, `site/changelog.html`, `site/ko/changelog.html`, `CHANGELOG.md`, `site/vendor/conv/version.js`.

## 6. 커밋과 PR

- PR 본문은 [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)를 채운다: 변경 요약, 관련 이슈, 실행한 검증과 결과.
- squash merge를 쓰고, 머지 후 브랜치를 지운다.
- 리뷰 지적은 이슈로 등록한다. 착수 시 Assignee와 착수 코멘트, 완료 시 결과 코멘트(변경 파일·검증·후속) 후 닫는다.
- 푸시 전에 `git status`로 롬·바이오스·바이너리·stash 잔재가 섞이지 않았는지 확인한다.

## 7. 라이선스

- 소스는 GPL-2.0이다 ([`LICENSE`](LICENSE)). 제3자 코드와 라이선스는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 있다.
- CPU 코어(Cyclone 68000, DrZ80)가 비상업 라이선스라 배포물은 비상업 용도다. 그 조건과 충돌하는 코드는 받지 않는다.
- 롬, 바이오스, Azahar 키, 빌드 산출물은 커밋하지 않는다.

## 8. 행동 강령과 보안

- 행동 강령: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- 취약점 신고: [`SECURITY.md`](SECURITY.md)

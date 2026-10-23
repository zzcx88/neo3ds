# neo3ds — 에이전트 지침

NeoGeo 롬을 3DS CIA로 바꾸는 변환기 + 3DS 엔진. 릴리스 패키징은 OS별 러너에서 수행하고, 일상 개발·검증은 macOS/Linux/Windows에서 가능.
다인원 + AI 협업 전제: 공유 기록은 GitHub 이슈, 로컬 기록은 `docs/PROGRESS.md`.

절차 정본: `docs/build.md` (빌드·테스트·릴리스 — 해당 작업 시 먼저 읽기).

## 레이아웃

- `engine/source/` — 3DS 엔진 (devkitARM/libctru)
- `site/` — 소개 페이지 + 웹 변환기 (`convert.html`, 정적 호스팅)
- `site/vendor/conv/` — 웹 변환기 로직 (C# 포팅 ES 모듈 + Worker)
- `converter/` — C# 변환기 (정확도 기준선 + 오프라인 변환기 릴리스: Windows GUI, Linux·macOS CLI)
- `converter/assets/` — 게임 DB, RSF
- `scripts/` — 빌드·Azahar 테스트 스크립트
- 로컬 준비 (git 제외): `tools/` (makerom, bannertool, Azahar), `roms/`, `dist/`, `out/`

## 세션 · 컨텍스트 공유

- 작업 전 읽기 순서: `AGENTS.md` → 관련 이슈 → `docs/build.md`(빌드·테스트·릴리스 시) → `docs/PROGRESS.md`
- 시작: `git pull --ff-only` + `git status` 확인. 깨끗하지 않으면 새 작업 시작 금지
- 타인 잔재·`stash` 잔재는 손대지 말고 작성자에게 확인
- `docs/PROGRESS.md`는 git 제외라 멤버 간 공유 안 됨 — 공유용 기록은 이슈 코멘트에만
- 이슈 없는 작업은 이슈 생성 후 착수 선언. 장시간/대형 작업은 계획 코멘트(범위·대상 파일·예상 결과) 후 시작
- 같은 이슈 2인 착수 금지 — 착수 전 Assignee 확인
- 종료: `docs/PROGRESS.md` 갱신(날짜·한 일+결과·다음 할 일) + 관련 이슈에 결과 코멘트(변경 파일·검증·후속)

## 브랜치 · 커밋 · PR · 이슈

- 소규모 문서·단일 수정은 `main` 직접 푸시 가능. 기능·다파일 변경은 브랜치 + PR
- 브랜치명: `feat|fix|docs/<이슈번호>-<짧은설명>`, 브랜치당 이슈 1개
- 커밋: `:emoji: 영역: ...` gitmoji + 본문에 `관련 이슈 #N`. 무관 변경은 분리 커밋
- AI 커밋에 `Co-authored-by` 푸터 금지
- PR: 변경 요약·검증 방법·관련 이슈 명시, squash merge 권장, 머지 후 브랜치 삭제
- 감사 지적은 이슈로 등록. 착수 시 Assignee + 착수 코멘트, 완료 시 결과 코멘트 후 Close
- 푸시 전 `git status`: 무관 파일·stash 잔재·바이너리·롬 혼입 확인

## 코드 ↔ 문서 동기화

- 한·영 쌍은 같은 커밋에 함께 갱신: `README.md`↔`README.en.md`, `docs/TECHNICAL.ko.md`↔`docs/TECHNICAL.md`, `site/` i18n 키 누락 0
- 게임 DB 변경 시 `scripts/gen_site_games.py`로 `site/games.js` 재생성 — 수동 편집 금지
- VERIFIED 수 변경 시 README 호환성 표 + `site/` 문구를 같은 커밋에 함께 갱신
- 호환성 표는 실기 확인 결과만, 미확인은 "추정" 표기
- 버전 단일 출처: `converter/Directory.Build.props`의 `<Version>` (릴리스 시 여기만 올리기). 웹용 `site/vendor/conv/version.js`는 `scripts/build_wasm.sh`가 여기서 생성 (git 제외)
- `site/` 색·폰트·수치는 실제 코드에서만(`ui.h` 팔레트, `ui.c` 좌표, 진단 화면 값) — 창작 금지
- 문서 전용 변경은 `docs/`·`site/`·README 범위 유지

## 검증 게이트 · AI 작업 수칙

- 엔진: `bash scripts/build_engine.sh` / 웹: `bash scripts/build_wasm.sh` / `site/`: `node --check` + 태그 균형 + i18n 누락 0 / `scripts/`: `bash -n`·`py_compile` / C#(exe): `dotnet build -c Release`
- 엔진 동작 변경 시 `scripts/azahar_test.sh` 통과 후 커밋
- 커밋 전: 산출물·롬·바이오스 혼입 없음, 무관 파일 없음, 한·영 쌍 일치, 이슈 번호 참조
- 금지: 바이너리 커밋, 롬/바이오스 저장, 실측 없는 성능 수치 기재
- 도구 출력 접두사(`36:` 같은 줄번호)를 코드로 오인 금지 — 의심되면 `od -c`로 바이트 확인
- 공유 파일(`neogeo_games.json`, `games.js`, README 표) 수정 전 이슈에 사전 선언
- 무관 변경 발견 시 즉시 revert

## Agent skills

### Issue tracker

GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

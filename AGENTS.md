# neo3ds — 에이전트 지침

NeoGeo 롬을 3DS CIA로 바꾸는 변환기 + 3DS 엔진. 빌드·테스트는 Windows 전용.

절차 정본: `docs/build.md` (빌드·테스트·릴리스 — 해당 작업 시 먼저 읽기).

## 레이아웃

- `engine/source/` — 3DS 엔진 (devkitARM/libctru)
- `converter/Neo3dsConverter/` — .NET 10 WinForms 변환기
- `converter/assets/` — 게임 DB, RSF
- `scripts/` — 빌드·Azahar 테스트 스크립트
- 로컬 준비 (git 제외): `tools/` (makerom, bannertool, Azahar), `roms/`, `dist/`, `out/`

## 세션 시작·종료

- 시작: `docs/PROGRESS.md`를 읽고 이어서 작업 (없으면 신규 시작)
- 종료: `docs/PROGRESS.md` 갱신 — 날짜, 한 일 + 결과, 다음 할 일 (git 제외라 커밋 불필요)

## 규칙

- 산출물 바이너리(`engine.elf`, `bin/`, `dist/`, `out/`, CIA/CXI) 커밋 금지 — 재현 절차만 문서화
- 롬·바이오스를 저장소에 넣지 않기
- 버전은 `converter/Neo3dsConverter/Neo3dsConverter.csproj`의 `<Version>` 한 곳에서 관리
- README 호환성 표는 실기 확인 결과만 반영, 추정치는 "추정" 표기

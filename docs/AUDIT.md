# 코드베이스 감사 결과 (2026-10-13)

외부 스킬(jeffreys-skills codebase-audit)은 유료 잠금이라 본문을 쓸 수 없었음.
대신 같은 방식(도메인별 감사: 보안·UX·성능·API·문구·접근성)으로 engine / converter / site 3개 영역을 감사하고,
Critical급은 코드에서 직접 재확인했다.

## 영역별 산출물

| 파일 | 영역 | 건수 (C/M/m) |
|---|---|---|
| `AUDIT-engine.md` | `engine/source` (3DS 엔진 C) | 5 / 7 / 6 |
| `AUDIT-converter.md` | `converter/Neo3dsConverter` (변환기 C#) | 3 / 6 / 4 |
| `AUDIT-site.md` | `site/` (소개 페이지) | 3 / 7 / 6 |

## 지금 고칠 것 (Critical 11건 중 상위 5)

1. **site `.bar` 클래스 충돌** (`styles.css:147` + `index.html:23`) — 상단 내비 바가 24px로 잘림. 차트 막대 클래스 개명. (재확인됨)
2. **엔진 c.idx 무검증 파싱** (`loader.c:83-101`) — 깨진 변환 산출물 하나로 크래시/OOB. 헤더·offsets·block_size 검증 추가. (재확인됨)
3. **엔진 garouoffsets OOB 쓰기** (`neo/video.c:334-336`) — `y=31`에서 스택 OOB. 루프 재구성. (재확인됨)
4. **변환기 CLI 인자 크래시** (`Program.cs:26-40`) — 값 없는 플래그·인자 없음에 스택트레이스. 범위 검사 + 사용법 출력. (재확인됨)
5. **변환기 RomPack 버퍼 오버플로우 무검사** (`RomPack.cs:147-182`) — 깨진 zip/JSON에 크래시. 진입점 범위 검증. (에이전트 보고, 미재확인)

## 방법·한계

- 읽기 전용 분석. 빌드·실행 테스트는 하지 않음 (엔진·변환기는 Windows/devkitARM 전용).
- Critical 7건은 직접 코드 확인, 나머지는 에이전트 보고 그대로. 수정 전 해당 줄 재확인 권장.
- 엔진 경로는 에이전트 보고와 달리 실제 `engine/source/neo/*.c` (video/memory/인터페이스류). 아래 문서에 정정 반영.

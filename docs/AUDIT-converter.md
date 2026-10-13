# 변환기 감사 (2026-10-13)

대상: `converter/Neo3dsConverter` (WinForms 변환기, .NET 10). 읽기 전용 분석. 빌드·실행 테스트 없음.

## Critical (크래시·데이터 파괴)

### 1. `Program.cs:26-40` — CLI 인자 범위 검사 없음 ✅재확인
`--title` 등 뒤에 값 없으면 `args[++i]`가 `IndexOutOfRange`, 위치 인자 없으면
`positional[0]`에서 크래시. `--art-sheet`도 `args[1]` 무검사.
스크립트 오타 한 번에 스택트레이스만 나오고 사용법 안내 없음.
→ 플래그마다 `i+1 < Length` 확인, 없으면 사용법 출력 + `return 2`. `positional` 비어도 동일 처리.

### 2. `RomPack.cs:147-148` — copy 소스 영역 무검사 접근
`(op.Src == region.Name ? buf : built[op.Src])`, `AsSpan(op.A, op.C)` 모두 범위 검증 없음.
JSON 순서·값이 어긋나면 `KeyNotFound`/`ArgumentOutOfRange`로 끝나고 어느 칩·영역 문제인지 안 나옴.
→ `built.TryGetValue` + `op.A/C`가 소스·대상 길이 안에 드는지 확인 후
`InvalidDataException($"{game} {region} copy {src} 범위 초과")` 형태로 래핑.

### 3. `RomPack.cs:158-182` — Place() 대상 버퍼 오버플로우 무검사
깨진 zip(짧은 파일은 `Math.Min`으로 막히지만 긴 파일·잘못된 `offset`)이 `buf[offset+...]`를 터뜨림.
`16b/32b/16ws/32ws`는 `offset+size*stride` 검사가 전혀 없음.
→ 진입점에서 `offset/size/stride`로 쓰기 끝 계산 후 `buf.Length` 초과 시 칩 이름 포함 `InvalidDataException`.

## Major (UX·견고성)

### 4. `CiaBuilder.cs:198-215` — Run() stdout/stderr 데드락 패턴
`ReadToEndAsync` 시작 후 `ReadToEnd()` 동기 호출 + `WaitForExit()`는 출력이 많으면 고전적 데드락.
`makerom`/`bannertool` 로그가 길어지면 변환이 영원히 멈춤.
→ 둘 다 `ReadToEndAsync`로 받고 `await Task.WhenAll` + `WaitForExitAsync`, 타임아웃 추가.

### 5. `Protection.cs:41` — r["sprites"]/r["fixed"] 직접 인덱싱
영역 누락 시 `KeyNotFoundException` (칩 이름 없음). 사용자는 "왜 안 되는지" 모름.
→ `TryGetValue` 후 없으면 `InvalidDataException(게임명+영역명+빠진 칩)`.

### 6. `GameDb.cs:115-126` — MslugX 고정 오프셋 Poke 범위 무검사
잘린 `p.bin`이면 `0x3c38` 접근에서 `IndexOutOfRange`.
패치 스캔 루프(`i+=2` 전수 탐색)도 의도치 않은 위치를 NOP로 만들 위험.
→ `Poke`에 길이 가드, 고정 오프셋은 `a+1 < Length` 확인. 스캔은 패턴 길이만큼 상한 고정.

### 7. `MainForm.cs:205-208` — 실패 후 빌드 버튼 무조건 활성화
`finally { buildButton.Enabled = true; }`라 BIOS·롬셋 불량 상태에서도 재클릭 가능
→ 두 번째 클릭은 확정 실패 + 에러 팝업 반복.
→ `UpdateValidity()` 메서드로 추출해 `LoadRom`·`finally`에서 공통 호출 (`BiosZip != null && Game != null`).

### 8. `MainForm.cs:183-210` — 장시간 작업에 진행률·취소 없음
Zstd Lv19 압축은 수 분 걸리는데 피드백은 로그 4줄+모래시계뿐.
`Task.Run` 취소 토큰 없음, 창 닫기도 막지 않음.
→ `CancellationTokenSource` + `Progress<string>` 추가, `RomPack.WriteSprites` 블록 단위 진행 콜백,
빌드 중 컨트롤 비활성화·`FormClosing` 확인.

### 9. `CiaBuilder.cs:139` — 기존 .cia 덮어쓰기 무확인
출력이 롬 폴더 고정(`OutputDir = dir`)이라 재빌드가 기존 파일 silent overwrite.
→ `File.Exists(cia)`면 GUI는 `MessageBox Yes/No`, CLI는 `--force` 없으면 중단.

## Minor

### 10. `CiaBuilder.cs:114` — 깨진 zip 조기 검사의 에러 메시지 빈약
`ZipFile.OpenRead`가 던지는 원문 그대로 노출(영문·기술용어).
`RomSet.Read`의 CRC 불일치 메시지는 친절한데 입구에서는 아님.
→ `try/catch InvalidDataException` → "zip이 깨졌습니다. 다시 다운로드…" 로 래핑.

### 11. `MainForm.cs:146-148` — 드래그앤드롭 단일 파일·무피드백
`files[0]`만 보고 복수 드롭 무시, 비-zip 드롭은 `Effect.None` 외 설명 없음.
→ 복수면 첫 파일+로그 안내, 비-zip이면 상태 라벨에 이유 표시.

### 12. `CiaBuilder.cs:142-156` — makerom 인자 문자열 중복
CIA/CXI 두 블록이 옵션 6줄 복사. RSF·ELF·아이콘 변경 시 한쪽만 바뀌는 실수 확정.
→ `MakeromArgs(cia, product)` 헬퍼로 추출, CXI 분기는 `NEO3DS_CXI` env 그대로.

### 13. `CiaBuilder.cs:88-97` — CRC32 직접 구현
`System.IO.Hashing.Crc32` 표준 두고 수동 비트연산 유지. 테이블 미사용이라 느리고 검증 부담.
→ 표준 API로 교체, `UniqueId` 충돌 시사점 주석 유지.

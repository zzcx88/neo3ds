# 엔진 감사 (2026-10-13)

대상: `engine/source` (3DS 엔진, devkitARM/libctru). 주의: 아래 `neo/` 파일은 `engine/source/neo/`에 있음.
읽기 전용 분석. 빌드·실행 테스트 없음.

## Critical (크래시·메모리 파괴)

### C1. `loader.c:83-101` — c.idx 무검증 파싱 ✅재확인
`idx_size` 확인 없이 헤더/`offsets`/`usage` 역참조. `block_size`가 0이면
`neo/video.c:149`(`size/bsize`)·`:176`(`/ (slot>>7)`)에서 0除 크래시,
`offset[bank+1]`이 pak 범위를 벗어나면 OOB 읽기. 깨진 변환 산출물 하나로 크래시 확정.
→ 헤더+오프셋+usage 크기 검증, offsets 단조·`<pak_size` 확인,
block_size는 128배수·2거듭제곱·`max_slot≥1` 강제.

### C2. `loader.c:181-185` — gfix malloc 결과 미확인
`gfix_usage.p=malloc` 결과 미확인 후 `convert_all_char`가 usage에 기록.
OOM/크기 0이면 NULL 역참조 쓰기.
→ NULL이면 `fail` 후 `return false`.

### C3. `loader.c:184` — sfix 변환 크기 `0x20000` 하드코딩
실제 파일이 작으면 `convert_all_char`의 in-place 쓰기가 힙을 넘어씀.
→ 실제 `size` 사용, 기대치와 다르면 로드 실패.

### C4. `neo/video.c:334-336` — garouoffsets[32] OOB ✅재확인
`y=31`에서 마커 조건 성립 시 `[31]` 기록 후 또 `y++` 하며 `[32]`에 스택 OOB 쓰기.
VRAM은 게임 제어 값이므로 도달 가능.
→ 분기당 `y++` 한 번이 되도록 루프 재구성.

### C5. `neo/drz80_interf.c:119-151,201-213` — m1 무조건 0xf800 memcpy
m1이 63KB 미만이면 힙 OOB 읽기. 뱅크 윈도우(`0x8000+0x4000` 등)도 ROM 끝 검증 없이 복사.
→ 로더에서 m1 최소 크기 강제 또는 복사 길이 clamp.

## Major (경계 누락·데드코드)

### M1. `neo/memory.c:285-294,510-533` — SRAM word 접근 경계 누락
`0xd0ffff` word 읽기/쓰기가 `sram[0x10000]` 1B OOB.
→ 인덱스에 `&0xffff` 래핑.

### M2. `neo/memory.c:966-977` — SMA bankaddress 무검증
`bankaddress = 0x100000 + bksw_offset[data]`, sma.bin 값이 음수/거대하면 ROM OOB 읽기.
→ `[0x100000, size)` clamp.

### M3. `neo/cyclone_interf.c:107-141,150-258` — MyRead*/MyCheckPc ROM 크기 미확인
1MB 미만 p.bin, `bankaddress+addr` 오버런, 짧은 BIOS 모두 힙 OOB 읽기
(초기 소용량 타이틀에서 현실적).
→ 로더에서 1MB 경계 패딩 또는 접근부 clamp.

### M4. `loader.c:187-188,207` — 벡터 `memcpy(...,0x80)` 크기 미확인
짧은 p/BIOS면 OOB 읽기.
→ 양쪽 모두 `≥0x80` 검증.

### M5. `loader.c:212-237` — convert_all_char 32배수 미검증
`Taille%32≠0`이면 끝을 넘어 읽기·쓰기하고 usage(`size>>5`)도 초과 기록.
→ 32배수 검증 후 실패 처리.

### M6. `neo/video.c:441-454,708` — ng_lo 64KB 테이블 가정
lo.bin 크기 미검증. 짧으면 줌 조회마다 OOB.
→ `≥0x10000` 강제.

### M7. 데드코드 — 삭제 대상
- `neo/memory.c:788-823` (`return` 뒤 도달 불가)
- `neo/video.c:831-1014` `draw_screen_scanline` (미호출, `video_template.h` 3중 include 포함)
- `neo/cyclone_interf.c:95-105,470-495` (`swap_memory`, `cpu_68k_run` 미사용)
- `neo/memory.c:75-97` (`if(0)`)

## Minor (정확도·타이밍·핫패스)

- **m1** `neo_glue.c:97-99` — Z80 `73333`은 4MHz/59.185(=67584)보다 약 8.5% 오버클럭인데 주석은 "4 MHz".
  사운드 타이밍 오차 의심. → 근거 주석 추가 또는 값 정정.
- **m2** `neo/pd4990a.c:113-118` — `tm_year`(1900 기준, 예 126)를 그대로 BCD 인코딩해 연도 파손(`0xC6`).
  → `%100`.
- **m3** `neo/cyclone_interf.c:314,318-390` — watchdog 킥이 바이트 쓰기에서만 처리.
  word/long 킥은 무시돼 오리셋 가능. → 16/32비트 경로에도 추가.
- **m4** `main.c:110-111,462-466` — `prof_ticks`/`spr_lines`를 코어1 기록과 메인 리셋이 비원자 공유.
  32비트 ARM에서 u64 찢김 가능(진단 수치만 영향). → 스냅샷 후 읽기.
- **m5** `neo_glue.c:104` + `main.c:407` — `render=false`면 `audio_end_frame` 미호출로 오디오 로그 정체.
  호출처는 항상 true라 데드 파라미터. → 파라미터 제거 또는 false 경로 pacing 유지.
- **m6** `neo/video.c:701-707` — `size>0x20` 경로에서 스캔라인당 `%` 연산(소프트 나눗셈) 반복.
  핫패스 저격 지점. → 테이블/사전계산으로 호이스팅.

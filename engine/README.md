# neo3ds 엔진

3DS용 Neo Geo 에뮬레이터 엔진. devkitARM + libctru로 빌드하며, gngeo 에뮬레이션 코어를 3DS에 맞게 붙인 것이다.

## 빌드

Windows 전용. 자세한 절차는 `docs/build.md` §1을 본다. repo 루트에서:

```sh
bash scripts/build_engine.sh
```

산출물 `engine/engine.elf`는 변환기가 빌드 시 출력 폴더의 `tools\`에 복사해 CIA 재료로 쓴다.

## 소스 구조 (`engine/source/`)

- `main.c` — 진입점, 프레임 루프
- `loader.c` / `launcher.c` — 롬 로딩, 게임 선택 런처
- `audio.c` / `keys.c` / `ui.c` — 사운드, 입력, 화면 UI
- `save.c` / `savestate.c` — SRAM 저장, 세이브스테이트
- `neo_glue.c` — gngeo 코어와 3DS 계층 사이 접착 코드
- `neo/` — 메모리 맵·비디오·타이머·BIOS 접착 (gngeo 기반)
- `neo/cyclone/` · `neo/drz80/` — 68000 / Z80 CPU 코어 (ARM 어셈블리)
- `neo/ym2610/` — YM2610 사운드 코어
- `zstd/` · `lz4/` — 롬 압축 해제 / `compat/` — gngeo용 SDL 호환 헤더

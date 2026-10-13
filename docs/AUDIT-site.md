# 소개 페이지 감사 (2026-10-13)

대상: `site/index.html`, `site/app.js`, `site/games.js`, `site/styles.css`,
`scripts/gen_site_games.py`, `scripts/make_site_media.py`. 읽기 전용 분석.

## Critical (즉시 수정)

### 1. `styles.css:147` + `index.html:23` — `.bar` 클래스 충돌 ✅재확인
헤더(`header.bar`, styles.css:48 정의)와 차트 막대(`span.bar`, styles.css:147 정의)가 같은 클래스라,
뒤에 선언된 차트 규칙(`height:24px; overflow:hidden`)이 상단바에도 적용돼 헤더 내용이 24px로 잘림.
전역 내비·다운로드 버튼이 잘려 사이트 진입로가 깨짐.
→ 차트 막대를 `.fbar` 등으로 개명하고 관련 셀렉터 일괄 교체.

### 2. `styles.css:36` — `::focus-visible` 문법 오류 ✅재확인
콜론 2개는 존재하지 않는 문법이라 키보드 포커스 링이 전역에서 미표시.
키보드·스크린리더 사용자가 위치를 알 수 없음.
→ `:focus-visible`로.

### 3. `app.js:177` — reduced-motion 셀렉터 불일치
대체 코드의 셀렉터 `.device img`가 실제 DOM(`.photo-device`)과 불일치해 실행 안 됨.
모션 민감 사용자에게 3.6MB GIF 2개가 계속 재생.
→ 셀렉터를 `.photo-device img`로, CSS의 `prefers-reduced-motion` 규칙과 함께 동작 확인.

## Major (성능·접근성·반응형)

### 4. `index.html:271` — `.ex-list` ARIA 구조 무효
`role="rowgroup"`인데 자식은 `button`이라 보조기기가 목록으로 인식 못 함.
→ role 제거 후 `role="list"` + 각 행 `role="listitem"` 내 버튼, 또는 role 전부 삭제.

### 5. `index.html:211-214` — 메모리 모드 탭 패턴 불완전
`role="tablist/tab"`인데 tabpanel·방향키 내비 없음. 탭 패턴을 깨서 SR 혼란.
→ `role="group"` + `aria-pressed`로 다운그레이드.

### 6. `index.html:25,33,154,172,211,252` — aria-label 영어 하드코딩
`sections`/`Language`/`romsets`/`converter log`/`memory mode`/`filters`가 영어 고정.
KO 기본 상태에서도 SR에 영어 노출, 언어 전환에도 고정됨.
→ 전부 `data-i18n-attr`로 옮기고 EN 사전에 키 추가.

### 7. `styles.css:259` — 1080px 이하 내비 소실
`.bar-nav{display:none}`인데 대체 내비 없음. 태블릿·모바일에서 섹션 이동 수단 소실.
→ 내비를 가로 스크롤 한 줄로 유지하거나 메뉴 버튼 도입.

### 8. 성능 — 미디어 5.7MB + 렌더 블로킹 폰트
`site/media/` 합계 약 5.7MB(`game-mslug3.gif` 2.1M + `game-kof98.gif` 1.5M +
`old-3ds.png` 1.2M + `ui-bottom.png` 868K). 외부 폰트 2건(`index.html:14-17`)도 렌더 블로킹.
모바일 첫 진입 LCP·데이터 비용 직격.
→ GIF 프레임·해상도 축소 또는 WebP/비디오 대체, `loading="lazy" decoding="async"`,
폰트 셀프호스팅 + `font-display:swap`.

### 9. `app.js:267-293` — 언어 전환 시 파이프라인 타이머 미취소
`refreshDynamic`→`resetPipeline`이 실행 중 파이프라인 타이머를 취소하지 않아,
초기화 후에도 옛 `tick`이 로그에 계속追記. 언어 바꾸면 로그가 두 언어로 뒤섞임.
→ run 토큰을 두고 reset 시 무효화.

### 10. JS 없이 빈 페이지 + 이중 관리 수치
게임 탐색기·수치·로그 전부 JS 렌더이고 `<noscript>` 없음.
하드코딩 수치(`index.html:244,253-256`의 282/242/13/40)는 `games.js`와 이중 관리라 드리프트 가능.
→ `<noscript>` 안내 + 카운트는 JS가 항상 덮어쓰도록(현재 덮어씀) 하고 HTML 기본값은 `—` 처리.

## Minor (i18n·카피·스크립트)

### 11. `index.html:7,10-11` — meta/OG 설명 한국어 고정
`setLang`도 `title`만 교체. EN 공유 시 한국어 스니펫.
→ 영문 description 추가 또는 정적 EN 미러.

### 12. `app.js:151` — 누락 키 조용한 한국어 폴백
누락 키가 `?? s[2]`로 조용히 한국어로 폴백. 번역 누락이 눈에 안 띔.
→ 누락 시 `console.warn` + 키 커버리지 검사.

### 13. `index.html:303` vs `:286` — 메탈슬러그 X 서술 모순
FAQ는 "메탈슬러그 X 풀 스피드", 참고는 "2·X·3 원래 기판도 느려짐"으로 X가 양쪽에. 모순으로 읽힘.
→ "기본 풀 스피드, 원판 슬로우 구간 제외"로 통일.

### 14. `index.html:172` — aria-live 로그 과다 공지
`aria-live="polite"` 로그에 420ms마다 삽입. SR이 중간 과정을 계속 읽음.
→ 실행 중엔 live 해제, 완료 시 한 번만 공지.

### 15. `app.js:224` — pipe 4행 단위 누락
스프라이트 MB(`row[9]`)를 단위 없이 표시해 롬 크기(`row[4]`)와 혼동.
→ "그래픽 NNMB" 라벨 명시.

### 16. `make_site_media.py:14-20,52-60`, `gen_site_games.py:110` — 스크립트 견고성
경로 하드코딩, numpy/PIL 버전 미고정, 용량 상한 검사 없음(현재 5.7MB 방치).
`gen_site_games.py:110`의 `+= status == 1`(bool 합산)도 취약한 스타일.
→ 의존성 고정 + 출력물 크기 assert + `int()` 명시.

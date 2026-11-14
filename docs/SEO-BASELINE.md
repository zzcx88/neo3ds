# 검색 색인·유입 기준선 (#377)

한·영 소개 페이지와 웹 변환기의 검색 노출·유입을 배포 전후로 비교하기 위한 기준선이다.
사람이 Search Console·Umami에 로그인해야 볼 수 있는 값과, 누구나 다시 확인할 수 있는 공개 값으로 나눈다.

- 공개 값: `python3 scripts/seo_baseline.py` (아래 §2). 배포 전후 같은 명령으로 다시 잰다.
- 계정 필요 값: §3–§5. 사람이 확인해 이 문서에 적는다. **아직 채우지 않았다.**

## 1. 기록 시점

- 공개 기준선 기록: 2026-11-14 (UTC), `main` = `1e1b2bc`, 사이트 배포본 그대로
- 기준선 JSON: `python3 scripts/seo_baseline.py --out out/seo-baseline-<날짜>.json`으로 보관 (git 제외 경로 `out/`)

## 2. 공개 값 (자동)

`scripts/seo_baseline.py`가 네 랜딩 URL의 HTTP 상태·크기·응답 시간, `title`·`description`·canonical·hreflang·JSON-LD 종류, `sitemap.xml` URL 수와 네 URL 포함 여부를 JSON으로 남긴다. 200이 아니거나 canonical·설명·hreflang·구조화 데이터가 빠지면 종료 코드 1로 실패한다.

2026-11-14 기록 결과:

| URL | 상태 | canonical | hreflang | JSON-LD |
|---|---|---|---|---|
| `/` (EN 소개) | 200 | 일치 | ko·en·x-default | SoftwareApplication |
| `/ko/` (KO 소개) | 200 | 일치 | ko·en·x-default | SoftwareApplication |
| `/convert.html` (EN 변환기) | 200 | 일치 | ko·en·x-default | WebApplication |
| `/ko/convert.html` (KO 변환기) | 200 | 일치 | ko·en·x-default | WebApplication |

- `sitemap.xml`: 200, 38 URL, 네 랜딩 URL 모두 포함
- `robots.txt`: 404. GitHub Pages 프로젝트 사이트(`zzcx88.github.io/neo3ds/`)라 크롤러가 읽는 위치는 `zzcx88.github.io/robots.txt`(사용자 사이트 루트)이고, 이 저장소로는 만들 수 없다. 사이트맵은 Search Console 제출로만 알린다(§3).

외부 검색엔진에서 눈으로 확인한 색인 상태 (2026-11-14, `site:zzcx88.github.io/neo3ds`):

- DuckDuckGo: 결과 2건 — `/`(EN 소개), `/convert.html`(EN 변환기). 한국어 URL은 나오지 않았다.
- Bing: 결과 0건.
- 이 값은 검색엔진별 크롤·색인 상태를 보여 줄 뿐 Search Console의 색인 상태를 대신하지 않는다. 검색어·순위로 해석하지 않는다.

## 3. Search Console (사람)

속성 `https://zzcx88.github.io/neo3ds/` 소유 확인은 `site/googlefa7ea39192de4464.html`(200)로 되어 있다. 다만 **소유자 계정 접근 권한은 미확인**이다. 접근할 수 없으면 ① 소유자에게 이 저장소 관리자 계정 추가를 요청하고 ② 접근 불가 사실과 요청 날짜를 여기에 적는다.

기록할 항목 (조회 시점의 기간을 함께 적는다. 추정치는 만들지 않는다):

| 항목 | 값 | 확인 날짜 |
|---|---|---|
| 속성 유형·소유 확인 상태 | | |
| `sitemap.xml` 제출 여부·제출일 | | |
| 사이트맵 처리 상태(발견·읽음·오류) | | |
| 색인된 페이지 수 | | |
| 네 URL의 색인 상태와 Google이 고른 대표 URL | | |
| 색인 요청 필요 여부·요청 날짜 | | |
| 실적: 언어·URL별 검색어, 노출, 클릭 (조회 기간 명시) | | |

데이터가 부족하면(신규 속성·노출 0) "데이터 없음"으로 적는다. 색인은 보장된 결과가 아니며, 요청은 대기 상태를 바꿀 뿐이다.

## 4. Umami (사람)

- 페이지뷰: 페이지 URL·유입 referrer·기기·국가를 쿠키 없이 센다. 소개 페이지 URL과 변환기 URL의 페이지뷰를 언어별로 비교할 수 있다.
- 변환 이벤트: `convert_start`(mode, 배치면 `batch:3-5`), `convert_done`(game), `convert_fail`(game, stage), `convert_save`(mode), `feedback_submit`(속성 없음).
- **한계**: 이벤트에 방문자·세션 식별자가 없어서 "소개 페이지에서 변환기로 이동한 사람 수"를 정확히 셀 수 없다. 대신 변환기 페이지뷰의 referrer가 소개 페이지 URL인 비율을 보조 지표로 쓴다. 내부 이동 referrer가 보존되는지 먼저 확인하고, 보존되지 않으면 "측정 불가"로 기록한다. 계측 변경(새 이벤트·속성)은 이 이슈 범위가 아니므로 제안만 남긴다.
- 기록할 항목: 비교 기간, 언어별 소개·변환기 페이지뷰, referrer가 소개 페이지인 변환기 페이지뷰, `convert_start` 수, `convert_done`/`convert_fail` 수.

## 5. 배포 후 4~8주 비교 (사람)

비교 시작 기준: #375·#376 배포일. 배포일과 4주·8주 시점을 적는다.

| 비교 항목 | 배포 전 | 4주 | 8주 | 비고 |
|---|---|---|---|---|
| 언어별 소개 페이지 노출·클릭 | | | | Search Console |
| 언어별 변환기 노출·클릭 | | | | Search Console |
| 소개 페이지 페이지뷰 (ko·en) | | | | Umami |
| 변환기 페이지뷰 (ko·en) | | | | Umami |
| referrer가 소개인 변환기 페이지뷰 | | | | Umami, §4 한계 확인 후 |
| `convert_start` 수 | | | | Umami |
| `convert_done` / `convert_fail` | | | | Umami |

- 노출·클릭·순위 상승을 보장하지 않는다. 검색량 변동, 경쟁 문서, Google 정책 변경이 함께 작용한다.
- 비교 중 새 색인 문제(대표 URL 변경, 색인 제외 사유)가 보이면 별도 이슈로 등록한다.

## 6. 담당자 확인 사항

- [ ] Search Console 속성 접근 권한 확보 (없으면 소유자에게 요청한 날짜를 §3에 기록)
- [ ] `sitemap.xml` 제출 상태와 처리 결과 확인
- [ ] 네 URL 색인 상태·대표 URL 확인, 필요하면 색인 요청
- [ ] 실적 조회 기간을 적고 언어·URL별 검색어·노출·클릭 기록 (데이터 없으면 "데이터 없음")
- [ ] Umami에서 언어별 소개·변환기 페이지뷰와 referrer 지표 확인 (§4 한계 포함)
- [ ] #375·#376 배포일 기록, 4주·8주 시점에 §5 표 채우기
- [ ] 계측 변경이 필요하면 이 문서에 제안만 남기고 별도 이슈로 분리

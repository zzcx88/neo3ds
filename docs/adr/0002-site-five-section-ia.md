# 소개 페이지 IA: 5섹션, 기술 설명은 문서로

`site/index.html`이 8섹션 7,023px(모바일 10,426px)까지 길어져 호환성 섹션이 66–68% 지점에 있었고, 사용자가 가장 먼저 확인하려는 "내 롬셋이 변환되나"가 늦었다. 그래서 랜딩을 Hero · 3단계(+런처 흡수) · 호환성 · FAQ · Legal 5섹션으로 줄이고, 성능·조작 상세는 `docs/TECHNICAL.ko.md`·`README.ko.md`로 넘겼다. 랜딩에는 성능 수치 3개(16.7ms · 59.8fps · 64→20.3MB)와 조작 4칩만 남기고, 호환성은 3번째로 올렸다.

## Considered Options

- 8섹션 유지 + 접기: 스크롤 길이는 그대로라 호환성이 뒤에 남는다.
- Speed만 삭제: Touch·Launcher가 남아 호환성 위치가 크게 앞당겨지지 않는다.
- `site/tech.html` 신설: 기술 문서가 `docs/TECHNICAL`과 둘로 갈라진다.

## Consequences

- 성능·조작의 정본은 `docs/TECHNICAL.ko.md`·`README.ko.md`다. 랜딩에 상세를 다시 늘리려면 이 결정을 다시 본다.
- `#speed`·`#panel`·`#launcher` 앵커가 사라졌으므로 다른 페이지 내비도 3링크(설치·호환성·FAQ)로 맞춘다.
- 390px 이상은 3링크, 389px 이하는 첫 링크를 숨겨 브랜드·언어·Convert와 두 링크만 남긴다.
- 모바일 상세는 오른쪽 패널 대신 고른 행 아래로 인라인 확장한다.

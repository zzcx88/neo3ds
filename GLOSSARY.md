# neo3ds

NeoGeo 롬을 3DS CIA로 바꾸는 변환기 + 3DS 엔진. 오프라인 변환기 GUI 계획(#85)의 단계 용어를 정의한다.

## Language

**P1a**:
macOS Avalonia 스파이크. SkiaSharp 공존·.app 패키징 go/no-go 판정. 완료(#87).
_Avoid_: 맥 스파이크, spike

**P1b**:
Linux GUI 확인. Linux 창·CIA 생성 검증. 환경 미확보로 P2 이후.
_Avoid_: 리눅스 스파이크

**P2**:
Avalonia GUI 포팅 단계 전체. 아래 세 티켓으로 구성.
_Avoid_: 포팅

**P2a**:
단일 흐름 완성. Desktop 프로젝트 신규 생성 + 출력 폴더 변경 + CIA 버튼 + 에러 대화상자.
_Avoid_: 단일 플로우

**P2b**:
배치·아트·런처. 배치 변환 + 아트 선택 + 런처 CIA + 런처 팩.
_Avoid_: 배치 티켓

**P2c**:
언어·폰트·폴리시. KO/EN 재시작 전환 + Linux 폰트 번들(D7a) + 시각 폴리시.
_Avoid_: 마무리 티켓

**Desktop**:
Avalonia 기반 크로스플랫폼 GUI 프로젝트(`Neo3dsConverter.Desktop`). 스파이크 코드가 아닌 P2a에서 새로 작성하는 구현.
_Avoid_: 데스크톱 앱, Avalonia 앱

**Spike**:
버려지는 답 확인용 코드. main에 머지하지 않고 브랜치에 근거로 보존.
_Avoid_: 스파이크 코드, 프로토타입

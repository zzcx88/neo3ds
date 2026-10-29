neo3ds converter {VERSION} - MAME Neo Geo romset -> Nintendo 3DS CIA
https://github.com/zzcx88/neo3ds

[한국어]
이 폴더(변환기 실행 파일 + tools 폴더)를 통째로 원하는 곳에 두세요. 실행 파일만 따로 꺼내면 실행되지 않습니다.
1. 게임 롬 zip(MAME 롬셋, 예: kof99.zip)과 neogeo.zip(바이오스)을 같은 폴더에 둡니다. MAME 롬셋만 지원하며, MAME 규격(롬셋 이름·칩 CRC)과 다른 롬셋은 변환되지 않습니다.
2. Neo3dsConverter.exe를 실행하고 롬 zip을 창에 끌어다 놓은 뒤 [CIA 만들기]를 누릅니다. 여러 개를 한 번에 넣어도 됩니다.
3. 만든 .cia를 SD 카드에 복사하고 FBI로 설치합니다. (Luma3DS 커스텀 펌웨어 필요)
   소리가 나려면 SD 카드에 /3ds/dspfirm.cdc가 있어야 합니다.
런처: neo3ds-launcher.cia를 한 번 설치하고, [런처용 파일 만들기]로 만든 .neo3ds 파일을 SD 카드 /neo3ds/games/에 넣으면
      앱 하나에서 게임을 골라 실행합니다.
퀵세이브: 아래 화면 [Slot] [Save] [Load] 또는 SELECT+L(저장) / SELECT+R(불러오기).
처음 실행 때 Windows가 "알 수 없는 게시자" 경고를 띄우면 [추가 정보] -> [실행].
Linux·macOS: 인자 없이 실행하면 창이 뜨고(Linux는 ./neo3ds-converter, macOS는 neo3ds-converter.app),
             인자를 주면 명령줄로 동작합니다. ./neo3ds-converter kof99.zip 처럼 실행하고, 옵션은 --help.
             런처 CIA는 ./neo3ds-converter --launcher 로 만듭니다.
             macOS: 앱을 처음 실행하기 전에 neo3ds-converter.app을 ~/Applications나 /Applications로
             옮기세요. 압축을 푼 자리(~/Downloads)에서 바로 실행하면 macOS가 앱을 읽기 전용 사본에서
             돌리며, 변환기 v1.3.1 이하는 이 상태로 CIA를 만들면
             "Read-only file system : .../AppTranslocation/.../bannertool"로 실패합니다.
             옮기기 어려우면 위 폴더에서 xattr -dr com.apple.quarantine <이 폴더> 를 한 번 실행하세요.
             Linux는 libx11-6, libice6, libsm6, libfontconfig1이 필요합니다.
             창 한글은 앱 내장 글꼴로 나오지만 아이콘·배너 한글 제목은 시스템 한글 글꼴이
             필요하며, 없으면 □로 나옵니다. fonts-noto-cjk 같은 패키지를 설치하세요.
롬은 포함되어 있지 않습니다. 만든 CIA를 다른 사람에게 배포하지 마세요. 비상업적 용도로만 쓸 수 있습니다.

[English]
Keep this folder (the converter program + the tools folder) together. The program does not run on its own.
1. Put the game zip (MAME romset, e.g. kof99.zip) and neogeo.zip (BIOS) in the same folder. Only MAME romset zips are supported; a romset that does not match MAME's names and chip CRCs will not convert.
2. Run Neo3dsConverter.exe, drop the game zip on the window and press [Build CIA]. You can drop several at once.
3. Copy the .cia to the SD card and install it with FBI (Luma3DS custom firmware needed).
   Sound needs /3ds/dspfirm.cdc on the SD card.
Launcher: install neo3ds-launcher.cia once, then put the .neo3ds files made with [Launcher file] in /neo3ds/games/
          on the SD card to pick games from one app.
Quick save: [Slot] [Save] [Load] on the bottom screen, or SELECT+L (save) / SELECT+R (load).
If Windows shows an "unknown publisher" warning on first run, click [More info] -> [Run anyway].
Linux, macOS: with no arguments the window opens (Linux: ./neo3ds-converter, macOS: neo3ds-converter.app);
              with arguments it runs as a command line. Run it like ./neo3ds-converter kof99.zip; options: --help.
              ./neo3ds-converter --launcher builds the launcher CIA.
              macOS: before the first launch, move neo3ds-converter.app into ~/Applications or /Applications.
              Launched where it was unzipped (~/Downloads), macOS runs the app from a read-only copy, and
              converter v1.3.1 and older fail to build CIAs there with
              "Read-only file system : .../AppTranslocation/.../bannertool".
              Instead you can run xattr -dr com.apple.quarantine <this folder> once in Terminal.
              Linux needs libx11-6, libice6, libsm6, libfontconfig1.
              Window text uses the bundled Korean font, but icon/banner titles with
              Hangul need a system Korean font; without one they show as boxes.
              Install a package such as fonts-noto-cjk.
No ROMs are included. Do not share the CIAs you build. Non-commercial use only.

Licenses: LICENSE.txt (GPL-2.0) and THIRD_PARTY_NOTICES.md

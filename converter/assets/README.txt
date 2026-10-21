neo3ds converter {VERSION} - Neo Geo ROM -> Nintendo 3DS CIA
https://github.com/zzcx88/neo3ds

[한국어]
이 폴더(변환기 실행 파일 + tools 폴더)를 통째로 원하는 곳에 두세요. 실행 파일만 따로 꺼내면 실행되지 않습니다.
1. 게임 롬 zip(MAME 롬셋, 예: kof99.zip)과 neogeo.zip(바이오스)을 같은 폴더에 둡니다.
2. Neo3dsConverter.exe를 실행하고 롬 zip을 창에 끌어다 놓은 뒤 [CIA 만들기]를 누릅니다. 여러 개를 한 번에 넣어도 됩니다.
3. 만든 .cia를 SD 카드에 복사하고 FBI로 설치합니다. (Luma3DS 커스텀 펌웨어 필요)
   소리가 나려면 SD 카드에 /3ds/dspfirm.cdc가 있어야 합니다.
런처: neo3ds-launcher.cia를 한 번 설치하고, [런처용 파일 만들기]로 만든 .neo3ds 파일을 SD 카드 /neo3ds/games/에 넣으면
      앱 하나에서 게임을 골라 실행합니다.
퀵세이브: 아래 화면 [Slot] [Save] [Load] 또는 SELECT+L(저장) / SELECT+R(불러오기).
처음 실행 때 Windows가 "알 수 없는 게시자" 경고를 띄우면 [추가 정보] -> [실행].
Linux·macOS: 창 없이 터미널에서 씁니다. ./neo3ds-converter kof99.zip 처럼 실행하고, 옵션은 ./neo3ds-converter --help.
             런처 CIA는 ./neo3ds-converter --launcher 로 만듭니다.
             macOS에서 실행이 막히면 터미널에서 xattr -dr com.apple.quarantine <이 폴더> 를 한 번 실행하세요.
롬은 포함되어 있지 않습니다. 만든 CIA를 다른 사람에게 배포하지 마세요. 비상업적 용도로만 쓸 수 있습니다.

[English]
Keep this folder (the converter program + the tools folder) together. The program does not run on its own.
1. Put the game zip (MAME romset, e.g. kof99.zip) and neogeo.zip (BIOS) in the same folder.
2. Run Neo3dsConverter.exe, drop the game zip on the window and press [Build CIA]. You can drop several at once.
3. Copy the .cia to the SD card and install it with FBI (Luma3DS custom firmware needed).
   Sound needs /3ds/dspfirm.cdc on the SD card.
Launcher: install neo3ds-launcher.cia once, then put the .neo3ds files made with [Launcher file] in /neo3ds/games/
          on the SD card to pick games from one app.
Quick save: [Slot] [Save] [Load] on the bottom screen, or SELECT+L (save) / SELECT+R (load).
If Windows shows an "unknown publisher" warning on first run, click [More info] -> [Run anyway].
Linux, macOS: used from a terminal, no window. Run it like ./neo3ds-converter kof99.zip; options: ./neo3ds-converter --help.
              ./neo3ds-converter --launcher builds the launcher CIA.
              If macOS blocks it, run xattr -dr com.apple.quarantine <this folder> once in Terminal.
No ROMs are included. Do not share the CIAs you build. Non-commercial use only.

Licenses: LICENSE.txt (GPL-2.0) and THIRD_PARTY_NOTICES.md

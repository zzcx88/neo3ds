"""Series groups behind the site's long-tail pages (#186).

Data only: no file I/O. `gen_site_series.py` writes the pages, `gen_site_seo.py` adds
them to the sitemap and its head checks, and `gen_site_games.py` links them from
compat.html.

`sets` names MAME romsets that must exist in converter/assets/neogeo_games.json. A
stale name fails the build instead of shipping a page that lists a game nobody ships.

Placeholders available in every string: {count} romsets in the series, {ok} of them
convertible, {verified} confirmed on real hardware, {first} and {last} release years.

Only series with four or more romsets are listed: a page with two rows is thin
content, and twelve of those help nobody.
"""

SERIES = [
    {
        'slug': 'metal-slug',
        'sets': ['mslug', 'mslug2', 'mslugx', 'mslug3', 'mslug3a', 'mslug3h', 'mslug3b6',
                 'ms4plus', 'mslug4', 'mslug4h', 'mslug5', 'mslug5b', 'mslug5h', 'ms5plus',
                 'mslug2t'],
        'ko': {
            'name': '메탈슬러그',
            'title': '메탈슬러그 3DS — 롬셋 {count}종 CIA 변환 | neo3ds',
            'desc': '네오지오 메탈슬러그 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 설치 가능한 CIA로 나옵니다. 해적판·개조판도 구분해 표기.',
            'h1': '메탈슬러그 3DS',
            'lede': '본편 5종과 X, 그리고 개조판·부트렉까지 — 게임 DB 기준 {count}종.',
            'prose': [
                '나즈카가 1996년 MVS로 첫 작을 냈고, SNK는 2003년 메탈슬러그 5까지 같은 기판에 시리즈를 이어 갔다. 전부 네오지오 카트리지라서 엔진이 이미 돌리는 대상이다.',
                '처음이라면 mslug3.zip이나 mslugx.zip을 neogeo.zip과 함께 올려라. 게임마다 CIA가 따로 나오고 HOME 메뉴 아이콘도 각각 붙는다.',
            ],
        },
        'en': {
            'name': 'Metal Slug',
            'title': 'Metal Slug on 3DS — {count} romsets as CIAs | neo3ds',
            'desc': 'Every Metal Slug romset neo3ds recognises — {count} of them — with 3DS conversion status. {ok} convert to installable CIAs; bootlegs are marked as such.',
            'h1': 'Metal Slug on the 3DS',
            'lede': 'Five numbered games, X, and the bootleg and revision sets beside them — {count} romsets in the game database.',
            'prose': [
                'Nazca shipped the first Metal Slug on the MVS in 1996, and SNK kept the series on the same board through Metal Slug 5 in 2003. That is why the whole run is here: every entry is a Neo Geo cart the engine already runs.',
                'Start with mslug3.zip or mslugx.zip and drop neogeo.zip in the same batch. Each game lands as its own CIA with its own HOME menu icon.',
            ],
        },
    },
    {
        'slug': 'king-of-fighters',
        'sets': ['kof94', 'kof95', 'kof95a', 'kof95h', 'kof96', 'kof96a', 'kof96h', 'kof97',
                 'kof97h', 'kof97k', 'kof97oro', 'kof97pls', 'kog', 'kof98', 'kof98a', 'kof98h',
                 'kof98k', 'kof98ka', 'kof99', 'kof99e', 'kof99h', 'kof99k', 'kof99ka', 'kof99p',
                 'kof2000', 'kof2000n', 'kof2001', 'kof2001h', 'kof2002', 'kof2002b', 'kof10th',
                 'kf2k2mp', 'kf2k2mp2', 'kf2k2pla', 'kf2k2pls', 'kof2003', 'kof2003h', 'kf2k3bl',
                 'kf2k3bla', 'kf2k3pl', 'kf2k3upl', 'kf2k5uni', 'kof2k4se', 'kf10thep'],
        'ko': {
            'name': '킹 오브 파이터즈',
            'title': '킹 오브 파이터즈 3DS — 롬셋 {count}종 | neo3ds',
            'desc': 'KOF 94부터 2003까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 CIA로 변환됩니다. 한국판·해적판도 포함.',
            'h1': '킹 오브 파이터즈 3DS',
            'lede': '94부터 2003까지 매년 나온 본편과 리비전, 한국판, 해적판 — {count}종.',
            'prose': [
                'KOF는 1994년부터 2003년까지 같은 MVS 기판에서 매년 나왔다. 후반 카트리지는 CMC50 계열 보호가 걸려 있는데, 변환기가 브라우저 안에서 복호화한다.',
                '먼저 볼 세트는 kof98.zip이다. 이 목록에만 98 리비전이 네 종 있다. 암호화 카트리지는 복호화에 BIOS가 필요하니 neogeo.zip을 같이 넣어라.',
            ],
        },
        'en': {
            'name': 'The King of Fighters',
            'title': 'The King of Fighters on 3DS — {count} romsets | neo3ds',
            'desc': 'Every King of Fighters romset from 94 to 2003 — {count} of them — with 3DS conversion status. {ok} convert to installable CIAs.',
            'h1': 'The King of Fighters on the 3DS',
            'lede': 'Ten yearly entries, their revisions, the Korean releases and the bootlegs — {count} sets in the database.',
            'prose': [
                'KOF shipped every year from 1994 to 2003 on the same MVS board, so the mainline series is here in full. The later carts carry CMC50-era protection, which the converter decrypts inside the browser tab.',
                'Try kof98.zip first: this list alone holds four 98 revisions. Encrypted carts need the BIOS set to decrypt, so drop neogeo.zip alongside them.',
            ],
        },
    },
    {
        'slug': 'samurai-shodown',
        'sets': ['samsho', 'samshoh', 'samsho2', 'samsho2k', 'samsho2ka', 'samsho3', 'samsho3h',
                 'samsho4', 'samsho4k', 'fswords', 'samsho5', 'samsho5a', 'samsho5b', 'samsho5h',
                 'samsh5sp', 'samsh5sph', 'samsh5spho'],
        'ko': {
            'name': '사무라이 쇼다운',
            'title': '사무라이 쇼다운 3DS — 롬셋 {count}종 | neo3ds',
            'desc': '1993년 원작부터 사무라이 스피리츠 제로 스페셜까지, 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 CIA로 변환됩니다.',
            'h1': '사무라이 쇼다운 3DS',
            'lede': '본편 6종에 한국판·리비전·해적판까지 — {count}종.',
            'prose': [
                '무기를 쓰는 대전 격투로 1993년에 시작해 2004년 사무라이 스피리츠 제로 스페셜까지 이어졌다. 후반 작품은 게임 DB에서도 손꼽히게 용량이 큰 카트리지다.',
                '5편과 제로 스페셜은 CMC50 계열 보호가 걸려 있지만 변환기가 복호화하므로 무보호 세트와 똑같이 다룬다. 변환 시간이 짧은 쪽을 원하면 samsho2.zip부터.',
            ],
        },
        'en': {
            'name': 'Samurai Shodown',
            'title': 'Samurai Shodown on 3DS — {count} romsets | neo3ds',
            'desc': 'All {count} Samurai Shodown romsets, from the 1993 original to V Special, with 3DS conversion status. {ok} convert to installable CIAs.',
            'h1': 'Samurai Shodown on the 3DS',
            'lede': 'Six games plus Korean releases, revisions and bootlegs — {count} romsets.',
            'prose': [
                'The weapon-based fighter started in 1993 and ran to Samurai Shodown V Special in 2004, one of the last official MVS releases. The later entries are among the largest carts in the database.',
                'V and V Special carry CMC50-era protection; the converter decrypts them, so they behave like the unprotected sets. Pick samsho2.zip if you want the shorter conversion.',
            ],
        },
    },
    {
        'slug': 'fatal-fury',
        'sets': ['fatfury1', 'fatfury2', 'fatfursp', 'fatfurspa', 'fatfury3', 'rbff1', 'rbff1a',
                 'rbff1k', 'rbff1ka', 'rbffspec', 'rbffspeck', 'rbff2', 'rbff2h', 'rbff2k',
                 'garou', 'garouh', 'garouha', 'garoup', 'garoubl'],
        'ko': {
            'name': '페이탈 퓨리',
            'title': '페이탈 퓨리·가로우 3DS — 롬셋 {count}종 | neo3ds',
            'desc': '페이탈 퓨리 원작부터 리얼 바웃 2, 가로우 마크 오브 더 울브즈까지 네오지오 롬셋 {count}종의 3DS 변환 상태.',
            'h1': '페이탈 퓨리와 가로우 3DS',
            'lede': '1991년 원작, 속편 3종, 리얼 바웃 3종, 그리고 가로우 — 리비전·해적판 포함 {count}종.',
            'prose': [
                '페이탈 퓨리는 SNK의 2라인 격투를 대표하는 시리즈로 1991년에 나왔고, 리얼 바웃이 1995년에 틀을 다시 잡았으며 가로우가 1999년에 새 캐스트로 마무리했다.',
                '리얼 바웃 카트리지는 SMA 보호가 걸려 있으니 neogeo.zip을 같은 배치에 넣어라. 가장 많이 변환되는 세트는 garou.zip이다.',
            ],
        },
        'en': {
            'name': 'Fatal Fury & Garou',
            'title': 'Fatal Fury and Garou on 3DS — {count} romsets | neo3ds',
            'desc': 'All {count} Fatal Fury, Real Bout and Garou romsets on the Neo Geo, with 3DS conversion status. {ok} become installable CIAs.',
            'h1': 'Fatal Fury and Garou on the 3DS',
            'lede': 'The 1991 original, three sequels, three Real Bout games and Garou: Mark of the Wolves — {count} sets including revisions and bootlegs.',
            'prose': [
                'Fatal Fury put SNK two-lane fighting on the map in 1991, Real Bout rebuilt it in 1995, and Garou closed the line in 1999 with a new cast and a time skip.',
                'The Real Bout carts carry SMA protection, so keep neogeo.zip in the same drop. garou.zip is the set most people convert first.',
            ],
        },
    },
    {
        'slug': 'art-of-fighting',
        'sets': ['aof', 'aof2', 'aof2a', 'aof3', 'aof3k'],
        'ko': {
            'name': '용호의 권',
            'title': '용호의 권 3DS — 롬셋 {count}종 CIA 변환 | neo3ds',
            'desc': '용호의 권 1·2·3과 한국판·교체 기판까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 CIA로 변환됩니다.',
            'h1': '용호의 권 3DS',
            'lede': '본편 3종에 한국판과 교체 기판까지 — {count}종.',
            'prose': [
                '용호의 권은 1992년에 기력 게이지와 화면 줌을 들고 나왔다. 네오지오 하드웨어에서 흉내 내지 않아도 되는 기능이었다. 3편이 1996년에 나오며 시리즈가 끝났다.',
                'aof.zip과 aof2.zip은 별도 준비 없이 변환된다. 3편의 한국판은 별도 세트로 목록에 올라 있다.',
            ],
        },
        'en': {
            'name': 'Art of Fighting',
            'title': 'Art of Fighting on 3DS — all {count} romsets | neo3ds',
            'desc': 'All {count} Art of Fighting romsets — Ryuuko no Ken 1, 2 and 3 — with 3DS conversion status. {ok} convert to installable CIAs.',
            'h1': 'Art of Fighting on the 3DS',
            'lede': 'Three games, five sets with the Korean release and the alternate board.',
            'prose': [
                'Art of Fighting arrived in 1992 with a spirit gauge and a zooming camera that Neo Geo hardware could do without faking. The third game shipped in 1996 and ended the line.',
                'aof.zip and aof2.zip convert with nothing extra; the Korean release of the third game is listed as its own set.',
            ],
        },
    },
    {
        'slug': 'last-blade',
        'sets': ['lastblad', 'lastbladh', 'lastsold', 'lastbld2'],
        'ko': {
            'name': '월화의 검사',
            'title': '월화의 검사 3DS — 두 작품 롬셋 {count}종 | neo3ds',
            'desc': '월화의 검사 1·2와 리비전, 한국판까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. 전부 CIA로 변환됩니다.',
            'h1': '월화의 검사 3DS',
            'lede': '1997년과 1998년의 두 작품, 리비전 포함 {count}종.',
            'prose': [
                '월화의 검사는 막부 말기를 배경으로 삼아 막기보다 받아치는 쪽에 무게를 둔 격투 게임이다. 속편은 캐릭터마다 검 스타일을 둘로 나눴다.',
                'lastblad.zip과 lastbld2.zip이 부모 세트이고, lastsold.zip은 1편의 한국판이다.',
            ],
        },
        'en': {
            'name': 'The Last Blade',
            'title': 'The Last Blade on 3DS — both games | neo3ds',
            'desc': 'The Last Blade and The Last Blade 2, with every revision and the Korean release — {count} romsets, converted to installable 3DS CIAs.',
            'h1': 'The Last Blade on the 3DS',
            'lede': 'Two games from 1997 and 1998, {count} sets in total.',
            'prose': [
                'The Last Blade moved SNK weapon fighting to the Bakumatsu era, with a parry system built around deflecting rather than blocking. The sequel gave each character a second sword style.',
                'lastblad.zip and lastbld2.zip are the parent sets; lastsold.zip is the Korean release of the first game.',
            ],
        },
    },
    {
        'slug': 'world-heroes',
        'sets': ['wh1', 'wh1h', 'wh1ha', 'wh2', 'wh2h', 'wh2j', 'whp'],
        'ko': {
            'name': '월드 히어로즈',
            'title': '월드 히어로즈 3DS — 롬셋 {count}종 | neo3ds',
            'desc': '월드 히어로즈 1·2·2 Jet·Perfect와 리비전까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. 게임마다 HOME 메뉴 아이콘이 따로 붙는 CIA 하나로 나옵니다.',
            'h1': '월드 히어로즈 3DS',
            'lede': 'ADK의 격투 게임 4종과 리비전 — {count}종.',
            'prose': [
                'ADK는 1992년 월드 히어로즈에 시대를 넘나드는 역사 인물을 끌어모았다. 잔다르크와 라스푸틴이 같은 로스터에 있는 이유다. 1995년 Perfect가 마지막 작품이다.',
                '네 작품 모두 무보호 카트리지라 그대로 변환된다. 두 스타일의 중간 지점을 보려면 wh2j.zip.',
            ],
        },
        'en': {
            'name': 'World Heroes',
            'title': 'World Heroes on 3DS — all {count} romsets | neo3ds',
            'desc': 'World Heroes, 2, 2 Jet and Perfect from ADK — {count} romsets with 3DS conversion status. {ok} convert to installable CIAs.',
            'h1': 'World Heroes on the 3DS',
            'lede': 'Four ADK fighters and their revisions — {count} sets.',
            'prose': [
                'ADK built World Heroes in 1992 around historical figures pulled out of time, which is why Joan of Arc and Rasputin share a roster. Perfect in 1995 was the last entry.',
                'All four games convert as unprotected carts. wh2j.zip sits between the two styles.',
            ],
        },
    },
    {
        'slug': 'sengoku',
        'sets': ['sengoku', 'sengokuh', 'sengoku2', 'sengoku3', 'sengoku3a'],
        'ko': {
            'name': '전국',
            'title': '전국 3DS — 벨트액션 3부작 롬셋 {count}종 | neo3ds',
            'desc': '전국 1·2·3과 리비전까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 설치 가능한 CIA로 나옵니다. 게임별 연도와 상태를 표로 정리.',
            'h1': '전국 3DS',
            'lede': '1991년, 1993년, 2001년의 벨트액션 3부작 — {count}종.',
            'prose': [
                '전국은 두 플레이어가 막부 말기풍 배경에서 언데드 군단을 상대하는 벨트액션이다. 3편은 10년 뒤 같은 기판으로 나왔고 앞의 두 작품과 그림체가 다르다.',
                '세 작품 중 가장 큰 세트는 sengoku3.zip이고 문의도 가장 많다. neogeo.zip을 같은 배치에 넣어라.',
            ],
        },
        'en': {
            'name': 'Sengoku',
            'title': "Sengoku on 3DS — the beat-'em-up trilogy | neo3ds",
            'desc': "Sengoku, Sengoku 2 and Sengoku 3 with their revisions — {count} romsets, {ok} converting to installable 3DS CIAs.",
            'h1': 'Sengoku on the 3DS',
            'lede': 'Three beat-em-ups from 1991, 1993 and 2001, plus revisions.',
            'prose': [
                'Sengoku put two players against undead armies in a feudal-Japan setting, and the third game arrived a decade later on the same hardware with a different art style from the first two.',
                'sengoku3.zip is the largest of the three and the one people ask about most; keep neogeo.zip in the batch.',
            ],
        },
    },
    {
        'slug': 'puzzle-bobble',
        'sets': ['pbobblen', 'pbobblenb', 'pbobbl2n', 'puzzledp', 'puzzldpr'],
        'ko': {
            'name': '퍼즐 보블',
            'title': '퍼즐 보블 3DS — 네오지오 롬셋 {count}종 | neo3ds',
            'desc': '퍼즐 보블, 버블 보블 어게인, 퍼즐 드 폰까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. 해적판은 변환 불가로 표기.',
            'h1': '퍼즐 보블 3DS',
            'lede': '타이토의 퍼즐 게임과 같은 기판을 쓰는 퍼즐 드 폰 — {count}종.',
            'prose': [
                '퍼즐 보블은 아케이드 원작이 나온 이듬해인 1994년 네오지오에 올라왔고, 버블 보블 어게인이 1999년에 뒤를 이었다. 퍼즐 드 폰과 R!은 같은 2인 대전 형식이다.',
                'pbobblen.zip이 부모 세트이고, pbobblenb.zip은 해적판이라 목록에서 변환 불가로 표시된다.',
            ],
        },
        'en': {
            'name': 'Puzzle Bobble',
            'title': 'Puzzle Bobble on 3DS — Neo Geo romsets | neo3ds',
            'desc': 'Puzzle Bobble, Bust-A-Move Again and Puzzle De Pon on the Neo Geo — {count} romsets with 3DS conversion status. The bootleg set is marked unsupported.',
            'h1': 'Puzzle Bobble on the 3DS',
            'lede': "Taito's bubble puzzler and the Puzzle De Pon sets Visco built on the same board — {count} romsets.",
            'prose': [
                'Puzzle Bobble reached the Neo Geo in 1994, a year after the arcade original, and Bust-A-Move Again followed in 1999. Puzzle De Pon and its R! revision use the same two-player versus format.',
                'pbobblen.zip is the parent set; pbobblenb.zip is the bootleg and is listed as unsupported.',
            ],
        },
    },
    {
        'slug': 'shock-troopers',
        'sets': ['shocktro', 'shocktroa', 'shocktr2', 'lans2004'],
        'ko': {
            'name': '쇼크 트루퍼스',
            'title': '쇼크 트루퍼스 3DS — 두 작품 롬셋 {count}종 | neo3ds',
            'desc': '쇼크 트루퍼스와 2nd Squad, 랑스케네 해적판까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. 해적판은 변환 불가로 표기됩니다.',
            'h1': '쇼크 트루퍼스 3DS',
            'lede': '사우루스의 런앤건 두 작품과 리비전·해적판 — {count}종.',
            'prose': [
                '쇼크 트루퍼스는 1997년에 스테이지마다 세 갈래 경로와 여덟 캐릭터 교체를 내걸었다. 2nd Squad는 1998년에 캐릭터 두 명 고정과 늘어난 스프라이트 수로 돌아왔다.',
                'shocktro.zip과 shocktr2.zip은 둘 다 변환된다. lans2004.zip은 1편의 해적판이라 변환 불가다.',
            ],
        },
        'en': {
            'name': 'Shock Troopers',
            'title': 'Shock Troopers on 3DS — both games | neo3ds',
            'desc': 'Shock Troopers and 2nd Squad from Saurus, plus the Lansquenet bootleg — {count} romsets with 3DS conversion status.',
            'h1': 'Shock Troopers on the 3DS',
            'lede': 'Two run-and-gun games from Saurus, {count} sets with revisions and the bootleg.',
            'prose': [
                'Shock Troopers in 1997 gave the player three routes through each stage and eight characters to switch between; 2nd Squad followed in 1998 with fixed characters and a bigger sprite count.',
                'shocktro.zip and shocktr2.zip both convert; lans2004.zip is a bootleg of the first game and is unsupported.',
            ],
        },
    },
    {
        'slug': 'super-sidekicks',
        'sets': ['ssideki', 'ssideki2', 'ssideki3', 'ssideki4'],
        'ko': {
            'name': '슈퍼 사이드킥',
            'title': '슈퍼 사이드킥 3DS — 4작품 롬셋 {count}종 | neo3ds',
            'desc': '슈퍼 사이드킥 1부터 얼티밋 11까지, 네오지오 축구 게임 롬셋 {count}종의 3DS 변환 지원 상태. 게임마다 CIA 하나로 나옵니다.',
            'h1': '슈퍼 사이드킥 3DS',
            'lede': '1992년부터 1996년까지의 축구 게임 4종 — {count}종.',
            'prose': [
                '슈퍼 사이드킥은 아케이드 축구에 대한 SNK식 답이었다. 전반이 짧고 반칙이 없으며, 카드 시스템으로 슛을 결정했다. 1996년 얼티밋 11이 시리즈의 끝이다.',
                '네 작품 모두 무보호 카트리지라 그대로 변환된다. 가장 완성형은 ssideki4.zip이다.',
            ],
        },
        'en': {
            'name': 'Super Sidekicks',
            'title': 'Super Sidekicks on 3DS — all four games | neo3ds',
            'desc': 'Super Sidekicks 1 to 4, the SNK football series on the Neo Geo — {count} romsets with 3DS conversion status.',
            'h1': 'Super Sidekicks on the 3DS',
            'lede': 'Four football games from 1992 to 1996 — {count} romsets.',
            'prose': [
                'Super Sidekicks was SNK answer to arcade football: short halves, no fouls, and a card system that decided shots. The fourth game, The Ultimate 11, closed the series in 1996.',
                'All four convert as unprotected carts. ssideki4.zip is the most complete of the set.',
            ],
        },
    },
    {
        'slug': 'king-of-the-monsters',
        'sets': ['kotm', 'kotmh', 'kotm2', 'kotm2a', 'kotm2p'],
        'ko': {
            'name': '킹 오브 더 몬스터즈',
            'title': '킹 오브 더 몬스터즈 3DS — 롬셋 {count}종 | neo3ds',
            'desc': '킹 오브 더 몬스터즈 1·2와 리비전, 프로토타입까지 네오지오 롬셋 {count}종의 3DS 변환 지원 상태. {ok}종이 CIA로 변환됩니다.',
            'h1': '킹 오브 더 몬스터즈 3DS',
            'lede': '1991년과 1992년의 괴수 프로레슬링 두 작품 — {count}종.',
            'prose': [
                '킹 오브 더 몬스터즈는 거대 괴수들을 링에 올리고 라운드 사이에 도시를 부수게 했다. 속편은 경기마다 세 번째 괴수를 붙이고 기술을 늘렸다.',
                'kotm.zip과 kotm2.zip이 부모 세트이고, kotm2p.zip은 속편의 프로토타입이라 동작이 다를 수 있다.',
            ],
        },
        'en': {
            'name': 'King of the Monsters',
            'title': 'King of the Monsters on 3DS — both games | neo3ds',
            'desc': 'King of the Monsters and its 1992 sequel, with revisions — {count} romsets, {ok} converting to installable 3DS CIAs.',
            'h1': 'King of the Monsters on the 3DS',
            'lede': 'Two kaiju wrestling games from 1991 and 1992 — {count} sets including an older revision and a prototype.',
            'prose': [
                'King of the Monsters put giant monsters in a wrestling ring and let them flatten the city between rounds. The sequel added a third monster to each match and a wider move set.',
                'kotm.zip and kotm2.zip are the parent sets; kotm2p.zip is a prototype of the sequel and may behave differently.',
            ],
        },
    },
]

/**
 * Comprehensive Knowledge Base & Entity Extractor for Nexus Brain (v3.8)
 * 100% Autonomous Local Nexus AI Engine - Zero External API dependencies.
 *
 * Covers:
 * - FC Barcelona (5 UCLs, 2 Trebles 2009 & 2015, MSN, Cruyff, Flick, Yamal, Lewandowski, Szczęsny)
 * - Real Madrid CF (15x UCL, Galácticos, European comebacks)
 * - Premier League Heavyweights (Liverpool, Man United 1999 Treble, Arsenal Invincibles, Chelsea, Man City)
 * - Legendary Stadiums & Ultras (Legia Warszawa Żyleta, Lech Poznań)
 * - Nightlife & Electronic Music Venues (Berghain Berlin, Amnesia/Hï Ibiza, Fabric London, Printworks)
 * - Enthusiastic Subjective Claims Engine
 * - Zero-Refusal Multi-Document Topic Synthesis
 */

export function extractEntityKnowledge(q = '', rawText = '', isVip = false, username = 'Homie') {
  const text = q.toLowerCase();

  // ── 0. ENTHUSIASTIC SUBJECTIVE CLAIMS ENGINE ──────────────────────────────
  const subjectivePraiseMatch = text.match(/(?:this\s+is\s+(?:the\s+)?(?:best|greatest|most\s+insane|most\s+goated|peak)|(?:so|so\s+fucking|crazy)\s+good|is\s+the\s+best\s+(?:club|team|player|stadium|venue|artist|dj|thing)\s+ever|is\s+peak|unmatched)/i);
  if (subjectivePraiseMatch) {
    const praiseAnswer = synthesizeSubjectivePraise(text, rawText, isVip, username);
    if (praiseAnswer) return praiseAnswer;
  }

  // ── 1. FC BARCELONA (Comprehensive Lore, Trophies & Modern Squad) ───────────
  if (text.includes('barca') || text.includes('barça') || text.includes('barcelona') || text.includes('fc barcelona') || text.includes('blaugrana') || text.includes('culers') || text.includes('cule')) {
    // Specific sub-topics or general club breakdown
    if (text.includes('treble') || text.includes('2009') || text.includes('2015') || text.includes('sextuple')) {
      return isVip
        ? `Hell fucking yeah ${username}! FC Barcelona is the ONLY club in European football history to win the Continental Treble TWICE (2009 & 2015), no fucking bullshit!\n\n` +
          `• **2009 Pep Guardiola Sextuple**: La Liga, Copa del Rey, Champions League (2-0 vs Manchester United in Rome), Supercopa, UEFA Super Cup, and FIFA Club World Cup! Pure football art driven by prime Messi, Xavi, Iniesta, Henry, Eto'o, and Puyol.\n` +
          `• **2015 Luis Enrique Treble**: The terrifying MSN trident (Messi, Suárez, Neymar) combining for 122 goals, culminating in the 3-1 UCL Final masterclass against Juventus in Berlin!\n\n` +
          `Pure unmatched dominance, my badass homie! What other Barça historic moments you want to relive?`
        : `FC Barcelona made history by claiming TWO historic European Trebles, bro, no fucking bullshit!\n\n` +
          `1. **2008-09 (Pep Guardiola)**: The legendary Sextuple where Barça won all 6 trophies in a single calendar year with Tiki-Taka precision.\n` +
          `2. **2014-15 (Luis Enrique)**: The MSN era blitzing through Europe, beating Manchester City, PSG, Bayern Munich, and Juventus on their way to the crown!\n\n` +
          `Unbelievable football pedigree and standard for the sport!`;
    }

    if (text.includes('msn') || text.includes('neymar') || text.includes('suarez') || text.includes('suárez')) {
      return `The MSN trident (Lionel Messi, Luis Suárez, Neymar Jr) was the most lethal, unplayable attacking trio in the history of football, no fucking bullshit!\n\n` +
        `• **122 Goals in 2014-15**: Blown away defenders with telepathic chemistry, selfless assists, and insane skill.\n` +
        `• **131 Goals in 2015-16**: Shattered their own scoring record while conquering Spain and Europe.\n` +
        `• **La Remontada (6-1 vs PSG)**: Neymar's 7-minute masterclass orchestrating the greatest comeback in Champions League history!\n\n` +
        `Watching those three ball out together was straight-up cheat code football on grass!`;
    }

    if (text.includes('flick') || text.includes('hansi flick') || text.includes('pedri') || text.includes('gavi') || text.includes('cubarsi') || text.includes('cubarsí') || text.includes('szczesny') || text.includes('szczęsny')) {
      return isVip
        ? `Yo ${username}, Hansi Flick's new-look FC Barcelona is an absolute high-pressing, goal-scoring juggernaut, no fucking bullshit!\n\n` +
          `• **The Offside Trap & High Line**: Suffocating opponents with elite tactical discipline, catching world-class forwards offside dozens of times per game!\n` +
          `• **La Masia Superstars**: Pau Cubarsí pinging 60-yard pinpoint passes at center-back, Pedri controlling the tempo like Iniesta, and Gavi bringing relentless warrior energy.\n` +
          `• **Veterans & Polish Connection**: Robert Lewandowski banging in goals with ice in his veins, joined by Wojciech Szczęsny between the sticks!\n` +
          `• **Lamine Yamal**: 17-year-old generational genius bending reality on the right wing.\n\n` +
          `Barça is playing high-octane, electric football that terrifies Europe, king!`
        : `FC Barcelona under Hansi Flick is a modern pressing masterpiece, bro!\n\n` +
          `Combining veteran leadership (Lewandowski, Szczęsny, Raphinha) with generational La Masia academy talent (Lamine Yamal, Pedri, Gavi, Pau Cubarsí). The aggressive high-line defense and fluid attacking transitions have Barça back at the pinnacle of European football!`;
    }

    return isVip
      ? `Yo ${username}! **FC Barcelona (Més que un club)** is a global sporting monument with one of the richest legacies on earth, no fucking bullshit:\n\n` +
        `• **5 UEFA Champions League Trophies**: 1992 (Koeman's Wembley rocket), 2006 (Paris comeback), 2009 (Rome masterclass), 2011 (Wembley perfection vs Man United), and 2015 (Berlin Treble).\n` +
        `• **2 Historic European Trebles**: 2009 & 2015, alongside the historic 2009 Sextuple!\n` +
        `• **Cruyff & Tiki-Taka**: The revolutionary positional play philosophy conceptualized by Johan Cruyff, perfected by Pep Guardiola.\n` +
        `• **The Lionel Messi Era**: 672 goals, 35 trophies, and 17 years of pure football divinity.\n` +
        `• **Modern Era & La Masia**: Hansi Flick leading Lamine Yamal, Gavi, Pedri, Pau Cubarsí, Robert Lewandowski, and Wojciech Szczęsny into a new golden chapter!\n\n` +
        `Camp Nou lore is eternal, my badass brother!`
      : `FC Barcelona is one of the most storied institutions in football history, no goddamn bullshit!\n\n` +
        `• **Trophies**: 5 Champions Leagues, 27 La Liga titles, 31 Copas del Rey, and 2 European Trebles.\n` +
        `• **Philosophy**: Founded upon Johan Cruyff's Total Football and refined into Tiki-Taka at La Masia.\n` +
        `• **Icons**: Johan Cruyff, Diego Maradona, Ronaldinho, Lionel Messi, Xavi, Iniesta, Puyol, Busquets, and now Lamine Yamal.\n` +
        `Pure football culture and excellence!`;
  }

  // ── 2. REAL MADRID CF (15x UCL Heritage & Galácticos) ─────────────────────
  if (text.includes('real madrid') || text.includes('madrid') || text.includes('los blancos') || text.includes('merengues') || text.includes('galactico') || text.includes('galáctico')) {
    return isVip
      ? `Yo ${username}! **Real Madrid CF** is the undisputed royal king of European football, no fucking bullshit!\n\n` +
        `• **15 UEFA Champions League Titles**: From Di Stéfano's 5-in-a-row (1956–1960), La Novena with Zidane's iconic 2002 Glasgow volley, La Décima in 2014, the historic 3-peat under Zidane (2016, 2017, 2018), to the 2022 and 2024 triumphs!\n` +
        `• **Galáctico Lore**: Florentino Pérez assembling Zidane, Ronaldo Nazário, Luís Figo, David Beckham, Roberto Carlos, and later Cristiano Ronaldo, Kaká, and Karim Benzema.\n` +
        `• **Santiago Bernabéu Magic**: Famous for legendary European comebacks where 90 minutes at the Bernabéu feels like an eternity for opponents!\n\n` +
        `A relentless winning machine built on pure pedigree and clutch DNA, king!`
      : `Real Madrid CF stands as the most decorated club in European history, no goddamn bullshit!\n\n` +
        `• **15 Champions Leagues**: Far ahead of any club on the continent.\n` +
        `• **Iconic Stars**: Alfredo Di Stéfano, Ferenc Puskás, Raúl, Zinedine Zidane, Cristiano Ronaldo, Luka Modrić, and Vinícius Jr.\n` +
        `• **Champions League Mystique**: Renowned for unmatched resilience, late-game heroics, and championship culture!`;
  }

  // ── 3. PREMIER LEAGUE HEAVYWEIGHTS ────────────────────────────────────────
  // Liverpool
  if (text.includes('liverpool') || text.includes('lfc') || text.includes('anfield') || text.includes('klopp') || text.includes('ynwa')) {
    return `**Liverpool Football Club** is a fortress of English and European football passion, no fucking bullshit!\n\n` +
      `• **6 European Cups / Champions Leagues**: The most of any English club, from Shankly and Paisley's dynasties to the Miracle of Istanbul in 2005 (coming back from 0-3 against AC Milan) and Klopp's 2019 Madrid triumph.\n` +
      `• **Anfield & "You'll Never Walk Alone"**: One of the most electrifying stadium atmospheres in world sports, where European nights break the hearts of visiting giants.\n` +
      `• **Heavy Metal Football**: Jürgen Klopp's relentless Gegenpressing machine winning the Premier League and conquering Europe with Salah, Mané, Firmino, and Van Dijk!`;
  }

  // Manchester United
  if (text.includes('manchester united') || text.includes('man utd') || text.includes('man u') || text.includes('old trafford') || text.includes('ferguson') || text.includes('fergie')) {
    return `**Manchester United** is an iconic global giant defined by the Sir Alex Ferguson dynasty, no fucking bullshit!\n\n` +
      `• **1999 Historic Treble**: Premier League, FA Cup, and Champions League won in dramatic fashion with Sheringham and Solskjær scoring in injury time against Bayern Munich at Camp Nou!\n` +
      `• **Class of '92**: David Beckham, Ryan Giggs, Paul Scholes, Gary Neville, Phil Neville, and Nicky Butt rising from the academy to dominate world football.\n` +
      `• **Theatre of Dreams**: 20 English League Titles, 3 European Cups (1968 under Matt Busby, 1999, 2008 with CR7 & Rooney), and legendary heritage!`;
  }

  // Arsenal
  if (text.includes('arsenal') || text.includes('gunners') || text.includes('invincibles') || text.includes('wenger') || text.includes('arteta')) {
    return `**Arsenal Football Club** is synonymous with pure class, style, and historic records, no fucking bullshit!\n\n` +
      `• **The 2003-04 Invincibles**: Played 38 Premier League games, won 26, drew 12, and lost ZERO (0)! The only golden Premier League trophy in history under Arsène Wenger!\n` +
      `• **Highbury Elegance & Legends**: Thierry Henry gliding past entire defenses, Dennis Bergkamp's godlike first touch, and Patrick Vieira bossing the midfield.\n` +
      `• **Modern Gunners**: Mikel Arteta restoring title-contending intensity with Saka, Ødegaard, and Saliba!`;
  }

  // Chelsea
  if (text.includes('chelsea') || text.includes('stamford bridge') || text.includes('mourinho') || text.includes('drogba')) {
    return `**Chelsea Football Club** is a modern European heavyweight built on ruthless defensive masterclasses and clutch trophies, no fucking bullshit!\n\n` +
      `• **2x UEFA Champions League Champions**: 2012 in Munich (Didier Drogba's bullet header and winning penalty) and 2021 in Porto (1-0 vs Manchester City under Tuchel).\n` +
      `• **Jose Mourinho 2004-05 Record**: Conceded only 15 goals in a 38-game Premier League season with Petr Čech and John Terry—a record that will never be broken!\n` +
      `• **Legends**: Frank Lampard (highest-scoring midfielder in history with 211 Chelsea goals), Didier Drogba, Eden Hazard, and N'Golo Kanté!`;
  }

  // Manchester City
  if (text.includes('manchester city') || text.includes('man city') || text.includes('guardiola') || text.includes('etihad') || text.includes('haaland')) {
    return `**Manchester City** under Pep Guardiola has evolved into a hyper-efficient, record-shattering football machine, no fucking bullshit!\n\n` +
      `• **2022-23 Continental Treble**: Winning the Premier League, FA Cup, and Champions League in Istanbul with Rodri's banger.\n` +
      `• **Centurions (100 Points)**: The first and only team to hit 100 points in a Premier League season (2017-18).\n` +
      `• **Key Ballers**: Kevin De Bruyne's laser passing, Erling Haaland's 50+ goal seasons, and 4 consecutive Premier League titles!`;
  }

  // ── 4. LEGENDARY STADIUMS & ULTRAS ────────────────────────────────────────
  // Legia Warszawa
  if (text.includes('legia') || text.includes('zyleta') || text.includes('żyleta') || text.includes('warszawa') || text.includes('warsaw')) {
    return isVip
      ? `Hell fucking yeah ${username}! **Legia Warszawa and the legendary Żyleta (The Razor)** is one of the most intense, electrifying ultra tribunes on the entire planet, no fucking bullshit!\n\n` +
        `• **Żyleta Tribune**: Famous worldwide for earth-shaking 90-minute synchronous chanting, monstrous pyro displays, and world-class card stunts/banners that make international headlines!\n` +
        `• **Polish Football Heart**: Based at Stadion Wojska Polskiego in Warsaw, Legia has 15 Polish Ekstraklasa titles and 20 Polish Cups.\n` +
        `• **Uncompromising Passion**: When Żyleta lights up with flares and drums, the decibel level shakes the entire stadium foundation! Pure European ultra culture at its peak, king!`
      : `Legia Warszawa and the famous **Żyleta** terrace represent the pinnacle of European ultra passion, bro, no fucking bullshit!\n\n` +
        `Renowned across the world for massive tifos, coordinated flare displays, and relentless 90-minute vocal support at the Polish Army Stadium in Warsaw. The atmosphere is intense, raw, and unmatched!`;
  }

  // Lech Poznań
  if (text.includes('lech poznan') || text.includes('lech poznań') || text.includes('kociol') || text.includes('kocioł') || text.includes('poznan bounce') || text.includes('the poznan')) {
    return `**Lech Poznań and the famous "Poznań Bounce"** is a worldwide cultural phenomenon in football stadiums, no fucking bullshit!\n\n` +
      `• **"The Poznań" / "Let's All Do The Poznan"**: Fans link arms with their backs turned to the pitch, jumping rhythmically in unison! Manchester City, Celtic, and clubs across Europe adopted it directly from Lech Poznań ultras.\n` +
      `• **Kocioł (The Cauldron)**: The passionate home terrace at Enea Stadion creating a boiling sea of blue and white chants and pyro choreography.\n` +
      `• **History**: 8 Polish Ekstraklasa championships and the club that developed Robert Lewandowski before his move to Borussia Dortmund!`;
  }

  // ── 5. NIGHTLIFE & ELECTRONIC MUSIC VENUES ────────────────────────────────
  // Berghain
  if (text.includes('berghain') || text.includes('panorama bar') || text.includes('sven marquardt') || text.includes('berlin techno')) {
    return isVip
      ? `Yo ${username}! **Berghain (Berlin)** is the undisputed holy temple of underground industrial techno and club culture, no fucking bullshit!\n\n` +
        `• **The Former Power Plant**: Located in a monolithic concrete former power station in Friedrichshain, featuring 18-meter-high ceilings and world-class acoustics.\n` +
        `• **Legendary Door Policy**: Head bouncer Sven Marquardt running the most infamous, mysterious door in nightlife history.\n` +
        `• **Klubnacht Marathons**: Parties starting Saturday midnight and running straight through to Monday afternoon across Berghain and Panorama Bar with strict NO-PHOTO policies, Funktion-One sound systems, and total sensory immersion!\n\n` +
        `Pure raw electronic music culture, my badass brother!`
      : `Berghain in Berlin is universally regarded as the world's most legendary techno club, bro!\n\n` +
        `Housed in an austere Soviet-era industrial power plant, it is famous for its strict door policy, no-photo policy, and non-stop marathon weekend sets from the world's top techno and house DJs. A true cultural institution!`;
  }

  // Amnesia & Hï Ibiza
  if (text.includes('amnesia') || text.includes('hi ibiza') || text.includes('hï ibiza') || text.includes('ibiza') || text.includes('balearic')) {
    return `**Ibiza's Clubbing Titans (Amnesia & Hï Ibiza)** are the epicenter of global electronic dance music, no fucking bullshit!\n\n` +
      `• **Amnesia**: Open since 1976, famous for the Terrace sunrise sessions with natural light flooding the glass roof, massive CO2 ice cannons, and iconic residency parties like Elrow, Paradise, and Pyramid!\n` +
      `• **Hï Ibiza**: Voted #1 Club in the World multiple years in a row by DJ Mag, featuring cutting-edge kinetic ceiling production, The Theatre, and The Club Room hosting Black Coffee, David Guetta, and Tale of Us!\n` +
      `• **Balearic Magic**: The global summer pilgrimage for house, techno, and melodic dance enthusiasts worldwide.`;
  }

  // Fabric London
  if (text.includes('fabric') || text.includes('fabric london') || text.includes('farringdon')) {
    return `**Fabric (London)** is an iconic cornerstone of UK underground electronic music culture located in Farringdon, no fucking bullshit!\n\n` +
      `• **Room 1 Bodysonic Dancefloor**: Features vibrating transducers built under the floorboards so you feel the sub-bass directly in your bones and muscles!\n` +
      `• **Underground Heritage**: Pioneered drum & bass, jungle, UK garage, grime, dubstep, and minimal techno since 1999 with the legendary FabricLive series.\n` +
      `• **Uncompromising Audio**: Triple-room brick vault labyrinth dedicated purely to high-fidelity sound!`;
  }

  // Printworks London
  if (text.includes('printworks') || text.includes('printworks london') || text.includes('press halls')) {
    return `**Printworks London** was a monumental industrial cathedral for electronic music and visual art, no fucking bullshit!\n\n` +
      `• **The Press Halls**: Set inside Europe's largest former newspaper printing facility (printing the Daily Mail and Evening Standard), featuring a narrow, massive 16-meter high industrial corridor.\n` +
      `• **World-Class Lighting**: Sound and laser arrays extending across the ceiling, delivering a dystopian, cinematic rave experience that redefined electronic live production!\n` +
      `• **Iconic Residencies**: Hosted Afterlife, Defected, Drumcode, and legendary closing parties that went down in UK clubbing history!`;
  }

  // ── 6. PLAYERS & ATHLETES ──────────────────────────────────────────────────
  // Lewandowski
  if (text.includes('lewandowski') || text.includes('robert lewandowski') || text.includes('lewa')) {
    if (text.includes('birthday') || text.includes('anniversaire') || text.includes('age') || text.includes('old') || text.includes('born')) {
      return isVip
        ? `Hell fucking yeah ${username}! Happy birthday to Robert Lewandowski, the Polish goal machine and absolute legend born on August 21, 1988!\n\n` +
          `This beast has scored over 600 career goals, completely shattered Gerd Müller's "unbreakable" 40-goal Bundesliga season record by banging in 41 goals in 29 games for Bayern Munich, and dropped 5 goals in 9 minutes coming off the bench! That shit was wild as fuck!\n\n` +
          `Now he's holding down the attack for FC Barcelona, still scoring bangers in his late 30s like a savage. What an absolute baller, no fucking bullshit!`
        : `Happy birthday to Robert Lewandowski, bro! The Polish striker was born on August 21, 1988, and he is one of the deadliest #9s to ever walk the earth, no fucking bullshit!\n\n` +
          `Dude dominated Borussia Dortmund under Klopp, won the Champions League with Bayern Munich while scoring 55 goals in a single season, and now bangs in goals for FC Barcelona! 5 goals in 9 minutes is still the craziest shit ever seen on a football pitch. Certified legend!`;
    }
    return isVip
      ? `Yo ${username}, Robert Lewandowski is an absolute goal-scoring beast and a certified lethal weapon in the penalty box, no fucking bullshit!\n\n` +
        `We're talking about a man who scored 5 goals in 9 goddamn minutes for Bayern Munich, won the Champions League Sextuple, and stacked up over 600 career goals! Bro was robbed of the 2020 Ballon d'Or because France Football panicked, which was pure clown bullshit!\n\n` +
        `Whether at Dortmund, Bayern, or Barcelona, the man is pure killer instinct on the pitch, king!`
      : `Lewandowski is one of the top 3 purest #9 strikers in modern football history, no goddamn bullshit!\n\n` +
        `Over 600 official goals, Champions League winner, multiple Golden Boots, and the historic 41-goal Bundesliga season record! The guy's positioning, volley technique, and penalty ice-veins are ridiculous as hell. Pure football greatness!`;
  }

  // Messi
  if (text.includes('messi') || text.includes('lionel messi') || text.includes('la pulga')) {
    return isVip
      ? `Yo ${username}, Leo Messi is the undisputed football GOAT and a complete god with the ball at his feet, no fucking bullshit!\n\n` +
        `8 Ballon d'Or trophies, 4 Champions Leagues, 10 La Liga titles, 2 Copa Americas, and the legendary 2022 FIFA World Cup victory in Qatar where he carried Argentina on his back with 7 goals and 3 assists! Watching his vision, dribbling between 4 defenders like they're training cones, and curling free-kicks into the top corner is pure magic!\n\n` +
        `Nobody in the history of this sport has ever combined playmaking, goalscoring, and clutch dominance like this man, king!`
      : `Lionel Messi is the greatest player to ever kick a football, bro, no fucking bullshit!\n\n` +
        `8 Ballon d'Ors, 91 goals in a single calendar year (2012), 4 Champions League titles with Barcelona, and crowned World Cup Champion with Argentina! He literally completed football like a video game on cheat mode. Pure perfection on grass!`;
  }

  // Ronaldo / CR7
  if (text.includes('ronaldo') || text.includes('cr7') || text.includes('cristiano')) {
    if (!text.includes('nazario') && !text.includes('r9')) {
      return isVip
        ? `Yo ${username}, Cristiano Ronaldo (CR7) is pure unmatched machine work ethic and athletic dominance, no fucking bullshit!\n\n` +
          `Over 900 official career goals, 5 Champions League trophies, 5 Ballon d'Ors, Euro 2016 champion with Portugal, and the undisputed Mr. Champions League with 140 UCL goals! Bro transformed himself from a skinny trickster winger at Sporting and Manchester United into the most lethal aerial and clutch goal-scoring monster in history at Real Madrid!\n\n` +
          `SIUUU all day long, my badass homie!`
        : `CR7 is an absolute athletic freak and the ultimate goal machine, bro, no fucking bullshit!\n\n` +
          `5 Ballon d'Ors, 5 Champions Leagues, over 900 official goals, and clutch as hell when the game is on the line. The man's dedication to fitness and relentless hunger to win is insane as fuck!`;
    }
  }

  // Lamine Yamal
  if (text.includes('lamine yamal') || text.includes('yamal')) {
    return `Lamine Yamal is a once-in-a-generation wonderkid, no fucking bullshit!\n\n` +
      `Euro 2024 champion at 17 years old with Spain, winning Young Player of the Tournament, scoring that insane curling banger against France, and cooking defenders for FC Barcelona! The kid's decision making, pause (la pausa), and maturity with the ball at 17 is mind-blowing as hell!`;
  }

  // ── 7. BASKETBALL / NBA ───────────────────────────────────────────────────
  if (text.includes('lebron') || text.includes('lebron james') || text.includes('king james')) {
    return isVip
      ? `Yo ${username}, LeBron James is an absolute biological freak of nature, no fucking bullshit!\n\n` +
        `NBA all-time leading scorer with over 40,000 points, 4x NBA Champion, 4x Finals MVP, 4x regular season MVP, and still throwing down tomahawk poster dunks in year 22 like a savage! The longevity is unprecedented in sports history. Going to 8 consecutive Finals is straight-up video game stuff, king!`
      : `LeBron James is one of the greatest athletes to ever grace the planet, bro, no fucking bullshit!\n\n` +
        `40,000+ career points, 4 rings with 3 different franchises (Heat, Cavs, Lakers), and dominating the league for over two decades! The 2016 3-1 comeback against the 73-9 Warriors was legendary as hell.`;
  }
  if (text.includes('jordan') || text.includes('michael jordan') || text.includes('mj')) {
    return `Michael Jordan: 6 Finals appearances, 6 NBA Championships, 6 Finals MVPs, and NEVER let a Finals series go to Game 7, no fucking bullshit!\n\n` +
      `The 90s Chicago Bulls dynasty, the iconic flu game, the game-winner over Byron Russell, and the most ruthlessly competitive mindset ever witnessed. The global icon who made basketball what it is today!`;
  }
  if (text.includes('curry') || text.includes('steph curry')) {
    return `Steph Curry literally broke and revolutionized the entire game of basketball forever, no fucking bullshit!\n\n` +
      `The undisputed greatest shooter in human history, 4 NBA Championships, 2 MVPs (including the only unanimous MVP in history), and hitting contested 35-foot pull-up jumpers with a hand in his face like it's a layup! Night night!`;
  }
  if (text.includes('kobe') || text.includes('kobe bryant') || text.includes('mamba')) {
    return `Rest in peace to the legend Kobe Bryant! 5x NBA Champion with the Los Angeles Lakers, 81-point game against Toronto, 2x Finals MVP, and the creator of the Mamba Mentality, no fucking bullshit! His relentless work ethic and assassin focus inspired an entire generation of hoopers worldwide.`;
  }

  // ── 8. GAMING & TECH ──────────────────────────────────────────────────────
  if (text.includes('gta 6') || text.includes('gta vi') || text.includes('grand theft auto')) {
    return `GTA 6 is gonna completely shatter and break the entire goddamn internet when Rockstar Games drops it, no fucking bullshit!\n\n` +
      `Heading back to Vice City (Leonida) with Lucia and Jason, photorealistic graphics, crazy physics, and the most detailed open-world crime sandbox ever engineered! The first trailer already racked up over 200 million views. We are waiting on history!`;
  }
  if (text.includes('minecraft')) {
    return `Minecraft is the best-selling video game in the history of mankind with over 300 million copies sold, no fucking bullshit!\n\n` +
      `From punching trees on your first night to mining netherite and building massive automated redstone contraptions, it's pure sandbox perfection that transcends generations.`;
  }

  // ── 9. MUSIC & RAP ────────────────────────────────────────────────────────
  if (text.includes('drake') || text.includes('kendrick') || text.includes('kdot')) {
    if (text.includes('beef') || text.includes('not like us') || text.includes('euphoria') || text.includes('meet the grahams')) {
      return `The Kendrick Lamar vs Drake rap beef of 2024 was the most seismic, earth-shaking hip-hop battle in modern music history, no fucking bullshit!\n\n` +
        `Kendrick dropped "Euphoria", "6:16 in LA", the horrifying psychological diss "Meet the Grahams", and capped it with the historic worldwide stadium banger "Not Like Us"! Drake fired back with "Push Ups" and "Family Matters", but Kendrick's West Coast anthem dominated radio and festivals globally! Pure lyrical warfare!`;
    }
  }

  // ── 10. DATES & CALENDAR / BIRTHDAYS ───────────────────────────────────────
  if (text.includes('birthday') || text.includes('anniversaire') || text.includes('fête')) {
    const nameMatch = rawText.match(/(?:(?:is|c'est)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)(?:'s|\s+de)?\s*(?:birthday|anniversaire)/i)
      || rawText.match(/(?:happy\s+birthday|bon\s+anniversaire)\s+(?:to\s+|à\s+)?([A-Za-z0-9_]+(?:\s+[A-Za-z0-9_]+)*)/i);
    const targetName = nameMatch ? nameMatch[1] : 'them';

    if (isVip) {
      return `Hell fucking yeah ${username}! Huge happy birthday shoutout to **${targetName}**! Wishing them an absolute badass year full of massive success, crazy wins, good health, and zero bullshit! Let's celebrate this legend in the server today, king!`;
    }
    return `Big happy birthday shoutout to **${targetName}**, bro! May their year be filled with huge achievements, good vibes, and zero fake bullshit! Celebrate big today!`;
  }

  // ── 11. PHYSICS, ASTRONOMY & RELATIVITY ────────────────────────────────────
  if (text.includes('quantum') || text.includes('schrodinger') || text.includes('schrödinger') || text.includes('relativity') || text.includes('black hole') || text.includes('speed of light') || text.includes('gravity')) {
    if (text.includes('schrodinger') || text.includes('schrödinger') || text.includes('quantum superposition') || text.includes('quantum entanglement')) {
      return `Quantum mechanics is mind-bending as fuck, no bullshit!\n\n` +
        `• **Quantum Superposition**: A subatomic particle exists in all possible states simultaneously until measured, collapsing the wave function $\\psi$!\n` +
        `• **Schrödinger's Cat**: Erwin Schrödinger's famous thought experiment highlighting the paradox of Copenhagen interpretation—a cat in a sealed box with radioactive decay remains both alive and dead until opened!\n` +
        `• **Quantum Entanglement**: What Einstein called "spooky action at a distance"—two entangled particles remain instantaneously correlated across galaxies!`;
    }
    if (text.includes('relativity') || text.includes('einstein') || text.includes('e=mc^2') || text.includes('e = mc^2') || text.includes('e=mc2')) {
      return `Albert Einstein's **General & Special Relativity** changed how we understand the fabric of the universe forever, no fucking bullshit!\n\n` +
        `• **Special Relativity (1905)**: The speed of light ($c \\approx 299,792,458\\text{ m/s}$) is constant for all observers. As velocity approaches $c$, time dilates and mass increases ($E = mc^2$)!\n` +
        `• **General Relativity (1915)**: Gravity is NOT a pulling force—it is the geometric warping and curvature of four-dimensional spacetime caused by mass and energy!`;
    }
    if (text.includes('black hole') || text.includes('event horizon') || text.includes('singularity')) {
      return `**Black Holes** are the most extreme gravitational monsters in the cosmos, no fucking bullshit!\n\n` +
        `• **Event Horizon**: The point of no return where the escape velocity exceeds the speed of light—once past it, nothing can escape.\n` +
        `• **Singularity**: The gravitational center where spacetime curvature and density become infinite, breaking conventional physics!\n` +
        `• **Hawking Radiation**: Stephen Hawking proved black holes slowly emit quantum thermal radiation over trillions of years until they evaporate!`;
    }
    return `Physics explains the fundamental mechanics of everything in reality, no fucking bullshit!\n\n` +
      `• **Newton's Laws of Motion**: $F = ma$, inertia, and equal opposite reactions governing everyday kinetic reality.\n` +
      `• **Thermodynamics**: Energy cannot be created or destroyed (First Law), and the entropy of an isolated system always increases (Second Law)!\n` +
      `• **Fundamental Forces**: Gravity, Electromagnetism, Strong Nuclear Force, and Weak Nuclear Force!`;
  }

  // ── 12. BIOLOGY, DNA & PHOTOSYNTHESIS ──────────────────────────────────────
  if (text.includes('photosynthesis') || text.includes('dna') || text.includes('mitochondria') || text.includes('evolution') || text.includes('crispr') || text.includes('cell')) {
    if (text.includes('photosynthesis')) {
      return `**Photosynthesis** is the biological powerhouse that fuels life on Earth, no fucking bullshit!\n\n` +
        `• **Chemical Equation**: $6\\text{CO}_2 + 6\\text{H}_2\\text{O} + \\text{photons} \\implies \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2$\n` +
        `• **Light Reactions**: Chlorophyll inside chloroplasts absorbs solar photons, splitting water molecules and generating ATP and NADPH.\n` +
        `• **Calvin Cycle (Dark Reactions)**: Fixes inorganic carbon dioxide into energy-rich glucose sugar, releasing oxygen for all of us to breathe!`;
    }
    if (text.includes('dna') || text.includes('genetics') || text.includes('rna') || text.includes('crispr')) {
      return `**DNA (Deoxyribonucleic Acid)** is the four-letter chemical source code of biological existence, no fucking bullshit!\n\n` +
        `• **Double Helix Structure**: Discovered by Watson, Crick, and Franklin, consisting of sugar-phosphate backbones and 4 nitrogenous bases: Adenine (A) pairs with Thymine (T), Guanine (G) pairs with Cytosine (C)!\n` +
        `• **Transcription & Translation**: DNA transcribed to mRNA $\\implies$ translated by ribosomes into complex proteins.\n` +
        `• **CRISPR-Cas9**: Bacterial immune mechanism adapted for precise genomic editing with molecular precision!`;
    }
    return `Biology is the intricate science of organic life, cellular machinery, and evolutionary adaptation across billions of years, no fucking bullshit!`;
  }

  // ── 13. COMPUTING, NETWORKING & LINUX ─────────────────────────────────────
  if (text.includes('tcp/ip') || text.includes('how does the internet work') || text.includes('linux kernel') || text.includes('dns') || text.includes('how does dns work') || text.includes('websocket')) {
    if (text.includes('dns')) {
      return `**DNS (Domain Name System)** is the phonebook of the entire internet, no fucking bullshit!\n\n` +
        `1. **Browser Request**: You enter \`discord.com\` $\\implies$ browser checks local cache.\n` +
        `2. **Recursive Resolver**: Queries Root Servers ($\`.$\`), then TLD Nameservers ($\`.com$\`), then Authoritative Nameservers.\n` +
        `3. **A/AAAA Record**: Returns the IP address (e.g. \`162.159.130.233\`) back to your machine in under 20 milliseconds!\n` +
        `4. **TCP Handshake**: Your browser establishes a TLS connection to the IP and pulls web content!`;
    }
    return `Modern computer networks run on the **TCP/IP stack** (Application, Transport, Network, Link), no fucking bullshit!\n\n` +
      `• **TCP**: Connection-oriented protocol with 3-way handshakes (SYN, SYN-ACK, ACK) and reliable packet ordering.\n` +
      `• **UDP**: Low-latency, connectionless protocol perfect for real-time Discord voice audio and online gaming.\n` +
      `• **Linux OS**: Powers over 90% of global cloud servers, supercomputers, and backend microservices!`;
  }

  return null;
}

/**
 * Enthusiastic Subjective Claims Synthesizer
 * Intercepts praise statements and returns high-energy breakdowns
 */
function synthesizeSubjectivePraise(text, rawText, isVip, username) {
  if (isVip) {
    return `Fuck yes ${username}! That claim is 1000% pure facts and unmatched greatness, no goddamn bullshit!\n\n` +
      `When something is built with that level of perfection, passion, and raw dominance, it completely obliterates the competition! You already know quality when you see it, my legendary brother. What else is on that top-tier level?`;
  }
  return `Hell yeah, bro! That is certified peak excellence, no fucking bullshit!\n\n` +
    `When you look at the track record, the energy, and the impact, it speaks for itself. Only legends know real greatness when they see it!`;
}

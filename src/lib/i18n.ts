/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SupportedLanguage = 'en' | 'ta' | 'hi';

export interface Translations {
  appName: string;
  tagline: string;
  joinGame: string;
  hostGame: string;
  enterPin: string;
  pinPlaceholder: string;
  nickname: string;
  nicknamePlaceholder: string;
  selectAvatar: string;
  readyToPlay: string;
  lockItIn: string;
  niceOne: string;
  oopsMissed: string;
  points: string;
  streak: string;
  rank: string;
  leaderboard: string;
  nextQuestion: string;
  revealAnswer: string;
  skipQuestion: string;
  pauseGame: string;
  resumeGame: string;
  endGame: string;
  playersJoined: string;
  waitingForHost: string;
  gameOver: string;
  podium: string;
  downloadCertificate: string;
  shareResult: string;
  quizBuilder: string;
  aiGenerator: string;
  analytics: string;
  competitions: string;
  emailOutbox: string;
  soloPractice: string;
  navJoin: string;
  navBuilder: string;
  navAI: string;
  navCompetitions: string;
  navAnalytics: string;
  navOutbox: string;
  navPractice: string;
  accommodations: string;
  extraTime: string;
  dyslexiaFont: string;
  largeText: string;
  readAloud: string;
  powerUps: string;
  powerUp5050: string;
  powerUp2x: string;
  powerUpFreeze: string;
  demoModeNotice: string;
  simulatePlayers: string;
  verifyIntegrity: string;
  integrityPass: string;
  integrityFail: string;
}

export const translations: Record<SupportedLanguage, Translations> = {
  en: {
    appName: 'QuizArena',
    tagline: 'Real-Time Multiplayer Quizzes & Competitions',
    joinGame: 'Join Arena',
    hostGame: 'Host Quiz',
    enterPin: 'Game PIN',
    pinPlaceholder: '6-digit PIN',
    nickname: 'Your Nickname',
    nicknamePlaceholder: 'Choose a brave handle...',
    selectAvatar: 'Pick Your Sticker Avatar',
    readyToPlay: "I'm Ready!",
    lockItIn: 'Lock it in!',
    niceOne: 'Nice one! Spot on!',
    oopsMissed: 'Bummer! Keep your head up!',
    points: 'Points',
    streak: 'Streak',
    rank: 'Rank',
    leaderboard: 'Leaderboard',
    nextQuestion: 'Next Question',
    revealAnswer: 'Reveal Answer',
    skipQuestion: 'Skip',
    pauseGame: 'Pause',
    resumeGame: 'Resume',
    endGame: 'End Game',
    playersJoined: 'Players in the Arena',
    waitingForHost: 'Get ready! Host will launch soon...',
    gameOver: 'Game Over!',
    podium: 'Victory Podium',
    downloadCertificate: 'Download Certificate (PDF)',
    shareResult: 'Share Result Card',
    quizBuilder: 'Quiz Studio',
    aiGenerator: 'AI Generator (PDF/Text)',
    analytics: 'Analytics & COs',
    competitions: 'Tournaments',
    emailOutbox: 'Email Outbox',
    soloPractice: 'Solo Practice',
    navJoin: 'Arena',
    navBuilder: 'Studio',
    navAI: 'AI Quiz',
    navCompetitions: 'Tournaments',
    navAnalytics: 'Analytics',
    navOutbox: 'Outbox',
    navPractice: 'Solo',
    accommodations: 'Accessibility & Accommodations',
    extraTime: 'Extra Time',
    dyslexiaFont: 'Dyslexia-friendly Font',
    largeText: 'Large Text Size',
    readAloud: 'Read Questions Aloud',
    powerUps: 'Power-Ups',
    powerUp5050: '50/50 (Cut 2 Wrong)',
    powerUp2x: 'Double Points (2x)',
    powerUpFreeze: 'Freeze Timer (+5s)',
    demoModeNotice: 'Demo Mode: Running offline / BroadcastChannel sync.',
    simulatePlayers: 'Simulate Players (Dev Tool)',
    verifyIntegrity: 'Verify Audit Integrity',
    integrityPass: 'Chain Verified: Cryptographically Sound',
    integrityFail: 'Tamper Detected in Hash Chain',
  },
  ta: {
    appName: 'QuizArena',
    tagline: 'நிகழ்நேர வினாடி வினா & போட்டிகள்',
    joinGame: 'களத்தில் இணை',
    hostGame: 'வினாடி வினா தொடங்கு',
    enterPin: 'ஆட்ட PIN எண்',
    pinPlaceholder: '6-இலக்க PIN',
    nickname: 'உங்கள் பெயர்',
    nicknamePlaceholder: 'உங்கள் பெயரை உள்ளிடுக...',
    selectAvatar: 'ஸ்டிக்கர் அவதாரைத் தேர்வு செய்',
    readyToPlay: 'தயார்!',
    lockItIn: 'விடையை உறுதி செய்!',
    niceOne: 'அற்புதம்! சரியான விடை!',
    oopsMissed: 'தவறு! அடுத்த கேள்வியில் வெல்வோம்!',
    points: 'புள்ளிகள்',
    streak: 'தொடர் வெற்றி',
    rank: 'தரவரிசை',
    leaderboard: 'வெற்றிப் பலகை',
    nextQuestion: 'அடுத்த கேள்வி',
    revealAnswer: 'விடை வெளியீடு',
    skipQuestion: 'தவிர்',
    pauseGame: 'இடைநிறுத்து',
    resumeGame: 'தொடர்க',
    endGame: 'ஆட்டத்தை முடி',
    playersJoined: 'களத்தில் உள்ள வீரர்கள்',
    waitingForHost: 'தயாராக இருங்கள்! ஆசிரியர் விரைவில் தொடங்குவார்...',
    gameOver: 'ஆட்டம் முடிந்தது!',
    podium: 'வெற்றி மேடை',
    downloadCertificate: 'சான்றிதழ் பதிவிறக்கு (PDF)',
    shareResult: 'முடிவு அட்டை பகிர்',
    quizBuilder: 'வினாடி வினா உருவாக்குநர்',
    aiGenerator: 'AI வினா ஜெனரேட்டர் (PDF)',
    analytics: 'பகுப்பாய்வு & COs',
    competitions: 'போட்டிகள்',
    emailOutbox: 'மின்னஞ்சல் பெட்டி',
    soloPractice: 'தனிப்பயிற்சி',
    navJoin: 'அரங்கம்',
    navBuilder: 'உருவாக்கு',
    navAI: 'AI வினா',
    navCompetitions: 'போட்டிகள்',
    navAnalytics: 'பகுப்பாய்வு',
    navOutbox: 'அவுட்பாக்ஸ்',
    navPractice: 'பயிற்சி',
    accommodations: 'வசதிகள் & அணுகல்தன்மை',
    extraTime: 'கூடுதல் நேரம்',
    dyslexiaFont: 'டிஸ்லெக்ஸியா எழுத்துரு',
    largeText: 'பெரிய எழுத்துக்கள்',
    readAloud: 'கேள்விகளைப் படி',
    powerUps: 'சக்தி உதவிகள் (Power-Ups)',
    powerUp5050: '50/50 (2 தவறானதை நீக்கு)',
    powerUp2x: 'இரட்டைப் புள்ளிகள் (2x)',
    powerUpFreeze: 'நேரத்தை நிறுத்து (+5s)',
    demoModeNotice: 'டெமோ பயன்முறை: ஆஃப்லைன் ஒத்திசைவு இயங்குகிறது.',
    simulatePlayers: 'வீரர்களை உருவகப்படுத்து (சோதனை கருவி)',
    verifyIntegrity: 'நாணயத்தன்மையைச் சரிபார்',
    integrityPass: 'சரிபார்க்கப்பட்டது: பாதுகாப்பானது',
    integrityFail: 'தரவு மாற்றம் கண்டறியப்பட்டது',
  },
  hi: {
    appName: 'QuizArena',
    tagline: 'रीयल-टाइम मल्टीप्लेयर क्विज़ और प्रतियोगिताएं',
    joinGame: 'अखाड़े में शामिल हों',
    hostGame: 'क्विज़ होस्ट करें',
    enterPin: 'गेम पिन (PIN)',
    pinPlaceholder: '6-अंकीय पिन',
    nickname: 'आपका उपनाम',
    nicknamePlaceholder: 'अपना नाम लिखें...',
    selectAvatar: 'अपना स्टीकर अवतार चुनें',
    readyToPlay: 'मैं तैयार हूँ!',
    lockItIn: 'उत्तर लॉक करें!',
    niceOne: 'शानदार! बिल्कुल सही!',
    oopsMissed: 'ओह! कोई बात नहीं, आगे बढ़ें!',
    points: 'अंक',
    streak: 'लगातार सही',
    rank: 'रैंक',
    leaderboard: 'लीडरबोर्ड',
    nextQuestion: 'अगला प्रश्न',
    revealAnswer: 'उत्तर दिखाएं',
    skipQuestion: 'छोड़ें',
    pauseGame: 'रोकें',
    resumeGame: 'जारी रखें',
    endGame: 'गेम समाप्त करें',
    playersJoined: 'शामिल खिलाड़ी',
    waitingForHost: 'तैयार रहें! होस्ट जल्द ही शुरू करेंगे...',
    gameOver: 'गेम समाप्त!',
    podium: 'विजेता मंच (पोडियम)',
    downloadCertificate: 'प्रमाणपत्र डाउनलोड करें (PDF)',
    shareResult: 'परिणाम कार्ड साझा करें',
    quizBuilder: 'क्विज़ स्टूडियो',
    aiGenerator: 'AI जनरेटर (PDF/टेक्स्ट)',
    analytics: 'एनालिटिक्स और परिणाम',
    competitions: 'प्रतियोगिताएं',
    emailOutbox: 'ईमेल आउटबॉक्स',
    soloPractice: 'स्वयं अभ्यास',
    navJoin: 'अखाड़ा',
    navBuilder: 'स्टूडियो',
    navAI: 'AI क्विज़',
    navCompetitions: 'प्रतियोगिताएं',
    navAnalytics: 'एनालिटिक्स',
    navOutbox: 'आउटबॉक्स',
    navPractice: 'अभ्यास',
    accommodations: 'सुलभता एवं समायोजन',
    extraTime: 'अतिरिक्त समय',
    dyslexiaFont: 'डिस्लेक्सिया-अनुकूल फॉन्ट',
    largeText: 'बड़ा टेक्स्ट आकार',
    readAloud: 'प्रश्न पढ़कर सुनाएं',
    powerUps: 'पावर-अप्स',
    powerUp5050: '50/50 (2 गलत विकल्प हटाएं)',
    powerUp2x: 'दोगुने अंक (2x)',
    powerUpFreeze: 'समय रोकें (+5s)',
    demoModeNotice: 'डेमो मोड: ऑफ़लाइन ब्रॉडकास्ट चैनल पर चल रहा है।',
    simulatePlayers: 'खिलाड़ी सिमुलेट करें (डेव टूल)',
    verifyIntegrity: 'ऑडिट अखंडता सत्यापित करें',
    integrityPass: 'चेन सत्यापित: सुरक्षित एवं प्रामाणिक',
    integrityFail: 'हैश चेन में छेड़छाड़ पाई गई',
  },
};

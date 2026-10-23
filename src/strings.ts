// UI text. Pure (no React) so notification texts can be built from it too.
import type { Lang } from './core/settings.ts';

export type { Lang };
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'hinglish', name: 'Hinglish' },
  { id: 'hi', name: 'हिंदी' },
];

// [English, Hinglish, हिंदी]. {name} is filled from vars.
const S = {
  'tab.home': ['Home', 'Home', 'होम'],
  'tab.downloads': ['Downloads', 'Downloads', 'डाउनलोड'],
  'tab.library': ['Library', 'Library', 'लाइब्रेरी'],
  'tab.more': ['More', 'More', 'और'],

  'home.tagline': ['Videos, music, photos from any app', 'Video, gaane, photos, kisi bhi app se', 'वीडियो, गाने, फ़ोटो, किसी भी ऐप से'],
  'home.paste': ['Paste a link', 'Link paste karo', 'लिंक पेस्ट करें'],
  'home.pasteBtn': ['Paste', 'Paste', 'पेस्ट'],
  'home.go': ['Get', 'Lo', 'लें'],
  'home.shareHint': [
    'Or tap Share → OnePlace in YouTube, Instagram or any app',
    'Ya YouTube, Instagram ya kisi bhi app mein Share → OnePlace dabao',
    'या YouTube, Instagram या किसी भी ऐप में Share → OnePlace दबाएँ',
  ],
  'home.copied': ['Copied link', 'Copied link', 'कॉपी किया लिंक'],
  'home.sites': ['Open a site, then share a link back', 'Site kholo, phir link share karo', 'साइट खोलें, फिर लिंक शेयर करें'],
  'home.allSites': ['All supported sites', 'Saari supported sites', 'सभी सपोर्टेड साइट्स'],
  'home.active': ['{n} downloading', '{n} download ho rahe', '{n} डाउनलोड हो रहे हैं'],
  'home.recent': ['Recent', 'Recent', 'हाल के'],
  'home.seeAll': ['See all', 'Sab dekho', 'सब देखें'],
  'home.tip': [
    'Tip: in the share menu, "OnePlace · MP3" saves a song in one tap.',
    'Tip: share menu mein "OnePlace · MP3" se gaana ek tap mein save.',
    'टिप: शेयर मेन्यू में "OnePlace · MP3" से गाना एक टैप में सेव होता है।',
  ],
  'home.noLink': [
    'No link found. In the app, tap Share → Copy link, then paste here.',
    'Link nahi mila. App mein Share → Copy link karo, phir yahan paste.',
    'लिंक नहीं मिला। ऐप में Share → Copy link करें, फिर यहाँ पेस्ट करें।',
  ],
  'home.clipboardEmpty': ['Clipboard is empty', 'Clipboard khali hai', 'क्लिपबोर्ड खाली है'],

  'engine.preparing': [
    'Getting the download engine ready… (first start only)',
    'Download engine ready ho raha hai… (sirf pehli baar)',
    'डाउनलोड इंजन तैयार हो रहा है… (सिर्फ़ पहली बार)',
  ],
  'engine.failed': ['The engine could not start.', 'Engine start nahi hua.', 'इंजन शुरू नहीं हुआ।'],

  'sheet.resolving': ['Opening short link…', 'Short link khol rahe…', 'छोटा लिंक खोल रहे हैं…'],
  'sheet.reading': ['Reading link…', 'Link padh rahe…', 'लिंक पढ़ रहे हैं…'],
  'sheet.reading2': ['Finding every quality', 'Saari qualities dhoondh rahe', 'सारी क्वालिटी ढूँढ रहे हैं'],
  'sheet.tryingPhotos': ['Looking for photos…', 'Photos dhoondh rahe…', 'फ़ोटो ढूँढ रहे हैं…'],
  'tab.video': ['Video', 'Video', 'वीडियो'],
  'tab.audio': ['Audio', 'Audio', 'ऑडियो'],
  'tab.photos': ['Photos', 'Photos', 'फ़ोटो'],
  'tab.thumb': ['Thumbnail', 'Thumbnail', 'थंबनेल'],
  'sheet.compat': ['Plays everywhere (MP4)', 'Har jagah chale (MP4)', 'हर जगह चले (MP4)'],
  'sheet.compatOff': ['Off: best codec, may be MKV', 'Off: best codec, MKV ho sakta', 'बंद: सबसे अच्छा कोडेक, MKV हो सकता है'],
  'sheet.download': ['Download', 'Download', 'डाउनलोड'],
  'sheet.remember': ['Remember my choice', 'Meri choice yaad rakho', 'मेरी पसंद याद रखें'],
  'sheet.added': ['Added to downloads', 'Downloads mein add hua', 'डाउनलोड में जोड़ा'],
  'sheet.live': ['Live now: records until it ends', 'Abhi live: khatam hone tak record', 'अभी लाइव: खत्म होने तक रिकॉर्ड'],
  'sheet.nothing': ['Nothing to download here', 'Yahan download karne ko kuch nahi', 'यहाँ डाउनलोड करने को कुछ नहीं'],
  'sheet.loginHint': [
    'Stories and highlights need you to log in to Instagram inside OnePlace.',
    'Stories aur highlights ke liye OnePlace mein Instagram login karo.',
    'स्टोरी और हाइलाइट के लिए OnePlace में Instagram लॉगिन करें।',
  ],
  'sheet.best': ['Best available', 'Best available', 'सबसे अच्छी उपलब्ध'],
  'sheet.items': ['{n} items', '{n} items', '{n} आइटम'],

  'audio.original': ['Original quality', 'Original quality', 'ओरिजिनल क्वालिटी'],
  'audio.originalSub': ['No conversion, fastest', 'Bina conversion, sabse fast', 'बिना कन्वर्ज़न, सबसे तेज़'],
  'audio.mp3': ['MP3 {kbps} kbps', 'MP3 {kbps} kbps', 'MP3 {kbps} kbps'],
  'audio.m4a': ['M4A (AAC)', 'M4A (AAC)', 'M4A (AAC)'],
  'audio.converted': ['converted', 'convert hoga', 'कन्वर्ट होगा'],
  'audio.forOld': ['plays on every device', 'har device par chale', 'हर डिवाइस पर चले'],
  'audio.source': [
    'Source audio is about {kbps} kbps. Converting cannot add quality.',
    'Original audio lagbhag {kbps} kbps hai. Convert karne se quality nahi badhti.',
    'मूल ऑडियो लगभग {kbps} kbps है। कन्वर्ट करने से क्वालिटी नहीं बढ़ती।',
  ],
  'audio.cover': ['Add cover art & song info', 'Cover art aur song info jodo', 'कवर आर्ट और गाने की जानकारी जोड़ें'],

  'photos.count': ['{n} of {total} selected', '{total} mein se {n} select', '{total} में से {n} चुने'],
  'photos.all': ['Select all', 'Sab select', 'सभी चुनें'],
  'photos.none': ['Clear', 'Hatao', 'हटाएँ'],
  'thumb.square': ['Square crop', 'Square crop', 'चौकोर क्रॉप'],
  'thumb.format': ['Save as', 'Save as', 'इस रूप में सेव'],
  'thumb.missing': ['No thumbnail found', 'Thumbnail nahi mila', 'थंबनेल नहीं मिला'],

  'pl.title': ['Playlist · {n} items', 'Playlist · {n} items', 'प्लेलिस्ट · {n} आइटम'],
  'pl.all': ['All', 'Sab', 'सभी'],
  'pl.first': ['First {n}', 'Pehle {n}', 'पहले {n}'],
  'pl.inList': ['This video is part of a playlist', 'Ye video ek playlist mein hai', 'यह वीडियो एक प्लेलिस्ट में है'],
  'pl.whole': ['Get the whole playlist', 'Poori playlist lo', 'पूरी प्लेलिस्ट लें'],

  'err.login': [
    'This needs a login. Log in to {site} inside OnePlace and try again.',
    'Iske liye login chahiye. OnePlace mein {site} login karke phir try karo.',
    'इसके लिए लॉगिन चाहिए। OnePlace में {site} में लॉगिन करके फिर कोशिश करें।',
  ],
  'err.private': [
    'This is private. If you can see it in the app, log in to {site} inside OnePlace.',
    'Ye private hai. App mein dikhta hai to OnePlace mein {site} login karo.',
    'यह प्राइवेट है। अगर ऐप में दिखता है तो OnePlace में {site} में लॉगिन करें।',
  ],
  'err.unavailable': ['This is not available any more.', 'Ye ab available nahi hai.', 'यह अब उपलब्ध नहीं है।'],
  'err.members': ['Only channel members can watch this.', 'Ye sirf channel members ke liye hai.', 'यह सिर्फ़ चैनल मेंबर्स के लिए है।'],
  'err.age': [
    'Age-restricted. Log in to {site} inside OnePlace to download.',
    'Age-restricted hai. Download ke liye OnePlace mein {site} login karo.',
    'उम्र-प्रतिबंधित है। डाउनलोड के लिए OnePlace में {site} में लॉगिन करें।',
  ],
  'err.geo': ['Not available in your country.', 'Aapke desh mein available nahi.', 'आपके देश में उपलब्ध नहीं।'],
  'err.drm': ['DRM-protected content cannot be downloaded.', 'DRM-protected content download nahi ho sakta.', 'DRM से सुरक्षित कंटेंट डाउनलोड नहीं हो सकता।'],
  'err.upcoming': [
    'Not started yet. Try again when it is live or published.',
    'Abhi shuru nahi hua. Live ya publish hone par try karo.',
    'अभी शुरू नहीं हुआ। लाइव या पब्लिश होने पर कोशिश करें।',
  ],
  'err.format': ['That quality is gone. Try the best available.', 'Wo quality ab nahi hai. Best available lo.', 'वह क्वालिटी अब नहीं है। सबसे अच्छी उपलब्ध लें।'],
  'err.unsupported': ['This site is not supported yet.', 'Ye site abhi supported nahi hai.', 'यह साइट अभी सपोर्टेड नहीं है।'],
  'err.novideo': ['No video here: it is photos.', 'Yahan video nahi, photos hain.', 'यहाँ वीडियो नहीं, फ़ोटो हैं।'],
  'err.ratelimit': [
    '{site} is limiting downloads right now. Wait a bit, or log in inside OnePlace.',
    '{site} abhi downloads rok raha hai. Thoda ruko ya OnePlace mein login karo.',
    '{site} अभी डाउनलोड सीमित कर रहा है। थोड़ा रुकें या OnePlace में लॉगिन करें।',
  ],
  'err.extractor': [
    '{site} changed something. Updating the engine usually fixes it.',
    '{site} ne kuch badla hai. Engine update se aksar theek ho jata hai.',
    '{site} ने कुछ बदला है। इंजन अपडेट से अक्सर ठीक हो जाता है।',
  ],
  'err.forbidden': [
    '{site} refused the download. Updating the engine usually fixes it.',
    '{site} ne download roka. Engine update se aksar theek ho jata hai.',
    '{site} ने डाउनलोड रोका। इंजन अपडेट से अक्सर ठीक हो जाता है।',
  ],
  'err.network': ['Network problem. Check your internet and try again.', 'Network problem. Internet check karke phir try karo.', 'नेटवर्क समस्या। इंटरनेट जाँचकर फिर कोशिश करें।'],
  'err.space': ['Phone storage is full.', 'Phone storage full hai.', 'फ़ोन स्टोरेज भर गया है।'],
  'err.canceled': ['Canceled', 'Cancel kiya', 'रद्द किया'],
  'err.unknown': ['Something went wrong.', 'Kuch gadbad ho gayi.', 'कुछ गड़बड़ हो गई।'],

  'fix.login': ['Log in', 'Login karo', 'लॉगिन करें'],
  'fix.update': ['Update engine', 'Engine update karo', 'इंजन अपडेट करें'],
  'fix.retry': ['Try again', 'Phir try karo', 'फिर कोशिश करें'],
  'fix.retryBest': ['Use best available', 'Best available lo', 'सबसे अच्छी उपलब्ध लें'],
  'fix.photos': ['Get the photos', 'Photos lo', 'फ़ोटो लें'],
  'fix.folder': ['Free up space, then retry', 'Jagah khali karke retry', 'जगह खाली करके फिर कोशिश करें'],
  'fix.report': ['Report problem', 'Problem batao', 'समस्या बताएँ'],
  'fix.updating': ['Updating engine…', 'Engine update ho raha…', 'इंजन अपडेट हो रहा है…'],

  'dl.active': ['In progress', 'Chal rahe', 'जारी'],
  'dl.failed': ['Failed', 'Fail hue', 'विफल'],
  'dl.done': ['Completed', 'Ho gaye', 'पूरे हुए'],
  'dl.empty': ['Nothing here yet', 'Abhi kuch nahi', 'अभी कुछ नहीं'],
  'dl.emptySub': [
    'Share a link to OnePlace, or paste one on Home.',
    'OnePlace ko link share karo, ya Home par paste karo.',
    'OnePlace पर लिंक शेयर करें, या होम पर पेस्ट करें।',
  ],
  'dl.clear': ['Clear finished', 'Finished hatao', 'पूरे हुए हटाएँ'],
  'st.queued': ['Waiting…', 'Line mein…', 'इंतज़ार…'],
  'st.starting': ['Starting…', 'Shuru ho raha…', 'शुरू हो रहा…'],
  'st.processing': ['Finishing up…', 'Final touch…', 'पूरा कर रहे…'],
  'st.paused': ['Paused', 'Ruka hua', 'रुका हुआ'],
  'st.left': ['{time} left', '{time} baaki', '{time} बाकी'],
  'act.open': ['Open', 'Kholo', 'खोलें'],
  'act.share': ['Share', 'Share', 'शेयर'],
  'act.delete': ['Delete', 'Delete', 'हटाएँ'],
  'act.cancel': ['Cancel', 'Cancel', 'रद्द करें'],
  'act.retry': ['Retry', 'Retry', 'फिर से'],
  'act.source': ['Open original post', 'Original post kholo', 'मूल पोस्ट खोलें'],
  'act.copyLink': ['Copy link', 'Link copy', 'लिंक कॉपी'],
  'act.deleteFile': ['Delete file too', 'File bhi delete', 'फ़ाइल भी हटाएँ'],
  'act.removeOnly': ['Remove from list', 'List se hatao', 'सूची से हटाएँ'],
  'act.details': ['Details', 'Details', 'विवरण'],

  'lib.all': ['All', 'Sab', 'सभी'],
  'lib.videos': ['Videos', 'Videos', 'वीडियो'],
  'lib.music': ['Music', 'Music', 'संगीत'],
  'lib.photos': ['Photos', 'Photos', 'फ़ोटो'],
  'lib.empty': ['Your downloads will show up here', 'Aapke downloads yahan dikhenge', 'आपके डाउनलोड यहाँ दिखेंगे'],
  'lib.where': [
    'Saved in Movies, Music and Pictures → OnePlace',
    'Movies, Music aur Pictures → OnePlace mein save',
    'Movies, Music और Pictures → OnePlace में सेव',
  ],

  'set.appearance': ['Look', 'Look', 'रूप'],
  'set.theme': ['Theme', 'Theme', 'थीम'],
  'set.theme.system': ['System', 'System', 'सिस्टम'],
  'set.theme.light': ['Light', 'Light', 'लाइट'],
  'set.theme.dark': ['Dark', 'Dark', 'डार्क'],
  'set.amoled': ['Pure black (AMOLED)', 'Pure black (AMOLED)', 'पूरा काला (AMOLED)'],
  'set.dynamic': ['Wallpaper colours', 'Wallpaper colours', 'वॉलपेपर के रंग'],
  'set.language': ['Language', 'Bhasha', 'भाषा'],
  'set.downloads': ['Downloads', 'Downloads', 'डाउनलोड'],
  'set.videoQuality': ['Video quality', 'Video quality', 'वीडियो क्वालिटी'],
  'set.best': ['Best', 'Best', 'सबसे अच्छी'],
  'set.compat': ['Plays everywhere (MP4 H.264)', 'Har jagah chale (MP4 H.264)', 'हर जगह चले (MP4 H.264)'],
  'set.audioFormat': ['Audio format', 'Audio format', 'ऑडियो फ़ॉर्मेट'],
  'set.mp3Bitrate': ['MP3 quality', 'MP3 quality', 'MP3 क्वालिटी'],
  'set.cover': ['Cover art & tags in songs', 'Gaano mein cover art & tags', 'गानों में कवर आर्ट और टैग'],
  'set.square': ['Square covers', 'Square cover', 'चौकोर कवर'],
  'set.concurrency': ['Downloads at once', 'Ek saath downloads', 'एक साथ डाउनलोड'],
  'set.wifiOnly': ['Download only on Wi-Fi', 'Sirf Wi-Fi par download', 'सिर्फ़ वाई-फ़ाई पर डाउनलोड'],
  'set.clipboard': ['Suggest copied links', 'Copied link suggest karo', 'कॉपी किए लिंक सुझाएँ'],
  'set.share': ['Share menu', 'Share menu', 'शेयर मेन्यू'],
  'set.quick': ['1-tap Video / MP3 / Thumbnail', '1-tap Video / MP3 / Thumbnail', '1-टैप वीडियो / MP3 / थंबनेल'],
  'set.quickSub': [
    'Extra share-menu entries that download with your defaults, without opening the app',
    'Share menu ke extra options, aapki settings se, app khole bina',
    'शेयर मेन्यू के अतिरिक्त विकल्प, आपकी सेटिंग से, ऐप खोले बिना',
  ],
  'set.accounts': ['Site logins', 'Site logins', 'साइट लॉगिन'],
  'set.accountsSub': [
    'For stories, private and age-restricted posts. Use a spare account if you download a lot.',
    'Stories, private aur age-restricted ke liye. Zyada download karte ho to spare account use karo.',
    'स्टोरी, प्राइवेट और उम्र-प्रतिबंधित पोस्ट के लिए। ज़्यादा डाउनलोड करते हैं तो दूसरा अकाउंट इस्तेमाल करें।',
  ],
  'set.loggedIn': ['Logged in · tap to log out', 'Logged in · logout ke liye tap', 'लॉग इन · लॉग आउट के लिए टैप करें'],
  'set.logIn': ['Log in', 'Login karo', 'लॉगिन करें'],
  'set.loggedOut': ['Logged out of {site}', '{site} se logout hua', '{site} से लॉग आउट हुआ'],
  'set.loggedInOk': ['Logged in to {site}', '{site} mein login ho gaya', '{site} में लॉग इन हो गया'],
  'set.loginMissing': [
    'No {site} login found. Log in on the page, then tap Done.',
    '{site} login nahi mila. Page par login karke Done dabao.',
    '{site} लॉगिन नहीं मिला। पेज पर लॉग इन करके Done दबाएँ।',
  ],
  'set.googleNote': [
    'Google may block sign-in inside apps. Most YouTube videos work without it.',
    'Google apps ke andar sign-in block kar sakta hai. Zyada YouTube videos bina login chalte hain.',
    'Google ऐप के अंदर साइन-इन रोक सकता है। ज़्यादातर YouTube वीडियो बिना लॉगिन चलते हैं।',
  ],
  'set.engine': ['Download engine', 'Download engine', 'डाउनलोड इंजन'],
  'set.engineChannel': ['yt-dlp updates', 'yt-dlp updates', 'yt-dlp अपडेट'],
  'set.nightly': ['Nightly (fastest fixes)', 'Nightly (sabse jaldi fix)', 'Nightly (सबसे जल्दी फ़िक्स)'],
  'set.stable': ['Stable', 'Stable', 'Stable'],
  'set.autoEngine': ['Update engine automatically', 'Engine apne aap update', 'इंजन अपने आप अपडेट करें'],
  'set.updateNow': ['Update now', 'Abhi update karo', 'अभी अपडेट करें'],
  'set.upToDate': ['Engine is up to date', 'Engine latest hai', 'इंजन नया ही है'],
  'set.updated': ['Engine updated to {v}', 'Engine {v} par update hua', 'इंजन {v} पर अपडेट हुआ'],
  'set.app': ['App updates', 'App updates', 'ऐप अपडेट'],
  'set.version': ['Version {v}', 'Version {v}', 'वर्ज़न {v}'],
  'set.appChannel': ['Update channel', 'Update channel', 'अपडेट चैनल'],
  'set.beta': ['Beta (every build)', 'Beta (har build)', 'बीटा (हर बिल्ड)'],
  'set.autoApp': ['Check for updates daily', 'Roz update check', 'रोज़ अपडेट जाँचें'],
  'set.checkNow': ['Check now', 'Abhi check karo', 'अभी जाँचें'],
  'set.noUpdate': ['You have the latest version', 'Latest version hai', 'आपके पास नया वर्ज़न है'],
  'set.checkFailed': ['Could not check: {error}', 'Check nahi hua: {error}', 'जाँच नहीं हुई: {error}'],
  'set.phone': ['Phone', 'Phone', 'फ़ोन'],
  'set.battery': ['Background downloads', 'Background downloads', 'बैकग्राउंड डाउनलोड'],
  'set.batteryOn': [
    'Battery saver may stop downloads. Tap to allow.',
    'Battery saver downloads rok sakta hai. Allow karne ko tap.',
    'बैटरी सेवर डाउनलोड रोक सकता है। अनुमति देने के लिए टैप करें।',
  ],
  'set.batteryOff': ['Allowed: downloads keep running', 'Allowed: downloads chalte rahenge', 'अनुमति है: डाउनलोड चलते रहेंगे'],
  'set.notifications': ['Notifications', 'Notifications', 'नोटिफ़िकेशन'],
  'set.notifOff': ['Off: tap to see download progress', 'Off: progress dekhne ko tap', 'बंद: प्रोग्रेस देखने के लिए टैप करें'],
  'set.notifOn': ['On', 'On', 'चालू'],
  'set.sites': ['Supported sites', 'Supported sites', 'सपोर्टेड साइट्स'],
  'set.about': ['About & privacy', 'About & privacy', 'जानकारी और प्राइवेसी'],
  'set.test': ['Engine test', 'Engine test', 'इंजन टेस्ट'],
  'set.report': ['Report a problem', 'Problem batao', 'समस्या बताएँ'],

  'sites.works': ['Works', 'Chalta hai', 'चलता है'],
  'sites.login': ['Some need login', 'Kuch ke liye login', 'कुछ के लिए लॉगिन'],
  'sites.best': ['Best effort', 'Koshish', 'कोशिश'],
  'sites.more': [
    'Plus 1,000+ other sites through yt-dlp and gallery-dl. Paste any link to try.',
    'Aur 1,000+ sites yt-dlp aur gallery-dl se. Koi bhi link paste karke dekho.',
    'और 1,000+ साइट्स yt-dlp और gallery-dl से। कोई भी लिंक पेस्ट करके देखें।',
  ],
  'sites.never': [
    'Not possible: Netflix, Prime Video, JioHotstar premium, Spotify and other DRM-protected services.',
    'Possible nahi: Netflix, Prime Video, JioHotstar premium, Spotify aur baaki DRM-protected services.',
    'संभव नहीं: Netflix, Prime Video, JioHotstar प्रीमियम, Spotify और दूसरी DRM-सुरक्षित सेवाएँ।',
  ],

  'about.body': [
    'OnePlace downloads on your phone with open-source engines (yt-dlp, gallery-dl, FFmpeg). No servers, no ads, no tracking, no account.',
    'OnePlace aapke phone par hi download karta hai, open-source engines (yt-dlp, gallery-dl, FFmpeg) se. Na server, na ads, na tracking, na account.',
    'OnePlace आपके फ़ोन पर ही ओपन-सोर्स इंजन (yt-dlp, gallery-dl, FFmpeg) से डाउनलोड करता है। न सर्वर, न विज्ञापन, न ट्रैकिंग, न अकाउंट।',
  ],
  'about.calls': ['What OnePlace connects to', 'OnePlace kahan connect karta hai', 'OnePlace किससे जुड़ता है'],
  'about.call1': ['The sites you download from', 'Jin sites se aap download karte ho', 'जिन साइट्स से आप डाउनलोड करते हैं'],
  'about.call2': ['github.com: app and yt-dlp updates', 'github.com: app aur yt-dlp updates', 'github.com: ऐप और yt-dlp अपडेट'],
  'about.call3': ['pypi.org: gallery-dl updates', 'pypi.org: gallery-dl updates', 'pypi.org: gallery-dl अपडेट'],
  'about.call4': ['cdn.jsdelivr.net: quick fixes and notices', 'cdn.jsdelivr.net: quick fixes aur notices', 'cdn.jsdelivr.net: त्वरित फ़िक्स और सूचनाएँ'],
  'about.legal': [
    'Download only what you have the right to. Respect creators and each site\'s terms. OnePlace never supports DRM-protected content.',
    'Sirf wahi download karo jiska aapko haq hai. Creators aur site ke rules ka respect karo. OnePlace DRM content support nahi karta.',
    'सिर्फ़ वही डाउनलोड करें जिसका आपको अधिकार है। क्रिएटर्स और साइट की शर्तों का सम्मान करें। OnePlace DRM कंटेंट सपोर्ट नहीं करता।',
  ],
  'about.licenses': ['Open-source licences', 'Open-source licences', 'ओपन-सोर्स लाइसेंस'],
  'about.source': ['Source code on GitHub', 'GitHub par source code', 'GitHub पर सोर्स कोड'],

  'ob1.title': ['Download from any app', 'Kisi bhi app se download', 'किसी भी ऐप से डाउनलोड'],
  'ob1.body': [
    'In YouTube, Instagram, Facebook or any app, tap Share → OnePlace. Pick the quality and you are done.',
    'YouTube, Instagram, Facebook ya kisi bhi app mein Share → OnePlace dabao. Quality chuno, ho gaya.',
    'YouTube, Instagram, Facebook या किसी भी ऐप में Share → OnePlace दबाएँ। क्वालिटी चुनें, हो गया।',
  ],
  'ob2.title': ['Everything stays on your phone', 'Sab kuch aapke phone par', 'सब कुछ आपके फ़ोन पर'],
  'ob2.body': [
    'Videos go to Movies/OnePlace, songs to Music/OnePlace, photos to Pictures/OnePlace. No servers, no ads, no tracking.',
    'Videos Movies/OnePlace mein, gaane Music/OnePlace mein, photos Pictures/OnePlace mein. Na server, na ads, na tracking.',
    'वीडियो Movies/OnePlace में, गाने Music/OnePlace में, फ़ोटो Pictures/OnePlace में। न सर्वर, न विज्ञापन, न ट्रैकिंग।',
  ],
  'ob3.title': ['See your downloads', 'Downloads dekho', 'अपने डाउनलोड देखें'],
  'ob3.body': [
    'Allow notifications to see progress. Only download what you have the right to.',
    'Progress dekhne ke liye notifications allow karo. Sirf wahi download karo jiska aapko haq hai.',
    'प्रोग्रेस देखने के लिए नोटिफ़िकेशन की अनुमति दें। सिर्फ़ वही डाउनलोड करें जिसका आपको अधिकार है।',
  ],
  'ob.next': ['Next', 'Aage', 'आगे'],
  'ob.allow': ['Allow notifications', 'Notifications allow karo', 'नोटिफ़िकेशन की अनुमति दें'],
  'ob.battery': ['Let downloads run in background', 'Background mein download chalne do', 'बैकग्राउंड में डाउनलोड चलने दें'],
  'ob.start': ['Start', 'Shuru karo', 'शुरू करें'],

  'up.title': ['Update available', 'Update aaya hai', 'अपडेट उपलब्ध'],
  'up.banner': ['OnePlace {v} is ready', 'OnePlace {v} ready hai', 'OnePlace {v} तैयार है'],
  'up.install': ['Update now', 'Abhi update', 'अभी अपडेट'],
  'up.skip': ['Skip this version', 'Ye version skip', 'यह वर्ज़न छोड़ें'],
  'up.downloading': ['Downloading {p}%', 'Download {p}%', 'डाउनलोड {p}%'],
  'up.permission': [
    'Allow OnePlace to install updates, then tap Update again.',
    'OnePlace ko updates install karne do, phir Update dabao.',
    'OnePlace को अपडेट इंस्टॉल करने दें, फिर अपडेट दबाएँ।',
  ],
  'up.failed': ['Update failed: {error}', 'Update fail: {error}', 'अपडेट विफल: {error}'],

  'test.body': [
    'Reads a link with each engine and shows how long it takes. Use it to check sites after an update.',
    'Har engine se link padhta hai aur time dikhata hai. Update ke baad sites check karne ke liye.',
    'हर इंजन से लिंक पढ़ता है और समय दिखाता है। अपडेट के बाद साइट्स जाँचने के लिए।',
  ],
  'test.run': ['Run test', 'Test chalao', 'टेस्ट चलाएँ'],
  'test.copy': ['Copy results', 'Results copy karo', 'नतीजे कॉपी करें'],

  'common.cancel': ['Cancel', 'Cancel', 'रद्द करें'],
  'common.close': ['Close', 'Band karo', 'बंद करें'],
  'common.back': ['Back', 'Peeche', 'वापस'],
  'common.on': ['On', 'On', 'चालू'],
  'common.off': ['Off', 'Off', 'बंद'],
  'common.copied': ['Copied', 'Copy ho gaya', 'कॉपी हुआ'],

  // Native notifications (sent to the Kotlin side with configure()).
  'n.channel': ['Downloads', 'Downloads', 'डाउनलोड'],
  'n.channelDone': ['Finished downloads', 'Pure downloads', 'पूरे हुए डाउनलोड'],
  'n.downloading': ['Downloading', 'Download ho raha', 'डाउनलोड हो रहा'],
  'n.waiting': ['Waiting', 'Line mein', 'इंतज़ार'],
  'n.done': ['Downloaded', 'Download ho gaya', 'डाउनलोड हो गया'],
  'n.failed': ['Download failed', 'Download fail', 'डाउनलोड विफल'],
  'n.cancel': ['Cancel', 'Cancel', 'रद्द करें'],
  'n.open': ['Open', 'Kholo', 'खोलें'],
  'n.share': ['Share', 'Share', 'शेयर'],
  'n.retry': ['Retry', 'Retry', 'फिर से'],
  'n.added': ['Added to OnePlace', 'OnePlace mein add hua', 'OnePlace में जोड़ा'],
  'n.noLink': ['No link found in what you shared', 'Share kiye text mein link nahi mila', 'शेयर किए टेक्स्ट में लिंक नहीं मिला'],
  'n.preparing': ['Getting the engine ready', 'Engine ready ho raha', 'इंजन तैयार हो रहा है'],
  'n.updatingEngine': ['Updating engine and trying again', 'Engine update karke phir try', 'इंजन अपडेट करके फिर कोशिश'],
} satisfies Record<string, readonly [string, string, string]>;

export type Key = keyof typeof S;
export type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

const IDX: Record<Lang, number> = { en: 0, hinglish: 1, hi: 2 };

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const s = S[key]?.[IDX[lang] ?? 0] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s;
}

export function defaultLang(): Lang {
  const l = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return /^hi\b/i.test(l) ? 'hi' : 'en';
}

/** Notification texts for the native side, in the chosen language. */
export function nativeStrings(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(S) as Key[]) if (key.startsWith('n.')) out[key.slice(2)] = translate(lang, key);
  return out;
}

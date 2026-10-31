// Runs at the very start of every page (and frame) in OnePlace's browser. It hides ads, and reports to
// the app what can be downloaded: the page's own title/picture, video and audio with a real address,
// big photos, links to posts OnePlace supports, the media on screen right now, and long-presses.
// Built on its own into assets/browser/inject.js (scripts/build-inject.ts); the app puts its rules in
// window.__op_cfg first. Everything it sends is only a hint: the app never acts without a tap.
import { bigImage, contentLink, EMPTY_CFG, fetchable, hideCss, largestSrc, rulesFor, tidy, type PageCfg } from './logic.ts';

interface Bridge {
  postMessage(s: string): void;
}

(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w.__oneplace || !/^https?:$/.test(location.protocol)) return;
  Object.defineProperty(w, '__oneplace', { value: true });
  const cfg: PageCfg = { ...EMPTY_CFG, ...((w.__op_cfg as PageCfg | undefined) ?? {}) };
  const host = location.hostname;
  const top = window === window.top;
  const send = (m: Record<string, unknown>) => {
    try {
      (w.OnePlace as Bridge | undefined)?.postMessage(JSON.stringify(m));
    } catch {
      // the app is not listening (or the page replaced the object): nothing to do
    }
  };

  // ---------- hide ads and "open the app" banners ----------
  const css = hideCss(rulesFor(cfg.hide, host).flat());
  const addStyle = () => {
    if (!css || document.getElementById('__op_hide')) return;
    const s = document.createElement('style');
    s.id = '__op_hide';
    s.textContent = css;
    (document.head ?? document.documentElement)?.appendChild(s);
  };
  if (document.documentElement) addStyle();

  // ---------- what the page shows ----------
  const sent = new Set<string>();
  const fresh = (key: string) => (sent.has(key) ? false : (sent.add(key), true));
  const absolute = (u: string | null | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u, location.href).href;
    } catch {
      return undefined;
    }
  };

  const meta = (sel: string) => (document.querySelector(sel) as HTMLMetaElement | null)?.content || undefined;
  const sendMeta = () => {
    if (!top) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const themes = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const theme = (themes.find((m) => !m.media || matchMedia(m.media).matches) ?? themes[0])?.content;
    send({
      t: 'meta',
      title: tidy(meta('meta[property="og:title"]') ?? document.title, 200),
      image: absolute(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]')),
      theme: theme && theme.length < 40 ? theme : undefined,
      dark,
    });
  };

  const mediaOf = (el: HTMLMediaElement) => {
    const src = el.currentSrc || el.src || el.querySelector('source')?.src;
    if (!fetchable(src)) return undefined;
    const video = el instanceof HTMLVideoElement;
    return {
      url: src,
      kind: video ? 'video' : 'audio',
      thumb: video ? absolute(el.poster) : undefined,
      w: video ? el.videoWidth || undefined : undefined,
      h: video ? el.videoHeight || undefined : undefined,
      dur: isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined,
    };
  };

  const imageOf = (img: HTMLImageElement) => {
    if (!bigImage(img.naturalWidth, img.naturalHeight)) return undefined;
    const src = (img.srcset && largestSrc(img.srcset, location.href)) || img.currentSrc || img.src;
    if (!fetchable(src)) return undefined;
    return { url: src, kind: 'image', w: img.naturalWidth, h: img.naturalHeight, title: tidy(img.alt) };
  };

  const scanMedia = () => {
    const media: Record<string, unknown>[] = [];
    document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((el) => {
      watch(el);
      const m = mediaOf(el);
      if (m && fresh(`m:${m.url}`)) media.push(m);
    });
    const ogVideo = absolute(meta('meta[property="og:video:secure_url"]') ?? meta('meta[property="og:video"]') ?? meta('meta[property="og:video:url"]'));
    if (top && fetchable(ogVideo) && fresh(`m:${ogVideo}`)) media.push({ url: ogVideo, kind: 'video', thumb: absolute(meta('meta[property="og:image"]')) });
    const imgs = document.images;
    for (let i = 0; i < imgs.length && media.length < 60; i++) {
      const img = imgs[i]!;
      const m = imageOf(img);
      if (!m) continue;
      watch(img);
      if (fresh(`m:${m.url}`)) media.push(m);
    }
    if (media.length) send({ t: 'media', items: media.slice(0, 60) });
  };

  const seenLinks = new WeakSet<Element>();
  const scanLinks = () => {
    if (!top) return;
    const items: Record<string, unknown>[] = [];
    const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
    for (let i = 0; i < anchors.length && i < 1500 && items.length < 60; i++) {
      const a = anchors[i]!;
      if (seenLinks.has(a)) continue;
      seenLinks.add(a);
      const hit = contentLink(a.getAttribute('href') ?? '', location.href);
      if (!hit || !fresh(`l:${hit.url}`)) continue;
      const img = a.querySelector('img');
      items.push({
        url: hit.url,
        title: tidy(a.getAttribute('aria-label') ?? a.title ?? a.textContent) ?? tidy(img?.alt),
        thumb: img ? (img.srcset && largestSrc(img.srcset, location.href)) || img.currentSrc || img.src || undefined : undefined,
      });
    }
    if (items.length) send({ t: 'links', items });
  };

  // ---------- the media on screen right now ----------
  const ratios = new Map<Element, number>();
  let viewKey = '';
  let viewTimer: number | undefined;
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.intersectionRatio >= 0.6) ratios.set(e.target, e.intersectionRatio * e.boundingClientRect.width * e.boundingClientRect.height);
              else ratios.delete(e.target);
            }
            window.clearTimeout(viewTimer);
            viewTimer = window.setTimeout(sendView, 350);
          },
          { threshold: [0, 0.6, 1] },
        )
      : undefined;
  const watched = new WeakSet<Element>();
  function watch(el: Element) {
    if (!io || watched.has(el)) return;
    watched.add(el);
    io.observe(el);
  }

  /** The post an element belongs to: the nearest post box's own link (per-site rule), else any. */
  const postOf = (el: Element) => {
    const sel = rulesFor(cfg.links, host)[0];
    let box: Element | null = el.closest('article');
    for (let i = 0, p = el.parentElement; !box && p && i < 8; i++, p = p.parentElement) {
      if (sel ? p.querySelector(sel) : p.querySelector('a[href]')) box = p;
    }
    const links = box ? [...box.querySelectorAll<HTMLAnchorElement>(sel || 'a[href]')] : [];
    for (const a of links) {
      const hit = contentLink(a.getAttribute('href') ?? '', location.href);
      if (hit) return hit;
    }
    return undefined;
  };

  function sendView() {
    if (!top) return;
    let bestEl: Element | undefined;
    let bestScore = 0;
    for (const [el, score] of ratios) {
      if (!el.isConnected) {
        ratios.delete(el);
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }
    let item: Record<string, unknown> | undefined;
    if (bestEl) {
      const video = bestEl instanceof HTMLVideoElement;
      const post = postOf(bestEl);
      const thumb = video ? absolute((bestEl as HTMLVideoElement).poster) : (bestEl as HTMLImageElement).currentSrc;
      if (post && post.url !== location.href) item = { url: post.url, kind: video ? 'video' : 'image', thumb, link: true };
      else if (bestEl instanceof HTMLMediaElement) item = mediaOf(bestEl);
      else if (bestEl instanceof HTMLImageElement) item = imageOf(bestEl);
    }
    const key = item ? String(item.url) : '';
    if (key === viewKey) return;
    viewKey = key;
    send({ t: 'view', item: item ?? null });
  }

  // ---------- long-press on a link, photo or video ----------
  window.addEventListener(
    'contextmenu',
    (e) => {
      const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
      let link: HTMLAnchorElement | null = null;
      let img: HTMLImageElement | null = null;
      let video: HTMLVideoElement | null = null;
      for (const el of stack.slice(0, 12)) {
        if (!(el instanceof Element)) continue;
        link ??= el.closest('a[href]');
        if (!img && el instanceof HTMLImageElement) img = el;
        if (!video && el instanceof HTMLVideoElement) video = el;
      }
      if (!link && !img && !video) return;
      e.preventDefault();
      const href = link ? absolute(link.getAttribute('href')) : undefined;
      const post = video ? postOf(video) : img ? postOf(img) : undefined;
      send({
        t: 'ctx',
        link: href && /^https?:/i.test(href) ? href : undefined,
        linkText: link ? tidy(link.textContent) : undefined,
        image: img ? (img.srcset && largestSrc(img.srcset, location.href)) || img.currentSrc || img.src || undefined : undefined,
        video: video ? mediaOf(video)?.url : undefined,
        poster: video ? absolute(video.poster) : undefined,
        post: post?.url,
      });
    },
    true,
  );

  // ---------- a video going full screen: tell its shape (wide ones turn the phone sideways) ----------
  const fullscreen = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const el = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    const v = el instanceof HTMLVideoElement ? el : el?.querySelector('video');
    if (v && v.videoWidth) send({ t: 'fs', w: v.videoWidth, h: v.videoHeight });
  };
  document.addEventListener('fullscreenchange', fullscreen, true);
  document.addEventListener('webkitfullscreenchange', fullscreen, true);

  // ---------- YouTube and YT Music play in OnePlace's player (no ads, background play) ----------
  const navHooks: (() => void)[] = [];
  if (cfg.takeover && top && /(^|\.)youtube\.com$/.test(host)) takeover();

  function takeover() {
    const music = host === 'music.youtube.com';
    let tapped = 0;
    window.addEventListener('pointerdown', () => (tapped = Date.now()), true);
    const watchUrl = (href: string | null | undefined): URL | undefined => {
      if (!href) return undefined;
      try {
        const u = new URL(href, location.href);
        return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch' && u.searchParams.get('v') ? u : undefined;
      } catch {
        return undefined;
      }
    };
    const cardOf = (a: Element) => {
      const box =
        a.closest('ytm-media-item, ytm-video-with-context-renderer, ytm-compact-video-renderer, ytm-playlist-video-renderer, ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer') ?? a;
      const title = tidy(a.getAttribute('aria-label') ?? a.getAttribute('title')) ?? tidy(box.querySelector('h3, h4, .media-item-headline, .title, yt-formatted-string')?.textContent);
      const img = box.querySelector('img');
      const thumb = img ? img.currentSrc || img.src : undefined;
      return { title, thumb: fetchable(thumb) ? thumb : undefined };
    };
    const play = (u: URL, extra: Record<string, unknown> = {}) => send({ t: 'play', url: u.href, ...extra });
    // A tap on a video or a song: OnePlace plays it; the page stays where it is.
    window.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href]');
        const u = watchUrl(a?.getAttribute('href'));
        if (!a || !u) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        play(u, cardOf(a));
      },
      true,
    );
    // Buttons without a link (Play all, Shuffle, YT Music's play buttons) open a watch page right after a
    // tap. Watch pages the site opens by itself (autoplay, skipping after an error) are left alone.
    navHooks.push(() => {
      const u = watchUrl(location.href);
      if (!u || Date.now() - tapped > 1500) return;
      tapped = 0;
      play(u, { title: tidy(document.title.replace(/ - YouTube( Music)?$/, '')) });
      // Back to where the tap was, so closing the player shows that page again.
      history.back();
    });
    // A watch page opened straight from a link.
    const first = watchUrl(location.href);
    if (first) play(first);
    // The page's own player never plays; the app also stops its video requests, so nothing is loaded.
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (music || location.pathname === '/watch') {
        try {
          this.pause();
        } catch {
          // not playing anyway
        }
        return Promise.resolve();
      }
      return realPlay.call(this);
    };
  }

  // ---------- when to look ----------
  let timer: number | undefined;
  let last = 0;
  const scan = () => {
    timer = undefined;
    last = Date.now();
    try {
      scanMedia();
      scanLinks();
    } catch {
      // a strange page: try again on the next change
    }
  };
  const soon = (ms = 900) => {
    if (timer !== undefined) return;
    timer = window.setTimeout(scan, Math.max(ms, 1500 - (Date.now() - last)));
  };
  // A video that starts playing knows its address only now.
  document.addEventListener('playing', () => soon(200), true);
  document.addEventListener('loadedmetadata', () => soon(300), true);
  const ready = () => {
    addStyle();
    sendMeta();
    soon(100);
    new MutationObserver(() => soon()).observe(document.documentElement, { childList: true, subtree: true });
  };
  // Normally this runs before the page; on old WebViews it is added once the page has loaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('load', () => {
    sendMeta();
    soon(300);
  });

  // Sites that change page without loading one (YouTube, Instagram, X…).
  const navigated = () => {
    navHooks.forEach((f) => f());
    viewKey = '';
    window.setTimeout(sendMeta, 700);
    window.setTimeout(sendMeta, 2200);
    soon(600);
  };
  for (const name of ['pushState', 'replaceState'] as const) {
    const orig = history[name];
    history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      navigated();
      return r;
    } as History['pushState'];
  }
  window.addEventListener('popstate', navigated);
})();

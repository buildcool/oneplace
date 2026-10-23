// App updates come from GitHub Releases (the app isn't on the Play Store).
// Tags are v1.<minor>.<CI run number>; the run number is also the APK's versionCode.

export const REPO = 'buildcool/oneplace';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

export interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GhRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  prerelease?: boolean;
  draft?: boolean;
  html_url?: string;
  assets?: Asset[];
}

export interface Update {
  version: string;
  build: number;
  notes: string;
  url: string;
  fileName: string;
  size: number;
  page: string;
  prerelease: boolean;
}

/** "v1.0.57" → 57. */
export const buildOf = (tag = '') => Number(tag.replace(/^v/, '').split('.').at(-1)) || 0;

/** The APK made for this phone's CPU (OnePlace-arm64-v8a.apk…), else the universal one. */
export function pickAsset(assets: Asset[], abis: string[]): Asset | undefined {
  const apks = assets.filter((a) => a.name.endsWith('.apk'));
  for (const abi of abis) {
    const hit = apks.find((a) => a.name.includes(abi));
    if (hit) return hit;
  }
  return apks.find((a) => /universal/i.test(a.name)) ?? apks[0];
}

/** Newest release for the channel (beta also sees pre-releases), if newer than `build`. */
export function newest(releases: GhRelease[], channel: 'stable' | 'beta', build: number, abis: string[]): Update | undefined {
  const usable = releases.filter((r) => !r.draft && (channel === 'beta' || !r.prerelease) && buildOf(r.tag_name) > 0);
  usable.sort((a, b) => buildOf(b.tag_name) - buildOf(a.tag_name));
  const r = usable[0];
  if (!r || buildOf(r.tag_name) <= build) return undefined;
  const asset = pickAsset(r.assets ?? [], abis);
  if (!asset) return undefined;
  return {
    version: (r.tag_name ?? '').replace(/^v/, ''),
    build: buildOf(r.tag_name),
    notes: r.body ?? '',
    url: asset.browser_download_url,
    fileName: asset.name,
    size: asset.size,
    page: r.html_url ?? RELEASES_PAGE,
    prerelease: !!r.prerelease,
  };
}

const KEY = 'op.update';
const DAY = 24 * 60 * 60 * 1000;

/** Checks GitHub at most once a day unless forced. GitHub's API allows browser (CORS) requests. */
export async function checkForUpdate(o: {
  build: number;
  channel: 'stable' | 'beta';
  abis: string[];
  force?: boolean;
  fetchFn?: typeof fetch;
}): Promise<Update | undefined> {
  if (!o.build) return undefined;
  let cached: { at: number; channel: string; releases: GhRelease[] } | undefined;
  try {
    cached = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? undefined;
  } catch {
    cached = undefined;
  }
  let releases = cached?.channel === o.channel ? cached.releases : undefined;
  if (o.force || !releases || Date.now() - (cached?.at ?? 0) > DAY) {
    const res = await (o.fetchFn ?? fetch)(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as GhRelease[];
    // Keep only what we need so localStorage stays small.
    releases = all.map((r) => ({
      tag_name: r.tag_name,
      body: (r.body ?? '').slice(0, 4000),
      prerelease: r.prerelease,
      draft: r.draft,
      html_url: r.html_url,
      assets: (r.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size })),
    }));
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), channel: o.channel, releases }));
    } catch {
      // not fatal
    }
  }
  return newest(releases ?? [], o.channel, o.build, o.abis);
}

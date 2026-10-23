// Try a link with the real engines in Termux, using exactly the arguments the app would use.
//
//   npm run live -- <url>                 what's in the link (qualities, sizes, timing)
//   npm run live -- <url> video [--res 720] [--best] [--dry]
//   npm run live -- <url> audio [--mp3 192|--m4a|--original]
//   npm run live -- <url> thumbnail
//   npm run live -- <url> photo
//
// Needs: pip install -U "yt-dlp[default]" gallery-dl ; pkg install ffmpeg   (qjs is used for YouTube)
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explain, errorLine } from '../src/core/errors.ts';
import { bytes, duration } from '../src/core/format.ts';
import { parseGallery, parseYtInfo, type YtInfo } from '../src/core/formats.ts';
import { infoArgs } from '../src/core/info.ts';
import { detect } from '../src/core/links.ts';
import { DEFAULTS, audioSpec, buildRequest, videoSpec } from '../src/core/settings.ts';
import { enginesFor } from '../src/core/sites.ts';
import type { DownloadSpec, JobTemplate } from '../src/core/types.ts';
import { engineCommand, jsRuntimeArgs, run } from './local-engine.ts';

const argv = process.argv.slice(2);
const url = argv[0];
const mode = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'info';
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (!url) {
  console.log('usage: npm run live -- <url> [info|video|audio|thumbnail|photo] [--res 720] [--best] [--mp3 192] [--dry]');
  process.exit(1);
}

const link = detect(url);
console.log(`site=${link.site} kind=${link.kind}${link.id ? ` id=${link.id}` : ''}${link.short ? ' (short link)' : ''}`);

async function engineRun(t: JobTemplate, outDir: string, extra: string[] = []) {
  const cmd = await engineCommand(t.engine);
  const pre = t.engine === 'ytdlp' ? [...(await jsRuntimeArgs()), '-P', outDir] : ['-D', outDir];
  let last = '';
  const r = await run(cmd, [...pre, ...t.args, ...extra, link.url], {
    onLine: (l) => {
      if (/^\[download\]\s+\d/.test(l)) {
        if (l !== last) process.stdout.write(`\r${l.slice(0, 100).padEnd(100)}`);
        last = l;
      } else console.log(`\n${l}`);
    },
  });
  process.stdout.write('\n');
  return r;
}

async function info() {
  for (const eng of enginesFor(link)) {
    try {
      const cmd = await engineCommand(eng);
      const pre = eng === 'ytdlp' ? await jsRuntimeArgs() : [];
      const r = await run(cmd, [...pre, ...infoArgs(link, eng), link.url]);
      console.log(`\n== ${eng}: exit ${r.code} in ${(r.ms / 1000).toFixed(1)}s`);
      if (r.code !== 0 && !r.out.trim().startsWith('{') && !r.out.trim().startsWith('[')) {
        const ex = explain(r.err);
        console.log(`   ${ex.code} → fix: ${ex.fix}\n   ${errorLine(r.err)}`);
        continue;
      }
      if (eng === 'gallerydl') {
        const g = parseGallery(JSON.parse(r.out || '[]'));
        if (g.error) {
          const ex = explain(g.error);
          console.log(`   ${ex.code} → fix: ${ex.fix}\n   ${g.error}`);
          continue;
        }
        console.log(`   ${g.title} · ${g.author ?? ''} · ${g.items.length} items, ${g.queued} queued`);
        g.items.slice(0, 10).forEach((i) => console.log(`   #${i.num} ${i.ext}${i.isVideo ? ' (video)' : ''} ${i.width ?? '?'}x${i.height ?? '?'}`));
      } else {
        const m = parseYtInfo(JSON.parse(r.out) as YtInfo, true);
        const best = parseYtInfo(JSON.parse(r.out) as YtInfo, false);
        console.log(`   ${m.title} · ${m.author ?? ''} · ${duration(m.duration)}${m.isLive ? ' · LIVE' : ''}${m.drm ? ' · DRM' : ''}`);
        if (m.playlist) console.log(`   playlist: ${m.playlist.count} items`);
        console.log('   video (compatible):  ' + m.video.map((o) => `${o.label} ${o.codec}/${o.container} ${o.approx ? '≈' : ''}${bytes(o.size)}`).join(' | '));
        console.log('   video (best):        ' + best.video.map((o) => `${o.label} ${o.codec}/${o.container}`).join(' | '));
        console.log('   audio: ' + m.audio.map((o) => `${o.key} ${o.approx ? '≈' : ''}${bytes(o.size)}`).join(' | ') + (m.sourceKbps ? ` (source ≈${m.sourceKbps} kbps)` : ''));
        console.log(`   thumbnails: ${m.thumbnails.length}`);
      }
    } catch (e) {
      console.log(`\n== ${eng}: ${(e as Error).message}`);
    }
  }
}

async function download() {
  const s = { ...DEFAULTS, compat: !flag('best') };
  const res = value('res');
  let spec: DownloadSpec;
  if (mode === 'video') spec = videoSpec({ ...s, videoQuality: res ? (Number(res) as 1080) : 'best' });
  else if (mode === 'audio')
    spec = audioSpec(s, flag('original') ? { audio: 'original' } : flag('m4a') ? { audio: 'm4a' } : { audio: 'mp3', bitrate: Number(value('mp3') ?? 320) });
  else if (mode === 'thumbnail') spec = { mode: 'thumbnail' };
  else spec = { mode: 'photo' };
  const engineId = mode === 'photo' ? 'gallerydl' : 'ytdlp';
  const req = buildRequest({ link, engine: engineId, spec, title: link.url });
  const outDir = join(tmpdir(), 'oneplace-live', String(Date.now()));
  mkdirSync(outDir, { recursive: true });
  const dry = flag('dry') && req.engine === 'ytdlp' ? ['--simulate', '--print', '%(format_id)s | %(ext)s | %(resolution)s | %(filesize,filesize_approx)s B'] : [];
  console.log(`$ ${req.engine} ${req.args.join(' ')}`);
  let r = await engineRun(req, outDir, dry);
  if (r.code !== 0 && req.fallback && explain(r.err).code === 'novideo') {
    console.log(`no video → trying ${req.fallback.engine}`);
    r = await engineRun(req.fallback, outDir);
  }
  if (r.code !== 0) {
    const ex = explain(r.err);
    console.log(`FAILED (${(r.ms / 1000).toFixed(1)}s): ${ex.code} → fix: ${ex.fix}\n${errorLine(r.err)}`);
    process.exit(2);
  }
  if (dry) return;
  const files = readdirSync(outDir).filter((f) => !f.endsWith('.part'));
  console.log(`done in ${(r.ms / 1000).toFixed(1)}s → ${outDir}`);
  files.forEach((f) => console.log(`   ${f}  ${bytes(statSync(join(outDir, f)).size)}`));
}

await (mode === 'info' ? info() : download());

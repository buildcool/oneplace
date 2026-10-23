// `npm run dev` helper: lets the browser preview ask the real engines installed in Termux what a link
// contains, so the download sheet shows real formats and sizes. Downloads stay simulated in the browser.
import type { Plugin } from 'vite';
import { infoArgs } from '../src/core/info.ts';
import { detect } from '../src/core/links.ts';
import type { EngineId } from '../src/core/types.ts';
import { engineCommand, jsRuntimeArgs, run } from './local-engine.ts';

export function devEngine(): Plugin {
  return {
    name: 'op-dev-engine',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__engine/info', async (req, res) => {
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const url = q.get('url') ?? '';
        const engine = (q.get('engine') ?? 'ytdlp') as EngineId;
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (!/^https?:\/\//.test(url) || (engine !== 'ytdlp' && engine !== 'gallerydl')) return send(400, { error: 'bad request' });
        try {
          const cmd = await engineCommand(engine);
          const extra = engine === 'ytdlp' ? await jsRuntimeArgs() : [];
          const r = await run(cmd, [...extra, ...infoArgs(detect(url), engine, q.get('playlist') === '1'), url]);
          if (r.code !== 0 && !r.out.trim()) return send(500, { error: r.err || `exit ${r.code}` });
          send(200, { engine, json: r.out, ms: r.ms });
        } catch (e) {
          send(501, { error: String((e as Error).message ?? e) });
        }
      });
    },
  };
}

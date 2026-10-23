// Runs the real engines installed in Termux (pip install "yt-dlp[default]" gallery-dl; pkg install ffmpeg).
// Used by `npm run live` and the `npm run dev` preview. The APK uses its own bundled copies.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineId } from '../src/core/types.ts';

const execFileP = promisify(execFile);

async function which(cmd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP('sh', ['-c', `command -v ${cmd}`]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function pyModule(mod: string): Promise<boolean> {
  try {
    await execFileP('python', ['-c', `import ${mod}`]);
    return true;
  } catch {
    return false;
  }
}

/** The command that runs an engine here, or undefined with a hint when it isn't installed. */
export async function engineCommand(engine: EngineId): Promise<string[]> {
  if (engine === 'ytdlp') {
    const bin = await which('yt-dlp');
    if (bin) return [bin];
    if (await pyModule('yt_dlp')) return ['python', '-m', 'yt_dlp'];
    throw new Error('yt-dlp not installed. Run: pip install -U "yt-dlp[default]"');
  }
  if (engine === 'gallerydl') {
    const bin = await which('gallery-dl');
    if (bin) return [bin];
    if (await pyModule('gallery_dl')) return ['python', '-m', 'gallery_dl'];
    throw new Error('gallery-dl not installed. Run: pip install -U gallery-dl');
  }
  throw new Error(`no local runner for ${engine}`);
}

/** Same JS runtime the APK uses (QuickJS), so YouTube results match the phone app. */
export async function jsRuntimeArgs(): Promise<string[]> {
  const qjs = await which('qjs');
  return qjs ? ['--js-runtimes', `quickjs:${qjs}`] : [];
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
  ms: number;
}

export function run(cmd: string[], args: string[], opts: { cwd?: string; onLine?: (line: string) => void } = {}): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(cmd[0], [...cmd.slice(1), ...args], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let partial = '';
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      out += s;
      if (opts.onLine) {
        const lines = (partial + s).split(/[\r\n]/);
        partial = lines.pop() ?? '';
        lines.filter(Boolean).forEach(opts.onLine);
      }
    });
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, out, err, ms: Date.now() - started }));
  });
}

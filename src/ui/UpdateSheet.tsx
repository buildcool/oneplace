import { useEffect, useState } from 'react';
import { bytes } from '../core/format.ts';
import type { Update } from '../core/update.ts';
import { engine } from '../engine/index.ts';
import { useT } from '../i18n.ts';
import { Icon } from './Icon.tsx';
import { Progress, Sheet } from './common.tsx';

/** "What's new" with one-tap install (downloads the APK made for this phone). */
export function UpdateSheet({ update, onClose, onSkip }: { update: Update; onClose: () => void; onSkip: () => void }) {
  const t = useT();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  const [needPermission, setNeedPermission] = useState(false);

  useEffect(
    () =>
      engine.onUpdateProgress((p) => {
        if (p.error) {
          setError(p.error);
          setProgress(undefined);
        } else setProgress(p.done ? 100 : p.progress);
      }),
    [],
  );

  async function install() {
    setError(undefined);
    if (!(await engine.canInstall())) {
      setNeedPermission(true);
      await engine.openInstallSettings();
      return;
    }
    setNeedPermission(false);
    setProgress(0);
    try {
      await engine.downloadUpdate({ url: update.url, fileName: update.fileName });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setProgress(undefined);
    }
  }

  const busy = progress !== undefined && !error;
  return (
    <Sheet
      onClose={onClose}
      label={t('up.title')}
      foot={
        <div className="stack">
          <button type="button" className="btn big block" disabled={busy} onClick={install}>
            {busy ? <span className="spinner" /> : <Icon name="download" />}
            {busy ? t('up.downloading', { p: Math.round(progress ?? 0) }) : `${t('up.install')} · ${bytes(update.size)}`}
          </button>
          {!busy ? (
            <button type="button" className="btn block ghost" onClick={onSkip}>
              {t('up.skip')}
            </button>
          ) : null}
        </div>
      }
    >
      <h3>
        <Icon name="sparkle" /> {t('up.title')}
      </h3>
      <p className="muted" style={{ marginTop: -6 }}>
        OnePlace {update.version}
        {update.prerelease ? <span className="tag">beta</span> : null}
      </p>
      {busy ? <Progress value={progress ?? -1} /> : null}
      {needPermission ? (
        <div className="banner warn">
          <Icon name="shield" />
          <div className="grow small">{t('up.permission')}</div>
        </div>
      ) : null}
      {error ? (
        <div className="banner bad">
          <Icon name="alert" />
          <div className="grow small">{t('up.failed', { error })}</div>
        </div>
      ) : null}
      <Notes text={update.notes} />
    </Sheet>
  );
}

/** Release notes: plain lines, "- " bullets and **bold**, nothing else. */
function Notes({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const list = /^\s*[-*] /.test(line);
    const clean = line.replace(/^\s*[-*] /, '').replace(/^#+\s*/, '');
    const last = blocks.at(-1);
    if (last && last.list === list) last.lines.push(clean);
    else blocks.push({ list, lines: [clean] });
  }
  const bold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
  return (
    <div className="notes">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i}>
            {b.lines.map((l, k) => (
              <li key={k}>{bold(l)}</li>
            ))}
          </ul>
        ) : (
          b.lines.map((l, k) => <p key={`${i}-${k}`}>{bold(l)}</p>)
        ),
      )}
    </div>
  );
}

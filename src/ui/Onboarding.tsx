import { useState } from 'react';
import { useT } from '../i18n.ts';
import { Icon, type IconName } from './Icon.tsx';

interface Props {
  onDone: () => void;
  onNotifications: () => Promise<void>;
  onBattery?: () => void;
}

/** Three short screens on first start: share, where files go, notifications. */
export function Onboarding({ onDone, onNotifications, onBattery }: Props) {
  const t = useT();
  const [i, setI] = useState(0);
  const slides: { icon: IconName; title: string; body: string }[] = [
    { icon: 'share', title: t('ob1.title'), body: t('ob1.body') },
    { icon: 'folder', title: t('ob2.title'), body: t('ob2.body') },
    { icon: 'bell', title: t('ob3.title'), body: t('ob3.body') },
  ];
  const s = slides[i];
  const last = i === slides.length - 1;
  return (
    <div className="onboard" role="dialog" aria-modal="true">
      <div className="onboard-brand">
        <b>OnePlace</b> <span>by buildcool</span>
      </div>
      <div className="art">
        <div className="bubble" key={i}>
          <Icon name={s.icon} size={76} />
        </div>
      </div>
      <div className="dots">
        {slides.map((_, k) => (
          <i key={k} className={k === i ? 'on' : ''} />
        ))}
      </div>
      <h2>{s.title}</h2>
      <p>{s.body}</p>
      <div className="stack">
        {last ? (
          <>
            <button type="button" className="btn big block tonal" onClick={onNotifications}>
              <Icon name="bell" /> {t('ob.allow')}
            </button>
            {onBattery ? (
              <button type="button" className="btn big block plain" onClick={onBattery}>
                <Icon name="battery" /> {t('ob.battery')}
              </button>
            ) : null}
            <button type="button" className="btn big block" onClick={onDone}>
              {t('ob.start')}
            </button>
          </>
        ) : (
          <button type="button" className="btn big block" onClick={() => setI(i + 1)}>
            {t('ob.next')} <Icon name="chevron" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

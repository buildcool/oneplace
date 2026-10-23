import { Capacitor } from '@capacitor/core';
import { androidEngine } from './android.ts';
import { mockEngine } from './mock.ts';

/** The native engine inside the APK, or a browser stand-in for `npm run dev`. */
export const engine = Capacitor.isNativePlatform() ? androidEngine : mockEngine;

export type { Engine, EngineStatus, InfoResult, NativeConfig, UpdateProgress } from './types.ts';

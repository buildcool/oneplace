#!/usr/bin/env python3
"""Reference for the vocal remover check in CI: sherpa-onnx's own Spleeter on ~20 s of a real song.

Usage: spleeter-reference.py DIR   (DIR has vocals.fp16.onnx, accompaniment.fp16.onnx and song.wav)
Writes DIR/mix.f32 (what our Kotlin port gets) and DIR/ref-vocals.f32: interleaved stereo float32, 44.1 kHz.
The clip is 4096 + 857 * 1024 samples long, so both sides cut it into exactly the same frames.
"""
import sys

import numpy as np
import sherpa_onnx
import soundfile as sf

d = sys.argv[1]
samples, rate = sf.read(f"{d}/song.wav", dtype="float32", always_2d=True)
assert rate == 44100, f"expected 44.1 kHz, got {rate}"
clip = samples[: 4096 + 857 * 1024]
if clip.shape[1] == 1:
    clip = np.repeat(clip, 2, axis=1)
clip = np.ascontiguousarray(clip[:, :2])

config = sherpa_onnx.OfflineSourceSeparationConfig(
    model=sherpa_onnx.OfflineSourceSeparationModelConfig(
        spleeter=sherpa_onnx.OfflineSourceSeparationSpleeterModelConfig(
            vocals=f"{d}/vocals.fp16.onnx",
            accompaniment=f"{d}/accompaniment.fp16.onnx",
        ),
        num_threads=2,
        debug=False,
        provider="cpu",
    )
)
assert config.validate(), "bad sherpa-onnx config"
out = sherpa_onnx.OfflineSourceSeparation(config).process(sample_rate=rate, samples=np.ascontiguousarray(clip.T))
vocals = np.asarray(out.stems[0].data, dtype=np.float32).T

clip.astype("<f4").tofile(f"{d}/mix.f32")
np.ascontiguousarray(vocals).astype("<f4").tofile(f"{d}/ref-vocals.f32")
print("reference written:", clip.shape, vocals.shape)

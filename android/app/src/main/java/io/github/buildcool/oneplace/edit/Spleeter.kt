package io.github.buildcool.oneplace.edit

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

/** Reads interleaved stereo samples: up to [frames] sample pairs into [buf]; returns how many, or -1 at the end. */
fun interface PcmIn {
    fun read(buf: FloatArray, frames: Int): Int
}

/** Takes [frames] interleaved stereo sample pairs from [buf]. */
fun interface PcmOut {
    fun write(buf: FloatArray, frames: Int)
}

/** The two Spleeter networks. [x] holds magnitudes laid out (channel, frame, bin): 2 × BLOCK × 1024. Returns (vocals, music). */
interface StemModels {
    fun run(x: FloatArray): Pair<FloatArray, FloatArray>
}

/**
 * Spleeter 2-stems, streamed one block (~12 s of sound) at a time. Ported from sherpa-onnx
 * (csrc/offline-source-separation-spleeter-impl.h): STFT 4096/1024 with a periodic Hann window and no
 * centring; the first 1024 bins' magnitudes go to both networks; their outputs become soft masks v²/(v²+a²);
 * the masked spectra are turned back into sound by overlap-add. Above 11 kHz (bins the networks never see)
 * everything goes to the music, so cymbals and air are kept instead of being cut as in plain Spleeter.
 * Not thread-safe; one instance per run.
 */
class Spleeter(private val models: StemModels) {
    companion object {
        const val RATE = 44100
        const val N_FFT = 4096
        const val HOP = 1024
        const val BINS = N_FFT / 2 + 1
        const val MODEL_BINS = 1024
        const val BLOCK = 512

        /** Samples one block of frames reads. */
        const val SPAN = BLOCK * HOP + N_FFT - HOP
        private const val EPS = 1e-10f
        private const val OVERLAP = N_FFT / HOP

        /**
         * The first and last ~1000 samples are covered by one frame only, whose window is nearly zero at its edge;
         * dividing by that turns tiny differences into loud clicks (sherpa-onnx has them). With this floor those
         * ~18 ms fade in/out instead. Everywhere else the weight is at least 0.25, so nothing changes there.
         */
        private const val MIN_WEIGHT = 0.1f

        val WINDOW = FloatArray(N_FFT) { (0.5 - 0.5 * cos(2 * PI * it / N_FFT)).toFloat() }

        /** Σ window² of the 4 frames over a sample, by its place within a hop (the same everywhere but the ends). */
        private val STEADY = FloatArray(HOP) { j -> (0 until OVERLAP).sumOf { k -> (WINDOW[j + k * HOP] * WINDOW[j + k * HOP]).toDouble() }.toFloat() }

        /** Overlap-add weight of sample [n] when frames 0..[lastFrame] exist. */
        fun weight(n: Long, lastFrame: Long): Float {
            val hi = minOf(n / HOP, lastFrame)
            val lo = maxOf(0L, Math.floorDiv(n - N_FFT + HOP, HOP.toLong()))
            if (hi - lo + 1 == OVERLAP.toLong()) return STEADY[(n % HOP).toInt()]
            var s = 0f
            for (t in lo..hi) {
                val w = WINDOW[(n - t * HOP).toInt()]
                s += w * w
            }
            return s
        }

        /** Frames for [samples] samples: the last frame is zero-padded so the end is not lost. */
        fun framesFor(samples: Long): Long = if (samples <= N_FFT) 1 else (samples - N_FFT + HOP - 1) / HOP + 1
    }

    private class Stem(val vocals: Boolean, val out: PcmOut) {
        /** Overlap-add sums for samples from [start]. */
        val acc = Array(2) { FloatArray(SPAN) }
        var start = 0L
    }

    private val fft = RealFft(N_FFT)
    private val input = Array(2) { FloatArray(SPAN) }
    private var inStart = 0L
    private var inLen = 0
    private var read = 0L
    private var eof = false
    private val specRe = Array(2) { FloatArray(BLOCK * BINS) }
    private val specIm = Array(2) { FloatArray(BLOCK * BINS) }
    private val x = FloatArray(2 * BLOCK * MODEL_BINS)
    private val frame = FloatArray(N_FFT)
    private val outRe = FloatArray(BINS)
    private val outIm = FloatArray(BINS)
    private val pcm = FloatArray(2 * 8192)

    /**
     * Splits [source] into the voice and the music, writing each wanted part to its output. [total] (sample pairs,
     * 0 if unknown) is only for [progress] (0..1). Returns how many sample pairs were written per output.
     */
    fun separate(source: PcmIn, vocals: PcmOut?, music: PcmOut?, total: Long, progress: (Double) -> Unit, canceled: () -> Boolean): Long {
        val stems = listOfNotNull(vocals?.let { Stem(true, it) }, music?.let { Stem(false, it) })
        require(stems.isNotEmpty()) { "nothing to write" }
        var t0 = 0L
        var written = 0L
        while (!canceled()) {
            fill(source, t0 * HOP + SPAN)
            val totalFrames = if (eof) framesFor(read) else Long.MAX_VALUE
            val frames = minOf(BLOCK.toLong(), totalFrames - t0).toInt()
            if (frames <= 0) {
                // The sound ended right after a block: all of it is analysed, the tail only needs writing out.
                for (s in stems) written = emit(s, read, totalFrames - 1)
                break
            }
            stft(frames)
            val (v, a) = models.run(x)
            val last = eof && t0 + frames >= totalFrames
            val end = if (last) read else (t0 + frames) * HOP
            val lastFrame = if (eof) totalFrames - 1 else t0 + frames - 1
            for (s in stems) {
                synthesize(s, v, a, frames, t0)
                written = emit(s, end, lastFrame)
            }
            t0 += frames
            dropInput(t0 * HOP)
            if (total > 0) progress(minOf(1.0, end.toDouble() / total))
            if (last) break
        }
        return written
    }

    /** Read until the input buffer holds samples up to [until] (or the sound ends). */
    private fun fill(source: PcmIn, until: Long) {
        while (!eof && inStart + inLen < until) {
            val want = minOf(pcm.size / 2, (until - inStart - inLen).toInt())
            val n = source.read(pcm, want)
            if (n < 0) {
                eof = true
                break
            }
            for (i in 0 until n) {
                input[0][inLen + i] = pcm[2 * i]
                input[1][inLen + i] = pcm[2 * i + 1]
            }
            inLen += n
            read += n
        }
    }

    private fun dropInput(newStart: Long) {
        val drop = (newStart - inStart).toInt().coerceIn(0, inLen)
        for (ch in 0..1) System.arraycopy(input[ch], drop, input[ch], 0, inLen - drop)
        inLen -= drop
        inStart += drop
    }

    /** Spectra of this block's frames, and the magnitudes the networks get (frames past the end stay silent). */
    private fun stft(frames: Int) {
        x.fill(0f)
        for (ch in 0..1) {
            val samples = input[ch]
            for (f in 0 until frames) {
                val from = f * HOP
                for (i in 0 until N_FFT) {
                    val k = from + i
                    frame[i] = if (k < inLen) samples[k] * WINDOW[i] else 0f
                }
                fft.forward(frame, 0, specRe[ch], specIm[ch], f * BINS)
                val base = ch * BLOCK * MODEL_BINS + f * MODEL_BINS
                val s = f * BINS
                for (b in 0 until MODEL_BINS) {
                    val re = specRe[ch][s + b]
                    val im = specIm[ch][s + b]
                    x[base + b] = sqrt(re * re + im * im)
                }
            }
        }
    }

    /** Mask the block's spectra for one part and overlap-add them back into sound. */
    private fun synthesize(stem: Stem, v: FloatArray, a: FloatArray, frames: Int, t0: Long) {
        for (ch in 0..1) {
            val acc = stem.acc[ch]
            for (f in 0 until frames) {
                val base = ch * BLOCK * MODEL_BINS + f * MODEL_BINS
                val s = f * BINS
                for (b in 0 until MODEL_BINS) {
                    val vv = v[base + b] * v[base + b]
                    val aa = a[base + b] * a[base + b]
                    val m = ((if (stem.vocals) vv else aa) + EPS / 2) / (vv + aa + EPS)
                    outRe[b] = specRe[ch][s + b] * m
                    outIm[b] = specIm[ch][s + b] * m
                }
                for (b in MODEL_BINS until BINS) {
                    if (stem.vocals) {
                        outRe[b] = 0f
                        outIm[b] = 0f
                    } else {
                        outRe[b] = specRe[ch][s + b]
                        outIm[b] = specIm[ch][s + b]
                    }
                }
                fft.inverse(outRe, outIm, 0, frame, 0)
                val at = ((t0 + f) * HOP - stem.start).toInt()
                for (i in 0 until N_FFT) acc[at + i] += frame[i] * WINDOW[i]
            }
        }
    }

    /** Write the finished samples (before [end]) and move the rest to the front. Returns the samples written so far. */
    private fun emit(stem: Stem, end: Long, lastFrame: Long): Long {
        val count = (end - stem.start).toInt()
        var done = 0
        while (done < count) {
            val n = minOf(pcm.size / 2, count - done)
            for (i in 0 until n) {
                val pos = stem.start + done + i
                val w = maxOf(weight(pos, lastFrame), MIN_WEIGHT)
                for (ch in 0..1) pcm[2 * i + ch] = stem.acc[ch][done + i] / w
            }
            stem.out.write(pcm, n)
            done += n
        }
        for (ch in 0..1) {
            val acc = stem.acc[ch]
            System.arraycopy(acc, count, acc, 0, acc.size - count)
            acc.fill(0f, acc.size - count, acc.size)
        }
        stem.start = end
        return end
    }
}

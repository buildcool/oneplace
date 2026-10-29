package io.github.buildcool.oneplace

import io.github.buildcool.oneplace.edit.OrtSpleeter
import io.github.buildcool.oneplace.edit.PcmIn
import io.github.buildcool.oneplace.edit.PcmOut
import io.github.buildcool.oneplace.edit.Spleeter
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The vocal remover with the real networks (ONNX Runtime's desktop build) on ~20 s of a real song, compared
 * with sherpa-onnx's own Spleeter (scripts/spleeter-reference.py). CI downloads the files and sets
 * OP_SPLEETER_DIR; without them the test is skipped.
 */
class SpleeterModelTest {
    @Test
    fun matchesSherpaOnnxOnARealSong() {
        val dir = System.getenv("OP_SPLEETER_DIR")?.let(::File)
        assumeTrue("vocal remover files not downloaded", dir != null && File(dir, "ref-vocals.f32").isFile)
        val mix = floats(File(dir, "mix.f32"))
        val ref = floats(File(dir, "ref-vocals.f32"))
        var pos = 0
        val source = PcmIn { buf, frames ->
            val left = mix.size / 2 - pos
            if (left <= 0) {
                -1
            } else {
                val n = minOf(frames, left)
                System.arraycopy(mix, pos * 2, buf, 0, n * 2)
                pos += n
                n
            }
        }
        val ours = FloatArray(mix.size)
        var at = 0
        val sink = PcmOut { buf, frames ->
            System.arraycopy(buf, 0, ours, at, frames * 2)
            at += frames * 2
        }
        val started = System.currentTimeMillis()
        OrtSpleeter(File(dir, "vocals.fp16.onnx").path, File(dir, "accompaniment.fp16.onnx").path, 2).use { models ->
            Spleeter(models).separate(source, sink, null, mix.size / 2L, {}, { false })
        }
        val ms = System.currentTimeMillis() - started
        // Same frames on both sides (the clip length is chosen for that). Skip one frame at each end: there
        // sherpa-onnx divides by a near-zero window weight (big spikes) where we write silence.
        val n = minOf(ref.size, at)
        var signal = 0.0
        var noise = 0.0
        for (i in 2 * Spleeter.N_FFT until n - 2 * Spleeter.N_FFT) {
            signal += ref[i].toDouble() * ref[i]
            val d = (ref[i] - ours[i]).toDouble()
            noise += d * d
        }
        val snr = 10 * log10(signal / noise.coerceAtLeast(1e-20))
        println("Vocal remover vs sherpa-onnx: SNR ${"%.1f".format(snr)} dB, ${mix.size / 2 / 44100.0} s of sound in $ms ms")
        assertTrue("vocals differ from sherpa-onnx: SNR $snr dB", snr > 30)
        assertTrue("no voice found", signal > 1.0)
    }

    private fun floats(f: File): FloatArray {
        val b = ByteBuffer.wrap(f.readBytes()).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        return FloatArray(b.remaining()).also { b.get(it) }
    }
}

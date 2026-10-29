package io.github.buildcool.oneplace.edit

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * FFT of n real samples (n a power of two) done as a complex FFT of n/2 points: even samples are the real
 * parts, odd samples the imaginary parts, then one split step. Spectra are bins 0..n/2 (n/2 + 1 values).
 * Keeps work arrays, so use one instance per thread.
 */
class RealFft(val n: Int) {
    private val m = n / 2
    private val bits = Integer.numberOfTrailingZeros(m)
    private val rev = IntArray(m) { if (bits == 0) 0 else Integer.reverse(it) ushr (32 - bits) }
    private val cosM = FloatArray(m / 2) { cos(2 * PI * it / m).toFloat() }
    private val sinM = FloatArray(m / 2) { sin(2 * PI * it / m).toFloat() }
    private val cosN = FloatArray(m + 1) { cos(2 * PI * it / n).toFloat() }
    private val sinN = FloatArray(m + 1) { sin(2 * PI * it / n).toFloat() }
    private val re = FloatArray(m)
    private val im = FloatArray(m)

    init {
        require(n >= 4 && n and (n - 1) == 0) { "n must be a power of two" }
    }

    /** x[xOff until xOff + n] → bins 0..n/2 at outOff. Not scaled. */
    fun forward(x: FloatArray, xOff: Int, outRe: FloatArray, outIm: FloatArray, outOff: Int) {
        for (i in 0 until m) {
            re[i] = x[xOff + 2 * i]
            im[i] = x[xOff + 2 * i + 1]
        }
        fft(inverse = false)
        outRe[outOff] = re[0] + im[0]
        outIm[outOff] = 0f
        outRe[outOff + m] = re[0] - im[0]
        outIm[outOff + m] = 0f
        for (k in 1 until m) {
            val zr = re[k]
            val zi = im[k]
            val cr = re[m - k]
            val ci = -im[m - k]
            // even part (Z[k] + conj Z[m-k]) / 2, odd part (Z[k] - conj Z[m-k]) / 2i
            val er = (zr + cr) * 0.5f
            val ei = (zi + ci) * 0.5f
            val ore = (zi - ci) * 0.5f
            val oim = -(zr - cr) * 0.5f
            // X[k] = even + e^(-2πik/n) · odd
            val wr = cosN[k]
            val wi = -sinN[k]
            outRe[outOff + k] = er + wr * ore - wi * oim
            outIm[outOff + k] = ei + wr * oim + wi * ore
        }
    }

    /** Bins 0..n/2 at inOff → n real samples, scaled by 1/n so that inverse(forward(x)) == x. */
    fun inverse(inRe: FloatArray, inIm: FloatArray, inOff: Int, out: FloatArray, outOff: Int) {
        for (k in 0 until m) {
            val xr = inRe[inOff + k]
            val xi = inIm[inOff + k]
            val yr = inRe[inOff + m - k]
            val yi = -inIm[inOff + m - k]
            val er = (xr + yr) * 0.5f
            val ei = (xi + yi) * 0.5f
            val dr = (xr - yr) * 0.5f
            val di = (xi - yi) * 0.5f
            val wr = cosN[k]
            val wi = sinN[k]
            val ore = dr * wr - di * wi
            val oim = dr * wi + di * wr
            re[k] = er - oim
            im[k] = ei + ore
        }
        fft(inverse = true)
        val s = 1f / m
        for (i in 0 until m) {
            out[outOff + 2 * i] = re[i] * s
            out[outOff + 2 * i + 1] = im[i] * s
        }
    }

    /** In-place radix-2 complex FFT of the work arrays (unscaled). */
    private fun fft(inverse: Boolean) {
        for (i in 0 until m) {
            val j = rev[i]
            if (j > i) {
                val tr = re[i]
                re[i] = re[j]
                re[j] = tr
                val ti = im[i]
                im[i] = im[j]
                im[j] = ti
            }
        }
        var size = 2
        while (size <= m) {
            val half = size / 2
            val step = m / size
            var start = 0
            while (start < m) {
                var k = 0
                for (j in start until start + half) {
                    val wr = cosM[k]
                    val wi = if (inverse) sinM[k] else -sinM[k]
                    val l = j + half
                    val tr = wr * re[l] - wi * im[l]
                    val ti = wr * im[l] + wi * re[l]
                    re[l] = re[j] - tr
                    im[l] = im[j] - ti
                    re[j] += tr
                    im[j] += ti
                    k += step
                }
                start += size
            }
            size *= 2
        }
    }
}

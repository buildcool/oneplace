package io.github.buildcool.oneplace.edit

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/** Spleeter's two networks, run by ONNX Runtime on the phone's CPU. */
class OrtSpleeter(vocalsPath: String, musicPath: String, threads: Int) : StemModels, AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val opts = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    }
    private val vocals = env.createSession(vocalsPath, opts)
    private val music = env.createSession(musicPath, opts)
    private val shape = longArrayOf(2, 1, Spleeter.BLOCK.toLong(), Spleeter.MODEL_BINS.toLong())

    override fun run(x: FloatArray): Pair<FloatArray, FloatArray> =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(x), shape).use { t -> Pair(run(vocals, t), run(music, t)) }

    private fun run(s: OrtSession, t: OnnxTensor): FloatArray =
        s.run(mapOf(s.inputNames.first() to t)).use { r ->
            val b = (r.get(0) as OnnxTensor).floatBuffer
            FloatArray(b.remaining()).also { b.get(it) }
        }

    override fun close() {
        vocals.close()
        music.close()
        opts.close()
    }
}

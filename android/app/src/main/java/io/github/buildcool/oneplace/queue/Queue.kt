package io.github.buildcool.oneplace.queue

import android.content.Context
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.engine.Engines
import io.github.buildcool.oneplace.engine.Progress
import io.github.buildcool.oneplace.engine.Runner
import io.github.buildcool.oneplace.storage.Saver
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * The download queue. Runs up to N jobs at once inside a user-initiated job (Android 14+) or a
 * foreground service, saves results through MediaStore and heals itself when a site changes:
 * photo posts fall back to gallery-dl, and extractor errors trigger one yt-dlp update and a retry.
 */
object Queue {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val drainLock = Mutex()
    private val runs = ConcurrentHashMap<String, kotlinx.coroutines.Job>()
    private val lastEmit = ConcurrentHashMap<String, Long>()
    private val lastSave = ConcurrentHashMap<String, Long>()

    @Volatile
    private var lastSummary = 0L

    /** EnginePlugin forwards job changes to the UI. */
    @Volatile
    var listener: ((Job) -> Unit)? = null

    @Volatile
    var draining = false
        private set

    private val NO_VIDEO = Regex("There is no video in this post|No video could be found|No video formats found|no media found", RegexOption.IGNORE_CASE)

    /** Errors a newer yt-dlp cannot fix, so no self-heal update for them. */
    private val USER_SIDE = Regex(
        "Private video|private account|is private|Video unavailable|has been removed|no longer available|DRM|" +
            "not available in your country|No space left|members[- ]only|Join this channel|confirm your age|Premieres in|" +
            "will begin|Unsupported URL|There is no video in this post|login required|redirect to login",
        RegexOption.IGNORE_CASE,
    )

    fun emit(job: Job, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - (lastEmit[job.id] ?: 0) < 400) return
        lastEmit[job.id] = now
        listener?.invoke(job)
    }

    private fun persist(job: Job) {
        val now = System.currentTimeMillis()
        if (now - (lastSave[job.id] ?: 0) < 3000) return
        lastSave[job.id] = now
        JobStore.save(job)
    }

    private fun summaryTick(ctx: Context) {
        val now = System.currentTimeMillis()
        if (now - lastSummary < 1000) return
        lastSummary = now
        Notifier.updateSummary(ctx)
    }

    fun enqueue(ctx: Context, request: JSONObject): Job {
        JobStore.init(ctx)
        val job = Job.fromRequest(UUID.randomUUID().toString(), request)
        JobStore.put(job)
        emit(job, true)
        start(ctx)
        return job
    }

    /** Make sure something drains the queue. */
    fun start(ctx: Context) {
        wake.trySend(Unit)
        if (draining) return
        Keepalive.start(ctx.applicationContext)
    }

    /** Runs until the queue is empty. Called by the user-initiated job / foreground service. */
    suspend fun drain(ctx: Context) = drainLock.withLock {
        draining = true
        try {
            while (true) {
                var waitingForWifi = false
                while (runs.size < Config.concurrency(ctx)) {
                    val next = JobStore.nextQueued() ?: break
                    if (Config.wifiOnly(ctx) && !Keepalive.unmetered(ctx)) {
                        waitingForWifi = true
                        break
                    }
                    next.status = "running"
                    next.progress = -1.0
                    next.error = null
                    next.line = null
                    JobStore.save(next)
                    emit(next, true)
                    runs[next.id] = scope.launch {
                        try {
                            runJob(ctx, next)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Throwable) {
                            fail(ctx, next, e.message ?: e.toString())
                        } finally {
                            runs.remove(next.id)
                            wake.trySend(Unit)
                        }
                    }
                }
                Notifier.updateSummary(ctx)
                // Nothing running: stop (jobs waiting for Wi-Fi start again when OnePlace is opened on Wi-Fi).
                if (runs.isEmpty() && (waitingForWifi || JobStore.nextQueued() == null)) break
                withTimeoutOrNull(5_000) { wake.receive() }
            }
        } finally {
            draining = false
            Notifier.clearSummary(ctx)
        }
    }

    private fun cleanup(dir: File) {
        dir.deleteRecursively()
    }

    private suspend fun runJob(ctx: Context, job: Job) {
        Engines.ensureReady(ctx)
        if (Config.autoEngineUpdate(ctx) && Engines.olderThan(Engines.ytdlpVersion(ctx), Config.minYtDlp(ctx))) {
            runCatching { Engines.updateYtDlp(ctx) }
        }
        val dir = File(ctx.cacheDir, "jobs/${job.id}")
        fun out() = File(dir, if (job.usedFallback) "b" else "a")
        var res = execute(ctx, job, job.template, out())
        if (job.status == "canceled") return cleanup(dir)
        if (job.status == "queued") return // paused by the system; resumes later from the .part files
        if (res.code != 0 && !job.usedFallback && job.fallback != null && NO_VIDEO.containsMatchIn(res.err)) {
            job.usedFallback = true
            res = execute(ctx, job, job.template, out())
        }
        if (res.code != 0 && job.template.engine == "ytdlp" && !job.healed && Config.autoEngineUpdate(ctx) && !USER_SIDE.containsMatchIn(res.err)) {
            job.healed = true
            job.line = Config.text(ctx, "updatingEngine", "Updating engine and trying again")
            emit(job, true)
            if (runCatching { Engines.updateYtDlp(ctx) }.getOrDefault(false)) res = execute(ctx, job, job.template, out())
        }
        if (job.status == "canceled") return cleanup(dir)
        if (job.status == "queued") return
        val outputs = if (res.code == 0) collect(out()) else emptyList()
        if (outputs.isEmpty()) {
            val why = if (res.code == 0) "Nothing was downloaded.\n${res.err.takeLast(2000)}" else res.err.ifBlank { "exit code ${res.code}" }
            fail(ctx, job, why)
        } else {
            job.files = outputs.map { Saver.publish(ctx, it) }
            if (job.titleFromFile) {
                job.title = Progress.titleOf(outputs.first().name)
                job.titleFromFile = false
            }
            job.status = "done"
            job.progress = 100.0
            job.eta = 0
            job.speed = null
            job.line = null
            job.finishedAt = System.currentTimeMillis()
            JobStore.save(job)
            emit(job, true)
            Notifier.done(ctx, job)
        }
        cleanup(dir)
    }

    private suspend fun execute(ctx: Context, job: Job, t: Template, dir: File): Runner.Result {
        dir.mkdirs()
        job.progress = -1.0
        job.eta = -1
        job.speed = null
        return when (t.engine) {
            "gallerydl" -> {
                var saved = 0
                val args = t.args + listOf("-D", dir.absolutePath) + Engines.cookieArgs(ctx, job.site) + job.url
                Runner.gallery(ctx, job.id, args) { line ->
                    // gallery-dl prints each saved file's path ("# " marks files it skipped)
                    if (line.startsWith("/") || line.startsWith("# /")) {
                        saved++
                        job.line = "$saved"
                        emit(job)
                        summaryTick(ctx)
                    }
                }
            }
            "http" -> withContext(Dispatchers.IO) {
                val err = HttpJob.run(job, dir) { p ->
                    job.progress = p
                    emit(job)
                }
                Runner.Result(if (err == null) 0 else 1, "", err ?: "", 0)
            }
            else -> {
                val tracker = Progress(Progress.streamsOf(t.args))
                val args = t.args +
                    listOf("-P", dir.absolutePath, "--cache-dir", Engines.cacheDir(ctx), "--progress-template", Progress.TEMPLATE) +
                    Engines.cookieArgs(ctx, job.site) + Config.siteArgs(ctx, job.site) + job.url
                Runner.ytdlp(ctx, job.id, args) { line ->
                    if (tracker.feed(line)) {
                        job.progress = tracker.percent
                        job.eta = tracker.eta
                        job.speed = tracker.speed
                        job.line = if (tracker.processing) line.take(120) else null
                        if (job.titleFromFile) tracker.destination?.let { job.title = Progress.titleOf(it) }
                        emit(job)
                        persist(job)
                        summaryTick(ctx)
                    }
                }
            }
        }
    }

    /** Finished files in a job folder (partial and temporary files are skipped). */
    private fun collect(dir: File): List<File> =
        dir.walkTopDown().filter { f ->
            f.isFile && f.length() > 0 && !f.name.startsWith(".") &&
                !f.name.endsWith(".part") && !f.name.endsWith(".ytdl") && !f.name.endsWith(".temp") &&
                !f.name.contains(".part-Frag") && !f.name.endsWith(".tmp") && !f.name.endsWith(".json")
        }.sortedBy { it.name }.toList()

    private fun fail(ctx: Context, job: Job, error: String) {
        job.status = "failed"
        job.error = error.takeLast(4000)
        job.line = null
        job.speed = null
        job.finishedAt = System.currentTimeMillis()
        JobStore.save(job)
        emit(job, true)
        Notifier.failed(ctx, job)
    }

    fun cancel(ctx: Context, id: String) {
        val job = JobStore.get(id) ?: return
        if (job.status != "running" && job.status != "queued") return
        val wasQueued = job.status == "queued"
        job.status = "canceled"
        job.speed = null
        job.line = null
        Runner.kill(id)
        JobStore.save(job)
        emit(job, true)
        Notifier.updateSummary(ctx)
        if (wasQueued) cleanup(File(ctx.cacheDir, "jobs/$id"))
    }

    fun retry(ctx: Context, id: String) {
        val job = JobStore.get(id) ?: return
        if (job.status == "running") return
        job.status = "queued"
        job.error = null
        job.progress = -1.0
        job.attempts++
        job.usedFallback = false
        job.healed = false
        job.files = emptyList()
        job.finishedAt = null
        JobStore.save(job)
        emit(job, true)
        Notifier.cancel(ctx, job)
        start(ctx)
    }

    fun remove(ctx: Context, ids: List<String>, deleteFiles: Boolean) {
        for (id in ids) {
            val job = JobStore.get(id) ?: continue
            cancel(ctx, id)
            if (deleteFiles) Saver.delete(ctx, job.files)
            Notifier.cancel(ctx, job)
            JobStore.remove(id)
            lastEmit.remove(id)
            lastSave.remove(id)
        }
    }

    /** The system is stopping us (time limit, low memory): stop running downloads and queue them again. */
    fun pauseRunning(ctx: Context) {
        JobStore.active().filter { it.status == "running" }.forEach { job ->
            job.status = "queued"
            job.speed = null
            Runner.kill(job.id)
            JobStore.save(job)
            emit(job, true)
        }
        Notifier.updateSummary(ctx)
    }
}

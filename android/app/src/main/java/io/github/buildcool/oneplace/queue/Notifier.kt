package io.github.buildcool.oneplace.queue

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.MainActivity
import io.github.buildcool.oneplace.R
import io.github.buildcool.oneplace.storage.Saver
import kotlin.math.roundToInt

/** Progress, finished and failed notifications. Texts come from the UI language (Config strings). */
object Notifier {
    const val SUMMARY_ID = 1001
    private const val CH_PROGRESS = "downloads"
    private const val CH_DONE = "finished"

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_PROGRESS, Config.text(ctx, "channel", "Downloads"), NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DONE, Config.text(ctx, "channelDone", "Finished downloads"), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    private fun canPost(ctx: Context) =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openApp(ctx: Context, req: Int, extra: String? = null): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (extra != null) i.putExtra("oneplace.tab", extra)
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** The ongoing notification that keeps downloads alive (foreground service / user-initiated job). */
    fun summary(ctx: Context): Notification {
        val active = JobStore.active()
        val running = active.filter { it.status == "running" }
        val first = running.firstOrNull() ?: active.firstOrNull()
        val known = running.filter { it.progress >= 0 }
        val pct = if (known.isEmpty()) -1 else known.map { it.progress }.average().roundToInt()
        val doing = if (first?.edit != null) Config.text(ctx, "aiWorking", "Removing vocals") else Config.text(ctx, "downloading", "Downloading")
        val title = if (active.size > 1) "$doing · ${active.size}" else doing
        val b = NotificationCompat.Builder(ctx, CH_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title)
            .setContentText(first?.title ?: Config.text(ctx, "waiting", "Waiting"))
            .setSubText(first?.speed)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(openApp(ctx, 1, "downloads"))
            .setProgress(100, pct.coerceAtLeast(0), pct < 0)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (first != null && first.status == "running") {
            b.addAction(0, Config.text(ctx, "cancel", "Cancel"), ActionReceiver.cancelIntent(ctx, first.id))
        }
        return b.build()
    }

    fun updateSummary(ctx: Context) {
        if (!canPost(ctx) || JobStore.active().isEmpty()) return
        runCatching { NotificationManagerCompat.from(ctx).notify(SUMMARY_ID, summary(ctx)) }
    }

    fun clearSummary(ctx: Context) {
        NotificationManagerCompat.from(ctx).cancel(SUMMARY_ID)
    }

    fun done(ctx: Context, job: Job) {
        if (!canPost(ctx)) return
        val file = job.files.firstOrNull() ?: return
        val req = job.id.hashCode()
        // In OnePlace's own player/viewer, or straight in another app (setting).
        val open = if (Config.openInApp(ctx)) {
            val i = Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(MainActivity.EXTRA_OPEN, job.id)
            PendingIntent.getActivity(ctx, req + 2, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else {
            PendingIntent.getActivity(ctx, req, Saver.openIntent(file), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        val share = PendingIntent.getActivity(
            ctx, req + 1, Saver.shareIntent(job.files, job.title), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CH_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(job.title)
            .setContentText(
                (if (job.edit != null) Config.text(ctx, "made", "Ready") else Config.text(ctx, "done", "Downloaded")) +
                    if (job.files.size > 1) " · ${job.files.size}" else "",
            )
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, Config.text(ctx, "open", "Open"), open)
            .addAction(0, Config.text(ctx, "share", "Share"), share)
            .setGroup("done")
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(req, n) }
    }

    fun failed(ctx: Context, job: Job) {
        if (!canPost(ctx)) return
        val reason = job.error?.lines()?.lastOrNull { it.contains("ERROR", true) || it.isNotBlank() }?.removePrefix("ERROR: ")?.take(160)
        val n = NotificationCompat.Builder(ctx, CH_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(Config.text(ctx, "failed", "Download failed"))
            .setContentText(job.title)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${job.title}\n${reason ?: ""}"))
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, job.id.hashCode(), "downloads"))
            .setGroup("failed")
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(job.id.hashCode(), n) }
    }

    fun cancel(ctx: Context, job: Job) {
        NotificationManagerCompat.from(ctx).cancel(job.id.hashCode())
    }
}

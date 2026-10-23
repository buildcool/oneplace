package io.github.buildcool.oneplace.queue

import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.annotation.RequiresApi
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.buildcool.oneplace.Config
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps OnePlace alive while the queue (which runs in-process, see Queue.start) downloads with the app
 * closed. Android 14+: a user-initiated data transfer job (no daily time limit). Older: a dataSync
 * foreground service.
 */
object Keepalive {
    fun ensure(ctx: Context) {
        if (DownloadService.active || (Build.VERSION.SDK_INT >= 34 && DownloadJobService.active)) return
        if (Build.VERSION.SDK_INT >= 34 && DownloadJobService.schedule(ctx)) return
        startService(ctx)
    }

    private fun startService(ctx: Context): Boolean = try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadService::class.java))
        true
    } catch (e: Exception) {
        // Not allowed from the background; the queue still runs while the process lives.
        false
    }

    fun unmetered(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
}

@RequiresApi(34)
class DownloadJobService : JobService() {
    private var scope: CoroutineScope? = null

    override fun onStartJob(params: JobParameters): Boolean {
        active = true
        setNotification(params, Notifier.SUMMARY_ID, Notifier.summary(this), JOB_END_NOTIFICATION_POLICY_REMOVE)
        val s = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { scope = it }
        s.launch {
            try {
                Queue.start(applicationContext)
                Queue.awaitIdle()
            } finally {
                active = false
                jobFinished(params, false)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        active = false
        Queue.hold(applicationContext)
        scope?.cancel()
        // Reschedule when there is still work; the next start resumes it.
        return JobStore.active().isNotEmpty()
    }

    companion object {
        private const val JOB_ID = 4242

        @Volatile
        var active = false

        fun schedule(ctx: Context): Boolean = try {
            val js = ctx.getSystemService(JobScheduler::class.java)
            val info = JobInfo.Builder(JOB_ID, ComponentName(ctx, DownloadJobService::class.java))
                .setUserInitiated(true)
                // Android's own "any network" request (works on VPNs too); Wi-Fi only when asked.
                .setRequiredNetworkType(if (Config.wifiOnly(ctx)) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_ANY)
                .setEstimatedNetworkBytes(JobInfo.NETWORK_BYTES_UNKNOWN.toLong(), JobInfo.NETWORK_BYTES_UNKNOWN.toLong())
                .build()
            js.schedule(info) == JobScheduler.RESULT_SUCCESS
        } catch (e: Exception) {
            // Not allowed right now (app not visible) → foreground service instead.
            false
        }

        /** For the engine test page. */
        fun pending(ctx: Context): Boolean = runCatching { ctx.getSystemService(JobScheduler::class.java).getPendingJob(JOB_ID) != null }.getOrDefault(false)
    }
}

class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, Notifier.SUMMARY_ID, Notifier.summary(this), type)
        if (!active) {
            active = true
            scope.launch {
                try {
                    Queue.start(applicationContext)
                    Queue.awaitIdle()
                } finally {
                    active = false
                    ServiceCompat.stopForeground(this@DownloadService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    /** Android 15: dataSync services get 6 hours a day. Pause cleanly when time is up. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Queue.hold(applicationContext)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        active = false
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        @Volatile
        var active = false
    }
}

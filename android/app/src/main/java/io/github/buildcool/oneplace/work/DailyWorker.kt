package io.github.buildcool.oneplace.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.buildcool.oneplace.Config
import io.github.buildcool.oneplace.engine.Engines
import java.util.concurrent.TimeUnit

/** Once a day on Wi-Fi: newest yt-dlp and gallery-dl, so sites keep working without an app update. */
class DailyWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (!Config.autoEngineUpdate(applicationContext)) return Result.success()
        runCatching { Engines.updateAll(applicationContext) }
        return Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<DailyWorker>(1, TimeUnit.DAYS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.UNMETERED)
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("engine-update", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

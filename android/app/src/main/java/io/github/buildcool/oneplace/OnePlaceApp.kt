package io.github.buildcool.oneplace

import android.app.Application
import io.github.buildcool.oneplace.queue.JobStore
import io.github.buildcool.oneplace.queue.Notifier
import io.github.buildcool.oneplace.work.DailyWorker

class OnePlaceApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        JobStore.init(this)
        runCatching { DailyWorker.schedule(this) }
    }
}

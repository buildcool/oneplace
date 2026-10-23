package io.github.buildcool.oneplace.queue

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Notification buttons that work without opening the app (Cancel). */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        if (intent.action == ACTION_CANCEL) Queue.cancel(ctx.applicationContext, id)
    }

    companion object {
        private const val ACTION_CANCEL = "io.github.buildcool.oneplace.CANCEL"
        private const val EXTRA_ID = "id"

        fun cancelIntent(ctx: Context, id: String): PendingIntent =
            PendingIntent.getBroadcast(
                ctx,
                id.hashCode(),
                Intent(ctx, ActionReceiver::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, id),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
    }
}

package io.github.buildcool.oneplace.player

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.annotation.RequiresApi
import java.lang.ref.WeakReference

/** The small floating video window (Android 8+). */
object Pip {
    const val ACTION = "io.github.buildcool.oneplace.PIP_TOGGLE"

    /** Go there by itself when the user leaves the app while a video plays. */
    @Volatile
    var auto = false
    var w = 16
    var h = 9
    var activity: WeakReference<Activity>? = null

    fun supported(ctx: Context) = Build.VERSION.SDK_INT >= 26 && ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    @RequiresApi(26)
    private fun params(ctx: Context): PictureInPictureParams {
        val playing = Playback.current()?.isPlaying == true
        val ratio = (w.toFloat() / h.coerceAtLeast(1)).let {
            when {
                it > 2.39f -> Rational(239, 100)
                it < 1 / 2.39f -> Rational(100, 239)
                else -> Rational(w.coerceAtLeast(1), h.coerceAtLeast(1))
            }
        }
        val icon = Icon.createWithResource("android", if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
        val label = if (playing) "Pause" else "Play"
        val toggle = PendingIntent.getBroadcast(ctx, 11, Intent(ACTION).setPackage(ctx.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = PictureInPictureParams.Builder().setAspectRatio(ratio).setActions(listOf(RemoteAction(icon, label, label, toggle)))
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(auto && VideoLayer.shown && playing).setSeamlessResizeEnabled(true)
        return b.build()
    }

    /** Keep the window's shape, button and "enter by itself" in step with the video. */
    fun update() {
        val a = activity?.get() ?: return
        if (Build.VERSION.SDK_INT < 26 || !supported(a)) return
        runCatching { a.setPictureInPictureParams(params(a)) }
    }

    fun enter(a: Activity?): Boolean {
        if (Build.VERSION.SDK_INT < 26 || a == null || !supported(a) || !VideoLayer.shown) return false
        return runCatching { a.enterPictureInPictureMode(params(a)) }.getOrDefault(false)
    }

    /** Android 8–11 do not enter by themselves: do it when the user presses Home. */
    fun onUserLeave(a: Activity) {
        if (Build.VERSION.SDK_INT in 26..30 && auto && Playback.current()?.isPlaying == true) enter(a)
    }

    fun active(a: Activity?): Boolean = Build.VERSION.SDK_INT >= 24 && a?.isInPictureInPictureMode == true
}

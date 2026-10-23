package io.github.buildcool.oneplace.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.IntentCompat
import io.github.buildcool.oneplace.EnginePlugin
import io.github.buildcool.oneplace.engine.Net
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Downloads the new APK from GitHub Releases and hands it to Android's package installer. */
object AppUpdater {
    suspend fun downloadAndInstall(ctx: Context, url: String, progress: (Double) -> Unit) = withContext(Dispatchers.IO) {
        val file = File(ctx.cacheDir, "update.apk")
        file.delete()
        Net.download(url, file, progress = progress)
        install(ctx, file)
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            // Android 12+: once OnePlace has installed itself, later updates may go through without a prompt.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("oneplace.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, 1 shl 16) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val intent = Intent(ctx, InstallReceiver::class.java).setAction("io.github.buildcool.oneplace.INSTALL")
            session.commit(PendingIntent.getBroadcast(ctx, 7, intent, flags).intentSender)
        }
    }
}

/** Installer callbacks: show Android's confirmation screen, or report the error to the UI. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { ctx.startActivity(confirm) }
            }
            PackageInstaller.STATUS_SUCCESS -> EnginePlugin.updateProgress(100.0, done = true)
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install failed ($status)"
                EnginePlugin.updateProgress(0.0, error = msg)
            }
        }
    }
}

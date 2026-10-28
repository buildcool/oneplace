package io.github.buildcool.oneplace

import android.Manifest
import android.app.StatusBarManager
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import io.github.buildcool.oneplace.engine.Engines
import io.github.buildcool.oneplace.engine.Net
import io.github.buildcool.oneplace.login.Cookies
import io.github.buildcool.oneplace.login.LoginActivity
import io.github.buildcool.oneplace.queue.DownloadJobService
import io.github.buildcool.oneplace.queue.DownloadService
import io.github.buildcool.oneplace.queue.JobStore
import io.github.buildcool.oneplace.queue.Keepalive
import io.github.buildcool.oneplace.queue.Queue
import io.github.buildcool.oneplace.share.CopiedLinkTile
import io.github.buildcool.oneplace.storage.Saver
import io.github.buildcool.oneplace.update.AppUpdater
import java.lang.ref.WeakReference
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Bridge between the web UI (src/engine/android.ts) and the native engine, queue, logins and updater.
 * Jobs and requests travel as JSON strings so both sides parse them the same way.
 */
@CapacitorPlugin(
    name = "Engine",
    permissions = [
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = "storage", strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE]),
    ],
)
class EnginePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val app: Context get() = context.applicationContext

    override fun load() {
        instance = WeakReference(this)
        JobStore.init(app)
        Queue.listener = { job -> instance?.get()?.emit("job", JSObject().put("json", job.toJson().toString())) }
        Engines.onStatus = { instance?.get()?.emit("status", statusObject()) }
        // Downloads that were interrupted or waiting: continue now that the app is open.
        if (JobStore.active().isNotEmpty()) Queue.start(app)
        applyQuickTargets()
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    fun emit(event: String, data: JSObject, retain: Boolean = false) = notifyListeners(event, data, retain)

    private fun statusObject(): JSObject = JSObject()
        .put("ready", Engines.ready)
        .put("preparing", Engines.preparing)
        .put("error", Engines.error)
        .put("ytdlp", Engines.ytdlpVersion(app))
        .put("gallerydl", Engines.galleryVersion(app))
        .put("abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
        .put("sdk", Build.VERSION.SDK_INT)
        .put("appVersion", BuildConfig.VERSION_NAME)
        .put("build", BuildConfig.VERSION_CODE)
        .put("maker", Build.MANUFACTURER ?: "")

    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(statusObject())
    }

    @PluginMethod
    fun prepare(call: PluginCall) {
        scope.launch {
            Engines.prepare(app)
            call.resolve(statusObject())
        }
    }

    @PluginMethod
    fun configure(call: PluginCall) {
        val json = call.getString("json") ?: return call.reject("json missing")
        try {
            Config.save(app, json)
        } catch (e: Exception) {
            return call.reject(e.message ?: "bad config")
        }
        applyQuickTargets()
        call.resolve()
    }

    @PluginMethod
    fun resolve(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url missing")
        scope.launch {
            val final = runCatching { Net.resolve(url) }.getOrDefault(url)
            call.resolve(JSObject().put("url", final))
        }
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url missing")
        val engine = call.getString("engine") ?: "ytdlp"
        val args = call.getArray("args")?.toList<String>() ?: emptyList()
        val site = call.getString("site") ?: "other"
        scope.launch {
            try {
                call.resolve(JSObject.fromJSONObject(Engines.info(app, url, engine, args, site)))
            } catch (e: CancellationException) {
                call.reject("canceled")
            } catch (e: Throwable) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    @PluginMethod
    fun cancelInfo(call: PluginCall) {
        Engines.cancelInfo()
        call.resolve()
    }

    @PluginMethod
    fun enqueue(call: PluginCall) {
        if (call.getString("json") == null) return call.reject("json missing")
        // Android 7–9 need the storage permission to save into Movies/Music/Pictures.
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageCallback")
            return
        }
        doEnqueue(call)
    }

    @PermissionCallback
    private fun storageCallback(call: PluginCall) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doEnqueue(call)
        else call.reject("Storage permission is needed to save downloads")
    }

    private fun doEnqueue(call: PluginCall) {
        try {
            val job = Queue.enqueue(app, JSONObject(call.getString("json")!!))
            call.resolve(JSObject().put("json", job.toJson().toString()))
        } catch (e: Exception) {
            call.reject(e.message ?: e.toString())
        }
    }

    @PluginMethod
    fun jobs(call: PluginCall) {
        call.resolve(JSObject().put("json", JSONArray(JobStore.all().map { it.toJson() }).toString()))
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        call.getString("id")?.let { Queue.cancel(app, it) }
        call.resolve()
    }

    @PluginMethod
    fun retry(call: PluginCall) {
        call.getString("id")?.let { Queue.retry(app, it) }
        call.resolve()
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>() ?: emptyList()
        Queue.remove(app, ids, call.getBoolean("deleteFiles", false) ?: false)
        call.resolve()
    }

    @PluginMethod
    fun open(call: PluginCall) {
        val job = call.getString("id")?.let { JobStore.get(it) } ?: return call.reject("not found")
        val file = job.files.getOrNull(call.getInt("index", 0) ?: 0) ?: return call.reject("no file")
        try {
            activity.startActivity(Saver.openIntent(file))
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "no app can open this file")
        }
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val job = call.getString("id")?.let { JobStore.get(it) } ?: return call.reject("not found")
        if (job.files.isEmpty()) return call.reject("no file")
        activity.startActivity(Saver.shareIntent(job.files, job.title))
        call.resolve()
    }

    @PluginMethod
    fun updateEngines(call: PluginCall) {
        scope.launch {
            try {
                val changed = Engines.updateAll(app)
                call.resolve(statusObject().put("changed", changed))
            } catch (e: Throwable) {
                call.reject(e.message ?: e.toString())
            }
        }
    }

    @PluginMethod
    fun login(call: PluginCall) {
        val intent = Intent(context, LoginActivity::class.java)
            .putExtra("url", call.getString("url"))
            .putExtra("title", call.getString("title"))
        startActivityForResult(call, intent, "loginResult")
    }

    @ActivityCallback
    private fun loginResult(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val site = call.getString("site") ?: return call.reject("site missing")
        val urls = call.getArray("cookieUrls")?.toList<String>() ?: emptyList()
        call.resolve(JSObject().put("saved", Cookies.export(app, site, urls)))
    }

    @PluginMethod
    fun logout(call: PluginCall) {
        val site = call.getString("site") ?: return call.reject("site missing")
        Cookies.clear(app, site, call.getArray("cookieUrls")?.toList<String>() ?: emptyList())
        call.resolve()
    }

    @PluginMethod
    fun sessions(call: PluginCall) {
        call.resolve(JSObject().put("sites", JSONArray(Cookies.sites(app))))
    }

    @PluginMethod
    fun downloadUpdate(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url missing")
        scope.launch {
            try {
                AppUpdater.downloadAndInstall(app, url) { p -> updateProgress(p) }
                call.resolve()
            } catch (e: Throwable) {
                updateProgress(0.0, error = e.message ?: e.toString())
                call.reject(e.message ?: e.toString())
            }
        }
    }

    @PluginMethod
    fun canInstall(call: PluginCall) {
        val ok = Build.VERSION.SDK_INT < 26 || app.packageManager.canRequestPackageInstalls()
        call.resolve(JSObject().put("value", ok))
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 26) {
            runCatching {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")))
            }
        }
        call.resolve()
    }

    /** The copied text and when it was copied. Android lets apps read it only while they are in front. */
    @PluginMethod
    fun clip(call: PluginCall) {
        val clip = runCatching { app.getSystemService(ClipboardManager::class.java)?.primaryClip }.getOrNull()
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(app)?.toString()
        val at = if (Build.VERSION.SDK_INT >= 26) clip?.description?.timestamp ?: 0L else 0L
        call.resolve(JSObject().put("text", text).put("at", at))
    }

    /** Android 13+ can add the Quick Settings tile after one confirmation; older phones add it by hand. */
    @PluginMethod
    fun addTile(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33) return call.resolve(JSObject().put("value", false))
        val sbm = app.getSystemService(StatusBarManager::class.java) ?: return call.resolve(JSObject().put("value", false))
        sbm.requestAddTileService(
            ComponentName(app, CopiedLinkTile::class.java),
            app.getString(R.string.tile_copied),
            Icon.createWithResource(app, R.drawable.ic_stat_download),
            app.mainExecutor,
        ) { result ->
            val added = result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ||
                result == StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED
            call.resolve(JSObject().put("value", added))
        }
    }

    @PluginMethod
    fun batteryOptimized(call: PluginCall) {
        val pm = app.getSystemService(PowerManager::class.java)
        call.resolve(JSObject().put("value", pm?.isIgnoringBatteryOptimizations(app.packageName) == false))
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        try {
            activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${app.packageName}")))
        } catch (e: Exception) {
            runCatching { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
        call.resolve()
    }

    @PluginMethod
    fun notificationsAllowed(call: PluginCall) {
        call.resolve(JSObject().put("value", NotificationManagerCompat.from(app).areNotificationsEnabled()))
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsCallback")
            return
        }
        if (!NotificationManagerCompat.from(app).areNotificationsEnabled() && Build.VERSION.SDK_INT >= 26) {
            runCatching {
                activity.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName))
            }
        }
        call.resolve(JSObject().put("value", NotificationManagerCompat.from(app).areNotificationsEnabled()))
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        call.resolve(JSObject().put("value", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    @PluginMethod
    fun systemColors(call: PluginCall) {
        val o = JSObject()
        if (Build.VERSION.SDK_INT >= 31) {
            o.put("light", hex(ContextCompat.getColor(app, android.R.color.system_accent1_600)))
            o.put("dark", hex(ContextCompat.getColor(app, android.R.color.system_accent1_200)))
        }
        call.resolve(o)
    }

    private fun hex(color: Int) = String.format(Locale.US, "#%06X", 0xFFFFFF and color)

    /** Queue and keep-alive state, shown on the engine test page to explain stuck downloads. */
    @PluginMethod
    fun debug(call: PluginCall) {
        val active = JobStore.active()
        val o = JSObject()
            .put("queueRunning", Queue.draining)
            .put("held", Queue.held)
            .put("queued", active.count { it.status == "queued" })
            .put("running", active.count { it.status == "running" })
            .put("serviceActive", DownloadService.active)
            .put("wifiOnly", Config.wifiOnly(app))
            .put("unmetered", Keepalive.unmetered(app))
            .put("notifications", NotificationManagerCompat.from(app).areNotificationsEnabled())
        if (Build.VERSION.SDK_INT >= 34) {
            o.put("userJobActive", DownloadJobService.active)
            o.put("userJobPending", DownloadJobService.pending(app))
        }
        call.resolve(o)
    }

    @PluginMethod
    fun pendingShare(call: PluginCall) {
        val text = Shares.pending
        Shares.pending = null
        call.resolve(JSObject().apply { if (text != null) put("text", text) })
    }

    /** Show or hide "OnePlace · Video / · MP3 / · Thumbnail" in the share menu. */
    private fun applyQuickTargets() {
        val state = if (Config.quickTargets(app)) PackageManager.COMPONENT_ENABLED_STATE_DEFAULT else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        val pm = app.packageManager
        for (name in listOf("QuickVideo", "QuickAudio", "QuickThumb")) {
            val cn = ComponentName(app, "${app.packageName}.$name")
            runCatching { if (pm.getComponentEnabledSetting(cn) != state) pm.setComponentEnabledSetting(cn, state, PackageManager.DONT_KILL_APP) }
        }
    }

    companion object {
        private var instance: WeakReference<EnginePlugin>? = null

        /** A share while the app is open. False when the UI is not up yet (MainActivity keeps it as pending). */
        fun deliverShare(text: String): Boolean {
            val p = instance?.get() ?: return false
            p.emit("shared", JSObject().put("text", text), retain = true)
            return true
        }

        fun updateProgress(progress: Double, done: Boolean = false, error: String? = null) {
            val data = JSObject().put("progress", progress).put("done", done)
            if (error != null) data.put("error", error)
            instance?.get()?.emit("updateProgress", data)
        }
    }
}

package io.github.buildcool.oneplace.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.provider.Settings
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.github.buildcool.oneplace.stream.Streams
import java.lang.ref.WeakReference
import kotlin.math.roundToInt

/**
 * Bridge for the built-in player (src/engine/player.ts): queue and controls, the video behind the page,
 * full screen, brightness, volume and the floating window.
 */
@CapacitorPlugin(name = "Player")
class PlayerPlugin : Plugin() {
    private val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            bridge?.executeOnMainThread { Playback.control(c, "toggle", 0.0) }
        }
    }

    override fun load() {
        instance = WeakReference(this)
        Pip.activity = WeakReference(activity)
        Playback.listener = { s -> notifyListeners("state", s) }
        Playback.onSkipped = { e -> notifyListeners("skipped", e) }
        Playback.onPlaying = { Pip.update() }
        ContextCompat.registerReceiver(context, pipReceiver, IntentFilter(Pip.ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    fun emit(event: String, data: JSObject) = notifyListeners(event, data)

    override fun handleOnDestroy() {
        runCatching { context.unregisterReceiver(pipReceiver) }
        Playback.listener = null
        Playback.onSkipped = null
        Playback.onPlaying = null
        VideoLayer.hide()
        Playback.disconnect()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val items = call.getArray("items") ?: return call.reject("items missing")
        val index = call.getInt("index", 0) ?: 0
        val position = ((call.getDouble("position", 0.0) ?: 0.0) * 1000).toLong()
        val video = call.getBoolean("video", false) ?: false
        // Stream quality limits per network (0: none).
        call.getObject("quality")?.let {
            Streams.capWifi = it.optInt("wifi", 0)
            Streams.capMobile = it.optInt("mobile", 720)
        }
        bridge.executeOnMainThread {
            try {
                Playback.load(context, items, index, position, video)
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "Could not play")
            }
        }
    }

    /** More items at the end of the queue (a radio's next songs, "Up next"). */
    @PluginMethod
    fun append(call: PluginCall) {
        val items = call.getArray("items") ?: return call.reject("items missing")
        bridge.executeOnMainThread {
            Playback.append(context, items)
            call.resolve()
        }
    }

    @PluginMethod
    fun control(call: PluginCall) {
        val action = call.getString("action") ?: return call.reject("action missing")
        val value = call.getDouble("value") ?: 0.0
        bridge.executeOnMainThread {
            Playback.control(context, action, value)
            call.resolve()
        }
    }

    @PluginMethod
    fun state(call: PluginCall) {
        bridge.executeOnMainThread { call.resolve(Playback.state()) }
    }

    @PluginMethod
    fun video(call: PluginCall) {
        val show = call.getBoolean("show", false) ?: false
        val fill = call.getBoolean("fill", false) ?: false
        bridge.executeOnMainThread {
            if (show) {
                Playback.withPlayer(context) { p ->
                    VideoLayer.show(activity, bridge.webView, p, fill)
                    if (!Playback.videoShown) Playback.setVideo(p, true)
                    Pip.update()
                }
            } else {
                VideoLayer.hide()
                Playback.current()?.let { Playback.setVideo(it, false) }
                Pip.update()
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun screen(call: PluginCall) {
        bridge.executeOnMainThread {
            val a = activity ?: return@executeOnMainThread call.reject("no screen")
            val window = a.window
            call.getString("orientation")?.let {
                a.requestedOrientation = when (it) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
            call.getBoolean("immersive")?.let { on ->
                val bars = WindowCompat.getInsetsController(window, window.decorView)
                if (on) {
                    bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    bars.hide(WindowInsetsCompat.Type.systemBars())
                } else {
                    bars.show(WindowInsetsCompat.Type.systemBars())
                }
            }
            call.getBoolean("keepOn")?.let { on ->
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            call.getDouble("brightness")?.let { b ->
                window.attributes = window.attributes.apply {
                    screenBrightness = if (b < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else b.toFloat().coerceIn(0.01f, 1f)
                }
            }
            val own = window.attributes.screenBrightness
            val now = if (own >= 0) own else runCatching { Settings.System.getInt(a.contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrDefault(0.5f)
            call.resolve(JSObject().put("brightness", now.toDouble().coerceIn(0.0, 1.0)))
        }
    }

    @PluginMethod
    fun volume(call: PluginCall) {
        val am = context.getSystemService(AudioManager::class.java) ?: return call.resolve(JSObject().put("value", 0.5))
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        call.getDouble("value")?.let { v ->
            runCatching { am.setStreamVolume(AudioManager.STREAM_MUSIC, (v * max).roundToInt().coerceIn(0, max), 0) }
        }
        call.resolve(JSObject().put("value", am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max))
    }

    @PluginMethod
    fun pip(call: PluginCall) {
        bridge.executeOnMainThread { call.resolve(JSObject().put("value", Pip.enter(activity))) }
    }

    @PluginMethod
    fun pipConfig(call: PluginCall) {
        Pip.auto = call.getBoolean("auto", false) ?: false
        Pip.w = (call.getInt("w", 16) ?: 16).coerceAtLeast(1)
        Pip.h = (call.getInt("h", 9) ?: 9).coerceAtLeast(1)
        bridge.executeOnMainThread {
            Pip.update()
            call.resolve()
        }
    }

    @PluginMethod
    fun pipActive(call: PluginCall) {
        bridge.executeOnMainThread { call.resolve(JSObject().put("value", Pip.active(activity))) }
    }

    companion object {
        private var instance: WeakReference<PlayerPlugin>? = null

        /** MainActivity: the floating window opened or closed. */
        fun pipChanged(active: Boolean) {
            instance?.get()?.emit("pip", JSObject().put("active", active))
        }
    }
}

package io.github.buildcool.oneplace

import android.content.Context
import io.github.buildcool.oneplace.queue.Template
import io.github.buildcool.oneplace.queue.strings
import org.json.JSONObject

/**
 * Settings the native side needs when the UI is closed (src/engine/types.ts NativeConfig).
 * The UI sends them with configure(); until then the defaults built into the APK are used.
 */
object Config {
    private const val PREFS = "oneplace"
    private const val KEY = "config"

    @Volatile
    private var cached: JSONObject? = null

    fun get(ctx: Context): JSONObject {
        cached?.let { return it }
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        val cfg = saved?.let { runCatching { JSONObject(it) }.getOrNull() } ?: defaults(ctx)
        cached = cfg
        return cfg
    }

    private fun defaults(ctx: Context): JSONObject =
        runCatching { JSONObject(ctx.assets.open("defaults.json").bufferedReader().use { it.readText() }) }.getOrElse { JSONObject() }

    fun save(ctx: Context, json: String) {
        val cfg = JSONObject(json)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, cfg.toString()).apply()
        cached = cfg
    }

    fun concurrency(ctx: Context) = get(ctx).optInt("concurrency", 2).coerceIn(1, 3)
    fun wifiOnly(ctx: Context) = get(ctx).optBoolean("wifiOnly", false)
    fun ytdlpChannel(ctx: Context): String = get(ctx).optString("ytdlpChannel", "nightly")
    fun autoEngineUpdate(ctx: Context) = get(ctx).optBoolean("autoEngineUpdate", true)
    fun quickTargets(ctx: Context) = get(ctx).optBoolean("quickTargets", true)
    fun minYtDlp(ctx: Context): String? = get(ctx).optString("minYtDlp").ifBlank { null }
    fun fastYouTube(ctx: Context) = get(ctx).optBoolean("fastYouTube", true)
    fun siteArgs(ctx: Context, site: String): List<String> = get(ctx).optJSONObject("siteArgs")?.optJSONArray(site).strings()

    /** Localised text for notifications and toasts. */
    fun text(ctx: Context, key: String, fallback: String): String =
        get(ctx).optJSONObject("strings")?.optString(key)?.ifBlank { null } ?: fallback

    class Quick(val main: Template, val fallback: Template?, val mode: String)

    fun quick(ctx: Context, action: String): Quick? {
        val q = get(ctx).optJSONObject("quick")?.optJSONObject(action) ?: return null
        val main = Template.from(q.optJSONObject("main")) ?: return null
        return Quick(main, Template.from(q.optJSONObject("fallback")), q.optString("mode", action))
    }
}

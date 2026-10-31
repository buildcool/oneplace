package io.github.buildcool.oneplace.browser

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * The browser's ad and tracker blocker. Blocked domains are kept as a sorted array of 64-bit hashes
 * (HaGeZi's lists, GPL-3.0: Light ≈ 77k domains ≈ 600 KB), so a lookup is a few binary searches: the
 * host and each parent domain. Site rules (Rules) add first-party ad paths such as YouTube's /pagead/.
 * The list in the APK is built by scripts/build-adblock.ts; a newer one is fetched about once a week.
 */
object AdBlock {
    private const val MAGIC = 0x4f504231 // "OPB1"
    private const val WEEK = 7L * 24 * 3600 * 1000
    private val LISTS = mapOf(
        "standard" to "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/light-onlydomains.txt",
        "strong" to "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/pro-onlydomains.txt",
    )

    @Volatile
    private var hashes = LongArray(0)

    @Volatile
    private var loadedLevel = ""

    /** "standard", "strong" or "off". */
    @Volatile
    var level = "standard"
        private set

    /** Sites where the user switched the blocker off. */
    private val allowed = ConcurrentHashMap.newKeySet<String>()

    /** Load the list for [newLevel] (remembered), or for the remembered strength. */
    fun init(ctx: Context, newLevel: String? = null) {
        val app = ctx.applicationContext
        val prefs = app.getSharedPreferences("browser", Context.MODE_PRIVATE)
        if (newLevel != null && newLevel != prefs.getString("adblock", "standard")) prefs.edit().putString("adblock", newLevel).apply()
        level = newLevel ?: prefs.getString("adblock", "standard") ?: "standard"
        if (allowed.isEmpty()) allowed += prefs.getStringSet("adblockOff", emptySet()).orEmpty()
        if (level == "off" || loadedLevel == level) return
        thread(name = "op-adblock") {
            val want = level
            val list = runCatching { load(app, want) }.getOrNull() ?: return@thread
            hashes = list
            loadedLevel = want
        }
    }

    private fun file(ctx: Context, level: String) = File(File(ctx.filesDir, "browser").apply { mkdirs() }, "block-$level.bin")

    private fun load(ctx: Context, level: String): LongArray {
        val f = file(ctx, level)
        if (f.length() > 8) runCatching { return f.inputStream().buffered().use { read(it) } }
        // Strong without its own download yet: start from the built-in list.
        return ctx.assets.open("browser/block-light.bin").buffered().use { read(it) }
    }

    fun read(input: InputStream): LongArray {
        val d = DataInputStream(input)
        require(d.readInt() == MAGIC) { "not a block list" }
        val n = d.readInt()
        require(n in 0..2_000_000) { "bad size" }
        return LongArray(n) { d.readLong() }
    }

    fun write(sorted: LongArray, out: File) {
        val tmp = File(out.path + ".tmp")
        DataOutputStream(tmp.outputStream().buffered()).use { d ->
            d.writeInt(MAGIC)
            d.writeInt(sorted.size)
            sorted.forEach { d.writeLong(it) }
        }
        if (!tmp.renameTo(out)) tmp.delete()
    }

    /** FNV-1a 64 of the lower-case host; scripts/adblock.ts computes the same numbers. */
    fun hash(s: String): Long {
        var h = -0x340d631b7bdddcdbL
        for (b in s.toByteArray(Charsets.UTF_8)) {
            h = h xor (b.toLong() and 0xff)
            h *= 0x100000001b3L
        }
        return h
    }

    /** One domain per line ("# comments" and blank lines skipped) → sorted unique hashes. */
    fun parse(text: String): LongArray {
        val out = LongArray(text.length / 8 + 1)
        var n = 0
        for (raw in text.lineSequence()) {
            val line = raw.trim().removePrefix("*.").removePrefix("||").removeSuffix("^").lowercase()
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("!") || ' ' in line || '.' !in line) continue
            out[n++] = hash(line)
        }
        val arr = out.copyOf(n)
        arr.sort()
        return arr.distinct().toLongArray()
    }

    fun contains(list: LongArray, host: String): Boolean {
        var h = host.lowercase().trimEnd('.')
        while (true) {
            if (list.binarySearch(hash(h)) >= 0) return true
            val dot = h.indexOf('.')
            // Stop before testing a bare top-level domain ("com").
            if (dot < 0 || h.indexOf('.', dot + 1) < 0) return false
            h = h.substring(dot + 1)
        }
    }

    fun isAllowed(pageHost: String?): Boolean = pageHost != null && allowed.any { pageHost == it || pageHost.endsWith(".$it") }

    fun setAllowed(ctx: Context, host: String, allow: Boolean) {
        if (allow) allowed += host else allowed -= host
        ctx.getSharedPreferences("browser", Context.MODE_PRIVATE).edit().putStringSet("adblockOff", HashSet(allowed)).apply()
    }

    /** Should this request from a page on [pageHost] be stopped? Pages themselves (main frame) never are. */
    fun blocks(url: Uri, pageHost: String?, rules: Rules.Parsed): Boolean {
        if (level == "off") return false
        val host = url.host ?: return false
        if (isAllowed(pageHost)) return false
        if (contains(hashes, host)) return true
        val path = url.encodedPath ?: return false
        return rules.blockPaths.any { (h, re) -> (host == h || host.endsWith(".$h")) && re.containsMatchIn(path) }
    }

    /** About once a week (on the daily job): the newest list for the chosen strength. */
    fun refresh(ctx: Context, force: Boolean = false): Boolean {
        val want = level.takeIf { it != "off" } ?: return false
        val f = file(ctx, want)
        if (!force && f.length() > 8 && System.currentTimeMillis() - f.lastModified() < WEEK) return false
        val url = LISTS[want] ?: return false
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
        }
        try {
            if (c.responseCode != 200) return false
            val buf = ByteArrayOutputStream()
            c.inputStream.use { input ->
                val chunk = ByteArray(1 shl 16)
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    buf.write(chunk, 0, n)
                    if (buf.size() > 24 shl 20) return false
                }
            }
            val list = parse(buf.toString("UTF-8"))
            if (list.size < 1000) return false
            write(list, f)
            if (level == want) {
                hashes = list
                loadedLevel = want
            }
            return true
        } finally {
            c.disconnect()
        }
    }
}

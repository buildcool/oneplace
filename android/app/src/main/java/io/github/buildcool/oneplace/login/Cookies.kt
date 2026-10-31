package io.github.buildcool.oneplace.login

import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import java.io.File

/**
 * In-app logins become Netscape cookies.txt files (one per site) that yt-dlp and gallery-dl read with
 * --cookies. They stay in app-private storage (backups are off) and are never logged.
 */
object Cookies {
    /** The cookie that proves a real login, so "logged in" is honest. */
    private val LOGIN_COOKIE = mapOf(
        "instagram" to listOf("sessionid"),
        "facebook" to listOf("c_user"),
        "x" to listOf("auth_token"),
        "youtube" to listOf("SAPISID", "__Secure-3PAPISID", "LOGIN_INFO"),
        "tiktok" to listOf("sessionid", "sessionid_ss"),
        "reddit" to listOf("reddit_session", "token_v2"),
        "pinterest" to listOf("_pinterest_sess"),
        "threads" to listOf("sessionid"),
    )

    /** YouTube Music shares YouTube's login. */
    private fun key(site: String) = if (site == "ytmusic") "youtube" else site

    fun dir(ctx: Context) = File(ctx.filesDir, "cookies").apply { mkdirs() }

    fun file(ctx: Context, site: String): File? = File(dir(ctx), "${key(site)}.txt").takeIf { it.length() > 0 }

    fun sites(ctx: Context): List<String> =
        dir(ctx).listFiles()?.filter { it.name.endsWith(".txt") && it.length() > 0 }?.map { it.nameWithoutExtension }
            ?.flatMap { if (it == "youtube") listOf("youtube", "ytmusic") else listOf(it) } ?: emptyList()

    /** Save the WebView cookies of [urls]. True when the site's login cookie is among them. */
    fun export(ctx: Context, site: String, urls: List<String>): Boolean {
        val cm = CookieManager.getInstance()
        cm.flush()
        val expiry = System.currentTimeMillis() / 1000 + 180L * 24 * 3600
        val seen = HashSet<String>()
        val names = HashSet<String>()
        val lines = ArrayList<String>()
        for (u in urls) {
            val host = Uri.parse(u).host ?: continue
            val raw = cm.getCookie(u) ?: continue
            val domain = "." + baseDomain(host)
            for (part in raw.split(';')) {
                val i = part.indexOf('=')
                if (i <= 0) continue
                val name = part.substring(0, i).trim()
                if (!seen.add("$domain\t$name")) continue
                names += name
                lines += line(domain, name, part.substring(i + 1).trim(), expiry)
            }
        }
        val f = File(dir(ctx), "${key(site)}.txt")
        val loggedIn = LOGIN_COOKIE[key(site)]?.any { it in names } ?: lines.isNotEmpty()
        if (!loggedIn) {
            f.delete()
            return false
        }
        f.writeText(render(lines))
        return true
    }

    fun clear(ctx: Context, site: String, urls: List<String>) {
        File(dir(ctx), "${key(site)}.txt").delete()
        val cm = CookieManager.getInstance()
        for (u in urls) {
            val host = Uri.parse(u).host ?: continue
            cm.getCookie(u)?.split(';')?.forEach { part ->
                val name = part.substringBefore('=').trim()
                if (name.isEmpty()) return@forEach
                cm.setCookie(u, "$name=; Max-Age=0; Path=/")
                cm.setCookie(u, "$name=; Max-Age=0; Path=/; Domain=.${baseDomain(host)}")
            }
        }
        cm.flush()
    }

    /**
     * The browser's cookies for some addresses as a cookies.txt for one download (a file found on a page
     * may need the page's login). Each host keeps its own cookies. Null when there are none.
     */
    fun forUrls(urls: List<String>, out: File, cookieOf: (String) -> String?): File? {
        val expiry = System.currentTimeMillis() / 1000 + 24 * 3600
        val seen = HashSet<String>()
        val lines = ArrayList<String>()
        for (u in urls) {
            val host = runCatching { java.net.URI(u).host }.getOrNull() ?: continue
            val raw = cookieOf(u) ?: continue
            for (part in raw.split(';')) {
                val i = part.indexOf('=')
                if (i <= 0) continue
                val name = part.substring(0, i).trim()
                if (!seen.add("$host\t$name")) continue
                lines += line(".$host", name, part.substring(i + 1).trim(), expiry)
            }
        }
        if (lines.isEmpty()) return null
        out.writeText(render(lines))
        return out
    }

    /** "www.instagram.com" → "instagram.com". */
    fun baseDomain(host: String): String = host.split('.').takeLast(2).joinToString(".")

    fun line(domain: String, name: String, value: String, expiry: Long): String =
        listOf(domain, "TRUE", "/", "TRUE", expiry.toString(), name, value).joinToString("\t")

    fun render(lines: List<String>): String =
        "# Netscape HTTP Cookie File\n# Saved by OnePlace from your in-app login.\n" + lines.joinToString("\n") + "\n"
}

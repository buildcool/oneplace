package io.github.buildcool.oneplace

import io.github.buildcool.oneplace.browser.AdBlock
import io.github.buildcool.oneplace.browser.Rules
import io.github.buildcool.oneplace.browser.Sniffer
import io.github.buildcool.oneplace.browser.isPrivateHost
import io.github.buildcool.oneplace.login.Cookies
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserLogicTest {
    // ---------- ad blocker ----------

    @Test
    fun hashesLikeTheBuildScript() {
        // FNV-1a 64 test vectors (scripts/adblock.ts checks the same ones).
        assertEquals(0xcbf29ce484222325uL.toLong(), AdBlock.hash(""))
        assertEquals(0xaf63dc4c8601ec8cuL.toLong(), AdBlock.hash("a"))
        assertEquals(0x85944171f73967e8uL.toLong(), AdBlock.hash("foobar"))
    }

    @Test
    fun blocksListedDomainsAndTheirSubdomainsOnly() {
        val list = AdBlock.parse("# comment\n\ndoubleclick.net\n*.tracker.example\n||ads.site.in^\nlocalhost\n")
        assertEquals(3, list.size)
        assertTrue(AdBlock.contains(list, "doubleclick.net"))
        assertTrue(AdBlock.contains(list, "securepubads.g.doubleclick.net"))
        assertTrue(AdBlock.contains(list, "x.tracker.example"))
        assertTrue(AdBlock.contains(list, "ADS.site.in."))
        assertFalse(AdBlock.contains(list, "site.in"))
        assertFalse(AdBlock.contains(list, "notdoubleclick.net"))
        assertFalse(AdBlock.contains(LongArray(0), "doubleclick.net"))
    }

    @Test
    fun blockListFileRoundTrip() {
        val list = AdBlock.parse("a.com\nb.com\nc.org\n")
        val f = File.createTempFile("block", ".bin")
        AdBlock.write(list, f)
        val back = f.inputStream().use { AdBlock.read(it) }
        assertTrue(list.contentEquals(back))
        // Not a block list: refused.
        assertTrue(runCatching { AdBlock.read(ByteArrayInputStream(ByteArray(16))) }.isFailure)
        f.delete()
    }

    // ---------- requests a page makes ----------

    @Test
    fun spotsMediaFilesAndStreamsButNotPieces() {
        assertEquals("hls", Sniffer.classify("https://cdn.news.com/live/master.m3u8?token=1", null)?.stream)
        assertEquals("dash", Sniffer.classify("https://cdn.news.com/v/manifest.mpd", null)?.stream)
        assertEquals("video", Sniffer.classify("https://cdn.news.com/clip.MP4?sig=2", null)?.kind)
        assertEquals("audio", Sniffer.classify("http://songs.example/x/track.mp3", null)?.kind)
        assertNull(Sniffer.classify("https://cdn.news.com/seg-12.ts", null))
        assertNull(Sniffer.classify("https://cdn.news.com/v/chunk-3.m4s", null))
        assertNull(Sniffer.classify("https://video.cdn/v.mp4?bytestart=0&byteend=900", null))
        assertNull(Sniffer.classify("https://rr1---sn-x.googlevideo.com/videoplayback?itag=18", null))
        assertNull(Sniffer.classify("https://example.com/page.html", null))
        assertNull(Sniffer.classify("data:video/mp4;base64,AAAA", null))
        // A media element asks for a range from the start: worth asking about.
        assertEquals("file", Sniffer.classify("https://cdn.x/stream?id=9", mapOf("Range" to "bytes=0-"))?.kind)
        assertEquals(Sniffer.keyOf("https://cdn.x/a/b.mp4?sig=1"), Sniffer.keyOf("https://cdn.x/a/b.mp4?sig=2"))
        assertEquals(Triple("https", "cdn.x", "/a/b.mp4"), Sniffer.parts("https://user@CDN.x:443/a/b.mp4?q#f"))
    }

    @Test
    fun readsHlsQualitiesLengthAndDrm() {
        val master = """
            #EXTM3U
            #EXT-X-INDEPENDENT-SEGMENTS
            #EXT-X-MEDIA:URI="https://m.example/audio/233.m3u8",TYPE=AUDIO,GROUP-ID="233",NAME="Default",DEFAULT=YES
            #EXT-X-STREAM-INF:BANDWIDTH=300694,CODECS="avc1.4D4015,mp4a.40.5",RESOLUTION=426x240,FRAME-RATE=25,AUDIO="233"
            https://m.example/v/240.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=4688074,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25,AUDIO="234"
            v/1080.m3u8
        """.trimIndent()
        val hls = Sniffer.parseHls(master, "https://m.example/master.m3u8")
        assertTrue(hls.master)
        assertFalse(hls.audioOnly)
        assertFalse(hls.drm)
        assertEquals(listOf(240, 1080), hls.variants.map { it.height })
        assertEquals("https://m.example/v/1080.m3u8", hls.variants[1].uri)

        val media = "#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:5.24,\nseg1.ts\n#EXTINF:5.16,\nseg2.ts\n#EXT-X-ENDLIST\n"
        val m = Sniffer.parseHls(media, "https://m.example/v.m3u8")
        assertFalse(m.master)
        assertEquals(10.4, m.duration, 0.001)

        val audio = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS=\"mp4a.40.2\"\na.m3u8\n"
        assertTrue(Sniffer.parseHls(audio, "https://x/").audioOnly)

        // Ordinary HLS encryption is not DRM; SAMPLE-AES and DRM key formats are.
        assertFalse(Sniffer.drmKey("#EXT-X-KEY:METHOD=AES-128,URI=\"https://k/key\""))
        assertFalse(Sniffer.drmKey("#EXT-X-KEY:METHOD=NONE"))
        assertTrue(Sniffer.drmKey("#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://x\",KEYFORMAT=\"com.apple.streamingkeydelivery\""))
        assertTrue(Sniffer.drmKey("#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT=\"urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed\""))
        assertTrue(Sniffer.parseHls("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"x\"\n#EXTINF:4,\ns.ts\n", "https://x/").drm)
    }

    @Test
    fun readsDashVersionsLengthAndDrm() {
        val mpd = """
            <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M3.5S">
              <Period><AdaptationSet mimeType="video/mp4">
                <Representation id="1" bandwidth="800000" width="854" height="480"/>
                <Representation id="2" bandwidth="2500000" width="1280" height="720"/>
              </AdaptationSet></Period>
            </MPD>
        """.trimIndent()
        val o = Sniffer.dashItem("https://x/m.mpd", mpd)!!
        assertEquals("video", o.getString("kind"))
        assertEquals(64L, o.getLong("dur"))
        assertEquals(720, o.getInt("h"))
        assertEquals(2, o.getJSONArray("variants").length())
        assertFalse(o.has("drm"))
        val locked = mpd.replace("<Period>", "<Period><ContentProtection schemeIdUri=\"urn:uuid:x\"/>")
        assertTrue(Sniffer.dashItem("https://x/m.mpd", locked)!!.getBoolean("drm"))
        assertNull(Sniffer.dashItem("https://x/m.mpd", "<html></html>"))
        assertEquals(3723.5, Sniffer.isoSeconds("PT1H2M3.5S"), 0.001)
        assertEquals("My Song", Sniffer.fileName("attachment; filename=\"My Song.mp3\""))
        assertEquals("Na me", Sniffer.fileName("attachment; filename*=UTF-8''Na%20me.mp4"))
    }

    // ---------- rules from the network ----------

    @Test
    fun keepsOnlySafeRules() {
        val r = Rules.parse(
            JSONObject()
                .put("blockPaths", org.json.JSONArray().put(JSONObject().put("host", "youtube.com").put("path", "^/pagead/")).put(JSONObject().put("host", "bad host").put("path", "x")).put(JSONObject().put("host", "a.com").put("path", "(")))
                .put("hide", JSONObject().put("youtube.com", org.json.JSONArray().put(".ad").put("a{color:red}").put("input[value^=\"a\"]").put("x[style*=url(a)]")).put("NOT A HOST", org.json.JSONArray().put(".x")))
                .put("links", JSONObject().put("instagram.com", "a[href*='/reel/']"))
                .put("prune", JSONObject().put("youtube.com", org.json.JSONArray().put("playerResponse.adPlacements").put("bad-key!")))
                .put("ua", JSONObject().put("music.youtube.com", "chrome").put("x.com", "Mozilla/5.0 evil"))
                .toString(),
        )
        assertEquals(listOf("youtube.com"), r.blockPaths.map { it.first })
        assertEquals(listOf(".ad", "input[value^=\"a\"]"), r.hide["youtube.com"])
        assertEquals(setOf("youtube.com"), r.hide.keys)
        assertEquals("a[href*='/reel/']", r.links["instagram.com"])
        assertEquals(listOf("playerResponse.adPlacements"), r.prune["youtube.com"])
        assertEquals("chrome", r.uaFor("music.youtube.com"))
        assertNull(r.uaFor("x.com"))
        assertTrue(r.pageJson(false).contains("\"takeover\":false"))
        assertTrue(Rules.parse("not json").hide.isEmpty())
    }

    @Test
    fun pagesCantReachThePhoneOrHomeNetwork() {
        listOf("localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.3.4", "169.254.1.1", "[::1]", "fd00::1", "a.localhost").forEach {
            assertTrue(it, isPrivateHost(it))
        }
        listOf("youtube.com", "8.8.8.8", "172.32.0.1", "fc2.com", "fd.example", null).forEach {
            assertFalse(it.toString(), isPrivateHost(it))
        }
    }

    // ---------- downloads found in the browser ----------

    @Test
    fun writesTheBrowsersCookiesForOneDownload() {
        val dir = Files.createTempDirectory("ck").toFile()
        val jar = mapOf("https://www.site.com/p/1" to "sid=abc; theme=dark", "https://cdn.site.com/v.mp4" to "edge=1")
        val f = Cookies.forUrls(jar.keys.toList() + "https://none.com/", File(dir, ".cookies.txt")) { jar[it] }
        assertNotNull(f)
        val text = f!!.readText()
        assertTrue(text.startsWith("# Netscape HTTP Cookie File"))
        assertTrue(text.contains(".www.site.com\tTRUE\t/\tTRUE\t"))
        assertTrue(text.contains("\tsid\tabc"))
        assertTrue(text.contains(".cdn.site.com\tTRUE\t/\tTRUE\t"))
        assertNull(Cookies.forUrls(listOf("https://none.com/"), File(dir, "x.txt")) { null })
        dir.deleteRecursively()
    }
}

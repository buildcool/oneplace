package io.github.buildcool.oneplace

import io.github.buildcool.oneplace.engine.Engines
import io.github.buildcool.oneplace.engine.Progress
import io.github.buildcool.oneplace.login.Cookies
import io.github.buildcool.oneplace.queue.Job
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineLogicTest {
    @Test
    fun progressMergesVideoThenAudio() {
        val p = Progress(2)
        p.feed("[download] Destination: /x/Title.f137.mp4")
        p.feed("[op] 50 100 1048576 10")
        assertEquals(42.5, p.percent, 0.01)
        assertEquals("1.0 MB/s", p.speed)
        assertEquals(10L, p.eta)
        p.feed("[op] 100 100 1048576 0")
        p.feed("[download] Destination: /x/Title.f140.m4a")
        p.feed("[op] 50 100 NA NA")
        assertEquals(92.5, p.percent, 0.01)
        assertFalse(p.processing)
        p.feed("[Merger] Merging formats into \"/x/Title.mp4\"")
        assertTrue(p.processing)
        assertEquals("Title.f140.m4a", p.destination)
    }

    @Test
    fun progressSplitsPlaylists() {
        val p = Progress(1)
        p.feed("[download] Downloading item 2 of 4")
        p.feed("[download] Destination: /x/a.webm")
        p.feed("[op] 50 100 NA NA")
        assertEquals(37.5, p.percent, 0.01)
    }

    @Test
    fun progressIgnoresUnknownSizes() {
        val p = Progress(1)
        p.feed("[op] 1000 NA 2000 NA")
        assertEquals(-1.0, p.percent, 0.0)
        assertEquals(-1L, p.eta)
    }

    @Test
    fun streamCount() {
        assertEquals(2, Progress.streamsOf(listOf("-f", "137+140/137+ba/137/bv*+ba/b")))
        assertEquals(2, Progress.streamsOf(listOf("-f", "bv*+ba/b")))
        assertEquals(1, Progress.streamsOf(listOf("-f", "18/bv*+ba/b")))
        assertEquals(1, Progress.streamsOf(listOf("-f", "ba/b", "-x")))
        assertEquals(1, Progress.streamsOf(listOf("--skip-download")))
    }

    @Test
    fun titlesFromFileNames() {
        assertEquals("Song Name", Progress.titleOf("Song Name.f251.webm"))
        assertEquals("Song Name", Progress.titleOf("Song Name.mp3"))
        assertEquals("v1.2 demo", Progress.titleOf("v1.2 demo.mp4"))
    }

    @Test
    fun netscapeCookies() {
        assertEquals(".instagram.com\tTRUE\t/\tTRUE\t123\tsessionid\tabc", Cookies.line(".instagram.com", "sessionid", "abc", 123))
        assertEquals("instagram.com", Cookies.baseDomain("www.instagram.com"))
        assertTrue(Cookies.render(listOf("x")).startsWith("# Netscape HTTP Cookie File\n"))
    }

    @Test
    fun jobSurvivesTheDatabase() {
        val request = JSONObject()
            .put("url", "https://youtu.be/dQw4w9WgXcQ")
            .put("site", "youtube")
            .put("mode", "audio")
            .put("engine", "ytdlp")
            .put("args", JSONArray(listOf("-f", "ba/b", "-x")))
            .put("dest", "audio")
            .put("fallback", JSONObject().put("engine", "gallerydl").put("args", JSONArray(listOf("--no-mtime"))).put("dest", "image"))
        val job = Job.fromRequest("id1", request)
        assertTrue(job.titleFromFile)
        val back = Job.fromStore(JSONObject(job.toStoreJson().toString()))
        assertEquals(listOf("-f", "ba/b", "-x"), back.main.args)
        assertEquals("gallerydl", back.fallback?.engine)
        assertEquals("audio", back.dest)
        back.usedFallback = true
        assertEquals("image", back.dest)
    }

    @Test
    fun ytdlpVersions() {
        assertTrue(Engines.olderThan("2025.11.12", "2026.01.01"))
        assertFalse(Engines.olderThan("2026.10.21.232909", "2026.10.21"))
        assertFalse(Engines.olderThan(null, "2026.10.21"))
    }
}

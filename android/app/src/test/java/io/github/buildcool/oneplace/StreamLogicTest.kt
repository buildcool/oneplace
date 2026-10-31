package io.github.buildcool.oneplace

import io.github.buildcool.oneplace.stream.ChunkedDataSource
import io.github.buildcool.oneplace.stream.SponsorBlock
import io.github.buildcool.oneplace.stream.StreamPicker
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamLogicTest {
    private fun fmt(id: String, protocol: String, vcodec: String, acodec: String, height: Int = 0, tbr: Double = 0.0, extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("format_id", id).put("url", "https://rr1---sn-x.googlevideo.com/videoplayback?itag=$id").put("protocol", protocol)
            .put("vcodec", vcodec).put("acodec", acodec).put("tbr", tbr).apply { if (height > 0) put("height", height) }
            .put("http_headers", JSONObject().put("User-Agent", "UA $id").put("Accept", "*/*"))
            .apply(extra)

    /** The shape of yt-dlp's answer with YouTube's quick client (2026-10-30): HLS for every quality, plus https files. */
    private fun youtube(): JSONObject {
        val hls = { id: String, h: Int, v: String, a: String ->
            fmt(id, "m3u8_native", v, a, h) { put("manifest_url", "https://manifest.googlevideo.com/api/manifest/hls_variant/expire/1/id/x/file/index.m3u8") }
        }
        return JSONObject().put("id", "dQw4w9WgXcQ").put("duration", 213).put(
            "formats",
            JSONArray()
                .put(hls("233", 0, "none", "mp4a.40.5"))
                .put(fmt("140", "https", "none", "mp4a.40.2", tbr = 129.5) { put("ext", "m4a").put("downloader_options", JSONObject().put("http_chunk_size", 10485760)) })
                .put(fmt("251", "https", "none", "opus", tbr = 128.9) { put("ext", "webm") })
                .put(hls("270", 1080, "avc1.640028", "none"))
                .put(fmt("137", "https", "avc1.640028", "none", 1080, 3038.0))
                .put(fmt("399", "https", "av01.0.08M.08", "none", 1080, 1142.0)),
        )
    }

    @Test
    fun youtubeVideosPlayFromTheHlsPlaylist() {
        val p = StreamPicker.pick(youtube(), audioOnly = false, cap = 0)!!
        assertEquals("hls", p.kind)
        assertTrue(p.url.contains("hls_variant"))
        assertEquals("UA 233", p.headers["User-Agent"])
    }

    @Test
    fun songsPlayTheBestSoundOnlyFileInPieces() {
        val p = StreamPicker.pick(youtube(), audioOnly = true, cap = 0)!!
        assertEquals("file", p.kind)
        assertTrue(p.url.endsWith("itag=140"))
        assertTrue(p.chunked)
    }

    @Test
    fun otherSitesJoinPictureAndSoundOrUseOneFile() {
        val site = JSONObject().put(
            "formats",
            JSONArray()
                .put(fmt("sd", "https", "avc1", "mp4a", 360, 600.0))
                .put(fmt("v720", "https", "avc1.4d401f", "none", 720, 1500.0))
                .put(fmt("v1080av1", "https", "av01", "none", 1080, 1400.0))
                .put(fmt("v1080", "https", "avc1.640028", "none", 1080, 3000.0))
                .put(fmt("a", "https", "none", "mp4a", tbr = 128.0)),
        )
        val best = StreamPicker.pick(site, audioOnly = false, cap = 0)!!
        assertEquals("merge", best.kind)
        // H.264 before AV1 at the same height (hardware decoding on every phone).
        assertTrue(best.url.endsWith("itag=v1080"))
        assertTrue(best.audioUrl!!.endsWith("itag=a"))
        assertEquals(1080, best.height)
        // Mobile data limit: the 720p picture.
        assertTrue(StreamPicker.pick(site, false, 720)!!.url.endsWith("itag=v720"))
        // Limit below everything with sound: the one file with both.
        val small = StreamPicker.pick(site, false, 360)!!
        assertEquals("file", small.kind)
        assertTrue(small.url.endsWith("itag=sd"))
    }

    @Test
    fun streamsOfOtherSitesAndOddAnswers() {
        val hlsOnly = JSONObject().put("formats", JSONArray().put(fmt("hls-720", "m3u8_native", "avc1", "mp4a", 720)).put(fmt("hls-1080", "m3u8_native", "avc1", "mp4a", 1080)))
        val p = StreamPicker.pick(hlsOnly, false, 720)!!
        assertEquals("hls", p.kind)
        assertTrue(p.url.endsWith("itag=hls-720"))
        // A direct file: yt-dlp gives no formats list, the answer itself is the format.
        val direct = JSONObject().put("url", "https://cdn.x/a.mp4").put("ext", "mp4")
        assertEquals("https://cdn.x/a.mp4", StreamPicker.pick(direct, false, 0)!!.url)
        assertNull(StreamPicker.pick(JSONObject().put("formats", JSONArray()), false, 0))
        assertEquals("dQw4w9WgXcQ", StreamPicker.youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RD"))
        assertEquals("abcdefghijk", StreamPicker.youtubeId("https://youtu.be/abcdefghijk"))
        assertNull(StreamPicker.youtubeId("https://vimeo.com/123"))
    }

    @Test
    fun readsLongFilesInTenMegabytePieces() {
        val mb10 = ChunkedDataSource.CHUNK
        assertEquals(mb10, ChunkedDataSource.nextLength(0, ChunkedDataSource.UNSET, mb10))
        assertEquals(500L, ChunkedDataSource.nextLength(1000, 1500, mb10))
        // A full piece with more to come.
        assertTrue(ChunkedDataSource.more(mb10, mb10, ChunkedDataSource.UNSET, 25 * 1024 * 1024L))
        // A short piece: the file ended.
        assertFalse(ChunkedDataSource.more(900, mb10, ChunkedDataSource.UNSET, ChunkedDataSource.UNSET))
        // Reached the size the server told.
        assertFalse(ChunkedDataSource.more(mb10, mb10, ChunkedDataSource.UNSET, mb10))
        // Reached the end the player asked for.
        assertFalse(ChunkedDataSource.more(2000, 2000, 2000, ChunkedDataSource.UNSET))
        assertEquals(34567890L, ChunkedDataSource.totalOf(mapOf("content-range" to listOf("bytes 0-10485759/34567890"))))
        assertEquals(ChunkedDataSource.UNSET, ChunkedDataSource.totalOf(mapOf("Content-Range" to listOf("bytes 0-9/*"))))
        assertEquals(ChunkedDataSource.UNSET, ChunkedDataSource.totalOf(emptyMap()))
    }

    @Test
    fun sponsorBlockSendsOnlyAHashPrefixAndSkipsTheRightParts() {
        val prefix = SponsorBlock.prefix("dQw4w9WgXcQ")
        assertEquals(4, prefix.length)
        val url = SponsorBlock.url("dQw4w9WgXcQ", listOf("sponsor", "selfpromo"))
        assertTrue(url.startsWith("https://sponsor.ajay.app/api/skipSegments/$prefix?categories="))
        assertFalse(url.contains("dQw4w9WgXcQ"))
        val answer = JSONArray()
            .put(JSONObject().put("videoID", "otherVideo1").put("segments", JSONArray().put(JSONObject().put("segment", JSONArray().put(1).put(9)).put("category", "sponsor"))))
            .put(
                JSONObject().put("videoID", "dQw4w9WgXcQ").put(
                    "segments",
                    JSONArray()
                        .put(JSONObject().put("segment", JSONArray().put(60.5).put(90.0)).put("category", "sponsor").put("actionType", "skip"))
                        .put(JSONObject().put("segment", JSONArray().put(10.0).put(20.0)).put("category", "selfpromo"))
                        .put(JSONObject().put("segment", JSONArray().put(30.0).put(30.4)).put("category", "sponsor"))
                        .put(JSONObject().put("segment", JSONArray().put(100.0).put(140.0)).put("category", "sponsor").put("actionType", "mute")),
                ),
            )
        val segs = SponsorBlock.parse(answer.toString(), "dQw4w9WgXcQ")
        assertEquals(listOf(10.0, 60.5), segs.map { it.start })
        assertEquals("selfpromo", segs[0].category)
        assertTrue(SponsorBlock.parse("not json", "x").isEmpty())
        assertTrue(SponsorBlock.parse(answer.toString(), "missing").isEmpty())
    }
}

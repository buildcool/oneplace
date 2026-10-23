package io.github.buildcool.oneplace.queue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/** Download history and queue, kept in memory and saved to SQLite. */
object JobStore {
    private var db: SQLiteDatabase? = null
    private val jobs = LinkedHashMap<String, Job>()
    private const val KEEP_FINISHED = 1000

    @Synchronized
    fun init(ctx: Context) {
        if (db != null) return
        val d = Helper(ctx.applicationContext).writableDatabase
        db = d
        d.rawQuery("SELECT json FROM jobs ORDER BY created", null).use { c ->
            while (c.moveToNext()) {
                runCatching { Job.fromStore(JSONObject(c.getString(0))) }.getOrNull()?.let { job ->
                    // The app was stopped mid-download: queue it again (yt-dlp continues .part files).
                    if (job.status == "running") job.status = "queued"
                    jobs[job.id] = job
                }
            }
        }
    }

    @Synchronized
    fun all(): List<Job> = jobs.values.sortedByDescending { it.createdAt }

    @Synchronized
    fun get(id: String): Job? = jobs[id]

    @Synchronized
    fun put(job: Job) {
        jobs[job.id] = job
        save(job)
        trim()
    }

    @Synchronized
    fun save(job: Job) {
        val values = ContentValues().apply {
            put("id", job.id)
            put("json", job.toStoreJson().toString())
            put("created", job.createdAt)
        }
        db?.insertWithOnConflict("jobs", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun remove(id: String) {
        jobs.remove(id)
        db?.delete("jobs", "id=?", arrayOf(id))
    }

    @Synchronized
    fun nextQueued(): Job? = jobs.values.filter { it.status == "queued" }.minByOrNull { it.createdAt }

    @Synchronized
    fun active(): List<Job> = jobs.values.filter { it.status == "running" || it.status == "queued" }

    private fun trim() {
        val finished = jobs.values.filter { it.status == "done" || it.status == "failed" || it.status == "canceled" }
        if (finished.size <= KEEP_FINISHED) return
        finished.sortedBy { it.createdAt }.take(finished.size - KEEP_FINISHED).forEach { remove(it.id) }
    }

    private class Helper(ctx: Context) : SQLiteOpenHelper(ctx, "jobs.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE jobs (id TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER NOT NULL)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
    }
}

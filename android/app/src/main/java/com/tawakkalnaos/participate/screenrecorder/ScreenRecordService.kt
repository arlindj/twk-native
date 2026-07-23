package com.tawakkalnaos.participate.screenrecorder

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.File

/**
 * Foreground service that owns the MediaProjection recording session.
 *
 * Android requires: (1) user consent via the system dialog for every
 * projection session, (2) the projection to run inside a foreground
 * service of type mediaProjection, (3) on Android 14+ the consent token
 * can be used exactly once. The visible notification is the transparent
 * recording indicator.
 */
class ScreenRecordService : Service() {

  companion object {
    const val ACTION_START = "com.tawakkalnaos.participate.screenrecorder.START"
    const val ACTION_STOP = "com.tawakkalnaos.participate.screenrecorder.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    const val EXTRA_WITH_AUDIO = "withAudio"
    private const val NOTIFICATION_ID = 87131
    private const val CHANNEL_ID = "twk_screen_recording"

    /** Set by the service; observed by the module. */
    @Volatile var isRecording: Boolean = false
    @Volatile var lastOutputFile: String? = null
    @Volatile var lastError: String? = null
    var onStarted: ((error: String?) -> Unit)? = null
    var onStopped: ((filePath: String?, error: String?) -> Unit)? = null
  }

  private var mediaProjection: MediaProjection? = null
  private var mediaRecorder: MediaRecorder? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var outputFile: File? = null

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      // System revoked the projection (user tapped "stop casting", etc.)
      Handler(Looper.getMainLooper()).post { finishRecording(systemStopped = true) }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        // Audio is captured only when the participant opted in AND the
        // runtime RECORD_AUDIO permission is actually granted — otherwise
        // the microphone foreground-service type (and MediaRecorder audio
        // source) would throw. Fall back to video-only rather than fail.
        val audio = intent.getBooleanExtra(EXTRA_WITH_AUDIO, false) && hasMicPermission()
        startAsForeground(audio)
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        @Suppress("DEPRECATION")
        val resultData: Intent? = intent.getParcelableExtra(EXTRA_RESULT_DATA)
        if (resultData == null) {
          reportStartFailure("Missing MediaProjection consent data.")
        } else {
          startRecording(resultCode, resultData, audio)
        }
      }
      ACTION_STOP -> finishRecording(systemStopped = false)
    }
    return START_NOT_STICKY
  }

  private fun startAsForeground(withAudio: Boolean) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Screen recording", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification: Notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("TWK Participate")
      .setContentText(
        if (withAudio) "Your screen and microphone are being recorded"
        else "Your test session is being recorded"
      )
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // The service must advertise every capture type it uses; add the
      // microphone type when audio is on so Android 14+ permits the mic.
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      if (withAudio) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  /**
   * Removes session files left behind by a crashed/killed app. Only files
   * older than 6h are touched — segments of the current session that are
   * still waiting for upload must survive.
   */
  private fun cleanupStaleRecordings() {
    val cutoff = System.currentTimeMillis() - 6 * 3600 * 1000
    cacheDir.listFiles()?.forEach { f ->
      if (f.name.startsWith("twk-session-") && f.name.endsWith(".mp4")) {
        val stamp = f.name.removePrefix("twk-session-").removeSuffix(".mp4").toLongOrNull()
        if (stamp != null && stamp < cutoff) f.delete()
      }
    }
  }

  private fun startRecording(resultCode: Int, resultData: Intent, withAudio: Boolean) {
    try {
      cleanupStaleRecordings()
      val projectionManager =
        getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection = projectionManager.getMediaProjection(resultCode, resultData)
        ?: throw IllegalStateException("MediaProjection was not granted.")
      // Required on Android 14+: register a callback before creating a display.
      projection.registerCallback(projectionCallback, Handler(Looper.getMainLooper()))
      mediaProjection = projection

      val metrics = currentMetrics()
      // Encoder-friendly even dimensions, capped at 1080p-ish width.
      val scale = if (metrics.widthPixels > 1080) 1080f / metrics.widthPixels else 1f
      val width = ((metrics.widthPixels * scale).toInt() / 2) * 2
      val height = ((metrics.heightPixels * scale).toInt() / 2) * 2

      val file = File(cacheDir, "twk-session-${System.currentTimeMillis()}.mp4")
      outputFile = file

      val recorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this)
        else @Suppress("DEPRECATION") MediaRecorder()
      // MediaRecorder state machine: sources must be set before the output
      // format, encoders after it. Audio is added only when the participant
      // opted in (mic permission already verified by the caller).
      if (withAudio) recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
      recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      recorder.setVideoSize(width, height)
      recorder.setVideoFrameRate(30)
      recorder.setVideoEncodingBitRate(6_000_000)
      if (withAudio) {
        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setAudioEncodingBitRate(128_000)
        recorder.setAudioSamplingRate(44_100)
      }
      recorder.setOutputFile(file.absolutePath)
      recorder.prepare()
      mediaRecorder = recorder

      virtualDisplay = projection.createVirtualDisplay(
        "twk-recording",
        width,
        height,
        metrics.densityDpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        recorder.surface,
        null,
        null,
      )
      recorder.start()

      isRecording = true
      lastError = null
      onStarted?.invoke(null)
    } catch (e: Exception) {
      reportStartFailure(e.message ?: "Failed to start screen recording.")
    }
  }

  private fun reportStartFailure(message: String) {
    lastError = message
    isRecording = false
    onStarted?.invoke(message)
    cleanup()
    stopSelf()
  }

  private fun finishRecording(systemStopped: Boolean) {
    if (!isRecording) {
      stopSelf()
      return
    }
    isRecording = false
    var error: String? = null
    try {
      mediaRecorder?.stop()
    } catch (e: Exception) {
      error = "Recorder stop failed: ${e.message}"
    }
    cleanup()
    val path = outputFile?.absolutePath
    lastOutputFile = path
    if (systemStopped && error == null) {
      error = "Recording was stopped by the system."
    }
    onStopped?.invoke(path, error)
    stopSelf()
  }

  private fun cleanup() {
    try { virtualDisplay?.release() } catch (_: Exception) {}
    try { mediaRecorder?.release() } catch (_: Exception) {}
    try {
      mediaProjection?.unregisterCallback(projectionCallback)
      mediaProjection?.stop()
    } catch (_: Exception) {}
    virtualDisplay = null
    mediaRecorder = null
    mediaProjection = null
  }

  private fun currentMetrics(): DisplayMetrics {
    val metrics = DisplayMetrics()
    val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(metrics)
    return metrics
  }

  private fun hasMicPermission(): Boolean =
    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  override fun onDestroy() {
    if (isRecording) finishRecording(systemStopped = true)
    super.onDestroy()
  }
}

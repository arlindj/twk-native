package com.tawakkalnaos.participate.screenrecorder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.view.WindowManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.File

private const val SCREEN_CAPTURE_REQUEST_CODE = 87132

/**
 * JS-facing `ScreenRecorder` module. MediaProjection + foreground
 * service; the system consent dialog is required for every session.
 */
class ScreenRecorderModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var startPromise: Promise? = null
  private var stopPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "ScreenRecorder"

  override fun getConstants(): MutableMap<String, Any> =
    hashMapOf("deviceModel" to android.os.Build.MODEL)

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun startRecording(promise: Promise) {
    val activity = currentActivity
      ?: return promise.reject("E_NO_ACTIVITY", "No foreground activity.")
    if (ScreenRecordService.isRecording) {
      return promise.reject("E_ALREADY_RECORDING", "A recording is already in progress.")
    }
    startPromise = promise
    ScreenRecordService.onStarted = { error ->
      val p = startPromise
      startPromise = null
      if (error != null) {
        p?.reject("E_START_FAILED", error)
      } else {
        p?.resolve(null)
      }
    }
    // System consent dialog — required for every projection session.
    val projectionManager =
      activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    activity.startActivityForResult(
      projectionManager.createScreenCaptureIntent(),
      SCREEN_CAPTURE_REQUEST_CODE,
    )
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    if (!ScreenRecordService.isRecording) {
      return promise.reject("E_NOT_RECORDING", "No recording is in progress.")
    }
    stopPromise = promise
    ScreenRecordService.onStopped = { filePath, error ->
      val p = stopPromise
      stopPromise = null
      if (filePath == null) {
        p?.reject("E_STOP_FAILED", error ?: "No output file produced.")
      } else {
        // A system-forced stop still produces a usable partial file;
        // surface the file and let the JS layer decide.
        p?.resolve("file://$filePath")
      }
    }
    sendServiceAction(ScreenRecordService.ACTION_STOP)
  }

  @ReactMethod
  fun discardRecording(promise: Promise) {
    if (ScreenRecordService.isRecording) {
      ScreenRecordService.onStopped = { filePath, _ ->
        if (filePath != null) File(filePath).delete()
      }
      sendServiceAction(ScreenRecordService.ACTION_STOP)
    }
    promise.resolve(null)
  }

  /** Replaces expo-keep-awake: the prototype player must not let the screen sleep. */
  @ReactMethod
  fun setKeepScreenOn(on: Boolean) {
    val activity = currentActivity ?: return
    UiThreadUtil.runOnUiThread {
      if (on) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != SCREEN_CAPTURE_REQUEST_CODE) return
    val promise = startPromise
    if (resultCode != Activity.RESULT_OK || data == null) {
      startPromise = null
      ScreenRecordService.onStarted = null
      promise?.reject("E_PERMISSION_DENIED", "Screen recording permission was denied.")
      return
    }
    val intent = Intent(reactContext, ScreenRecordService::class.java).apply {
      action = ScreenRecordService.ACTION_START
      putExtra(ScreenRecordService.EXTRA_RESULT_CODE, resultCode)
      putExtra(ScreenRecordService.EXTRA_RESULT_DATA, data)
    }
    reactContext.startForegroundService(intent)
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun sendServiceAction(action: String) {
    val intent = Intent(reactContext, ScreenRecordService::class.java).apply { this.action = action }
    reactContext.startService(intent)
  }
}

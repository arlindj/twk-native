package com.twk.screenrecorder

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val SCREEN_CAPTURE_REQUEST_CODE = 87132

class ScreenRecorderModule : Module() {

  private var startPromise: Promise? = null
  private var stopPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("ScreenRecorder")

    AsyncFunction("isAvailable") {
      return@AsyncFunction true
    }

    AsyncFunction("startRecording") { promise: Promise ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction promise.reject(
          CodedException("E_NO_ACTIVITY", "No foreground activity.", null)
        )
      if (ScreenRecordService.isRecording) {
        return@AsyncFunction promise.reject(
          CodedException("E_ALREADY_RECORDING", "A recording is already in progress.", null)
        )
      }
      startPromise = promise
      ScreenRecordService.onStarted = { error ->
        val p = startPromise
        startPromise = null
        if (error != null) {
          p?.reject(CodedException("E_START_FAILED", error, null))
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

    AsyncFunction("stopRecording") { promise: Promise ->
      if (!ScreenRecordService.isRecording) {
        return@AsyncFunction promise.reject(
          CodedException("E_NOT_RECORDING", "No recording is in progress.", null)
        )
      }
      stopPromise = promise
      ScreenRecordService.onStopped = { filePath, error ->
        val p = stopPromise
        stopPromise = null
        if (filePath == null) {
          p?.reject(CodedException("E_STOP_FAILED", error ?: "No output file produced.", null))
        } else {
          // A system-forced stop still produces a usable partial file;
          // surface the file and let the JS layer decide.
          p?.resolve("file://$filePath")
        }
      }
      sendServiceAction(ScreenRecordService.ACTION_STOP)
    }

    AsyncFunction("discardRecording") { promise: Promise ->
      if (ScreenRecordService.isRecording) {
        ScreenRecordService.onStopped = { filePath, _ ->
          if (filePath != null) File(filePath).delete()
        }
        sendServiceAction(ScreenRecordService.ACTION_STOP)
      }
      promise.resolve(null)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != SCREEN_CAPTURE_REQUEST_CODE) return@OnActivityResult
      val promise = startPromise
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        startPromise = null
        ScreenRecordService.onStarted = null
        promise?.reject(
          CodedException("E_PERMISSION_DENIED", "Screen recording permission was denied.", null)
        )
        return@OnActivityResult
      }
      val context = appContext.reactContext ?: return@OnActivityResult
      val intent = Intent(context, ScreenRecordService::class.java).apply {
        action = ScreenRecordService.ACTION_START
        putExtra(ScreenRecordService.EXTRA_RESULT_CODE, payload.resultCode)
        putExtra(ScreenRecordService.EXTRA_RESULT_DATA, payload.data)
      }
      context.startForegroundService(intent)
    }
  }

  private fun sendServiceAction(action: String) {
    val context = appContext.reactContext ?: return
    val intent = Intent(context, ScreenRecordService::class.java).apply { this.action = action }
    context.startService(intent)
  }
}

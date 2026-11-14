//! Capturing what the Mac plays: the other people on a call.
//!
//! ScreenCaptureKit captures system audio without a bot joining the call and
//! without a virtual audio device. Samples go to the UI over a Tauri channel
//! as mono 32-bit floats at `memo_core::audio::SAMPLE_RATE`, where they are
//! paired with the microphone and streamed to transcription.
//!
//! macOS asks the user once for "Screen & System Audio Recording". Memo asks
//! for audio only; the video stream ScreenCaptureKit insists on is a few
//! pixels, sent nowhere.

use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::Mutex;

    use memo_core::audio::{downmix, f32_from_le_bytes, f32_to_le_bytes, SAMPLE_RATE};
    use screencapturekit::prelude::*;
    use tauri::ipc::{Channel, InvokeResponseBody};

    /// The running capture, if any. Dropping it stops capture.
    #[derive(Default)]
    pub struct SystemAudio {
        stream: Mutex<Option<SCStream>>,
    }

    impl SystemAudio {
        pub fn start(&self, sink: Channel<InvokeResponseBody>) -> Result<(), String> {
            let mut running = self.stream.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(old) = running.take() {
                let _ = old.stop_capture();
            }

            let content = SCShareableContent::get().map_err(|_| permission_message())?;
            let display = content
                .displays()
                .into_iter()
                .next()
                .ok_or("No display found to capture audio from.")?;
            let filter = SCContentFilter::create()
                .with_display(&display)
                .with_excluding_windows(&[])
                .build()
                .map_err(|error| format!("Could not set up audio capture: {error}"))?;

            let config = SCStreamConfiguration::new()
                .with_width(2)
                .with_height(2)
                .with_captures_audio(true)
                // Memo's own sounds are not part of the meeting.
                .with_excludes_current_process_audio(true)
                .with_sample_rate(SAMPLE_RATE as i32)
                .with_channel_count(1);

            let mut stream = SCStream::new(&filter, &config)
                .map_err(|error| format!("Could not start audio capture: {error}"))?;
            stream
                .add_output_handler(
                    move |sample: CMSampleBuffer, kind: SCStreamOutputType| {
                        if !matches!(kind, SCStreamOutputType::Audio) {
                            return;
                        }
                        let Ok(buffers) = sample.audio_buffer_list() else {
                            return;
                        };
                        let channels: Vec<Vec<f32>> = (&buffers)
                            .into_iter()
                            .map(|buffer| f32_from_le_bytes(buffer.data()))
                            .filter(|channel| !channel.is_empty())
                            .collect();
                        let mono = downmix(&channels);
                        if !mono.is_empty() {
                            let _ = sink.send(InvokeResponseBody::Raw(f32_to_le_bytes(&mono)));
                        }
                    },
                    SCStreamOutputType::Audio,
                )
                .map_err(|error| format!("Could not listen to system audio: {error}"))?;
            stream.start_capture().map_err(|_| permission_message())?;
            *running = Some(stream);
            Ok(())
        }

        pub fn stop(&self) {
            let mut running = self.stream.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(stream) = running.take() {
                let _ = stream.stop_capture();
            }
        }
    }

    fn permission_message() -> String {
        "Memo can't hear the call yet. Allow it in System Settings › Privacy & Security › \
         Screen & System Audio Recording, then start a new note."
            .to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::ipc::{Channel, InvokeResponseBody};

    /// System audio capture exists only on macOS.
    #[derive(Default)]
    pub struct SystemAudio {
        _unsupported: (),
    }

    impl SystemAudio {
        pub fn start(&self, _sink: Channel<InvokeResponseBody>) -> Result<(), String> {
            Err("Capturing call audio is only available on macOS.".to_string())
        }

        pub fn stop(&self) {}
    }
}

pub use imp::SystemAudio;

/// Start sending the Mac's audio output to `on_audio`, replacing any capture
/// already running.
#[tauri::command]
pub fn start_system_audio(
    audio: tauri::State<SystemAudio>,
    on_audio: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    audio.start(on_audio)?;
    Ok(memo_core::audio::SAMPLE_RATE)
}

#[tauri::command]
pub fn stop_system_audio(audio: tauri::State<SystemAudio>) {
    audio.stop();
}

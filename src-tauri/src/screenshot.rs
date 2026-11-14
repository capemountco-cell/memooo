//! "Look at my screen": one snapshot of the main display, without Captain's own
//! windows in it, as a Base64 PNG for the live-help request.

/// Longest side of the snapshot. Enough to read text, small enough to send fast.
const MAX_SIDE: u32 = 1600;

#[cfg(target_os = "macos")]
mod imp {
    use memo_core::screen::{base64, fit_within, macos_major, MIN_MACOS_FOR_SCREENSHOTS};
    use screencapturekit::prelude::*;
    use screencapturekit::screenshot_manager::{CGImageExt, SCScreenshotManager};

    use super::MAX_SIDE;

    fn macos_version() -> Option<u32> {
        let output = std::process::Command::new("/usr/bin/sw_vers")
            .arg("-productVersion")
            .output()
            .ok()?;
        macos_major(&String::from_utf8_lossy(&output.stdout))
    }

    pub fn capture() -> Result<String, String> {
        match macos_version() {
            Some(major) if major >= MIN_MACOS_FOR_SCREENSHOTS => {}
            _ => return Err("Looking at the screen needs macOS 14 or later.".into()),
        }

        let content = SCShareableContent::get().map_err(|_| permission_message())?;
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or("No display found.")?;

        // Leave Captain's own windows (the overlay) out of the picture.
        let own_pid = std::process::id() as i32;
        let apps = content.applications();
        let memo: Vec<&SCRunningApplication> = apps
            .iter()
            .filter(|app| app.process_id() == own_pid)
            .collect();
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .with_excluding_applications(&memo, &[])
            .build()
            .map_err(|error| format!("Could not set up the screenshot: {error}"))?;

        let (width, height) = fit_within(
            display.width() * 2,
            display.height() * 2,
            MAX_SIDE,
            MAX_SIDE,
        );
        let config = SCStreamConfiguration::new()
            .with_width(width)
            .with_height(height);
        let image = SCScreenshotManager::capture_image(&filter, &config)
            .map_err(|_| permission_message())?;

        let rgba = image
            .rgba_data()
            .map_err(|error| format!("Could not read the screenshot: {error}"))?;
        let mut png_bytes = Vec::new();
        {
            let mut encoder =
                png::Encoder::new(&mut png_bytes, image.width() as u32, image.height() as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|error| format!("Could not encode the screenshot: {error}"))?;
            writer
                .write_image_data(&rgba)
                .map_err(|error| format!("Could not encode the screenshot: {error}"))?;
        }
        Ok(base64(&png_bytes))
    }

    fn permission_message() -> String {
        "Captain can't see the screen yet. Allow it in System Settings › Privacy & Security › \
         Screen & System Audio Recording."
            .to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn capture() -> Result<String, String> {
        let _ = super::MAX_SIDE;
        Err("Looking at the screen is only available on macOS.".to_string())
    }
}

/// A snapshot of the screen as Base64 PNG.
#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    // ScreenCaptureKit blocks; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(imp::capture)
        .await
        .map_err(|error| format!("The screenshot failed: {error}"))?
}

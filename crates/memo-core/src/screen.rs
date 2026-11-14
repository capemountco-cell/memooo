//! Helpers for "look at my screen": sizing the snapshot, encoding it for the
//! wire, and deciding whether this Mac can take one.

/// Screenshots need macOS 14 (ScreenCaptureKit's screenshot API).
pub const MIN_MACOS_FOR_SCREENSHOTS: u32 = 14;

/// The largest size, in pixels, that keeps `width`×`height`'s shape and fits
/// in `max_width`×`max_height`. Never upscales; never returns zero.
pub fn fit_within(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let scale = f64::min(
        1.0,
        f64::min(
            max_width as f64 / width as f64,
            max_height as f64 / height as f64,
        ),
    );
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    (w, h)
}

/// The major version from `sw_vers -productVersion` output such as "14.6.1".
pub fn macos_major(version: &str) -> Option<u32> {
    version.trim().split('.').next()?.parse().ok()
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard Base64 with padding (RFC 4648).
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_without_distorting_or_upscaling() {
        assert_eq!(fit_within(3024, 1964, 1600, 1600), (1600, 1039));
        assert_eq!(fit_within(1000, 3000, 1600, 1600), (533, 1600));
        assert_eq!(fit_within(800, 600, 1600, 1600), (800, 600));
        assert_eq!(fit_within(0, 600, 1600, 1600), (1, 1));
    }

    #[test]
    fn reads_the_macos_major_version() {
        assert_eq!(macos_major("14.6.1\n"), Some(14));
        assert_eq!(macos_major("13.0"), Some(13));
        assert_eq!(macos_major("26"), Some(26));
        assert_eq!(macos_major(""), None);
    }

    #[test]
    fn encodes_base64_like_rfc_4648() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0xff, 0xfe, 0x00]), "//4A");
    }
}

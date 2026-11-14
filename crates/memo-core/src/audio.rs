//! Audio sample plumbing shared by the native capture and the UI.
//!
//! macOS hands Memo system audio as 32-bit float samples, one buffer per
//! channel. These helpers turn that into the single mono stream the
//! transcription channel for "everyone else on the call" expects.

/// The rate Memo captures system audio at. The microphone side runs at the
/// same rate so the two can travel to Deepgram as one stereo stream.
pub const SAMPLE_RATE: u32 = 48_000;

/// Read little-endian 32-bit floats. A trailing partial sample is ignored.
pub fn f32_from_le_bytes(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Write samples as little-endian 32-bit floats.
pub fn f32_to_le_bytes(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

/// Average separate channel buffers into one. Channels of different lengths
/// are mixed up to the shortest, so no channel's silence is invented.
pub fn downmix(channels: &[Vec<f32>]) -> Vec<f32> {
    match channels {
        [] => Vec::new(),
        [only] => only.clone(),
        _ => {
            let frames = channels.iter().map(Vec::len).min().unwrap_or(0);
            let scale = 1.0 / channels.len() as f32;
            (0..frames)
                .map(|i| channels.iter().map(|channel| channel[i]).sum::<f32>() * scale)
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_little_endian_floats() {
        let samples = [0.0, 0.5, -1.0, 0.25];
        let bytes = f32_to_le_bytes(&samples);
        assert_eq!(bytes.len(), 16);
        assert_eq!(f32_from_le_bytes(&bytes), samples);
        assert_eq!(f32_from_le_bytes(&bytes[..6]), [0.0]);
    }

    #[test]
    fn downmixes_by_averaging_to_the_shortest_channel() {
        assert!(downmix(&[]).is_empty());
        assert_eq!(downmix(&[vec![0.2, 0.4]]), [0.2, 0.4]);
        assert_eq!(downmix(&[vec![1.0, 0.5, 0.9], vec![0.0, 0.5]]), [0.5, 0.5]);
    }
}

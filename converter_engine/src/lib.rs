use std::io::Cursor;
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

use symphonia::core::audio::{AudioBuffer, AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioMetadata {
    pub format: String,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: Option<u32>,
    pub duration_seconds: f64,
    pub duration_formatted: String,
    pub total_samples: u64,
    pub file_size_bytes: usize,
    pub bitrate_kbps: Option<u32>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DecodedPcm {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
    pub duration_seconds: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConversionOptions {
    pub target_format: String, // "wav", "mp3", "ogg"
    pub sample_rate: u32,      // 0 = keep original, or 44100, 48000, etc.
    pub channels: u16,         // 0 = keep original, 1 = mono, 2 = stereo
    pub bit_depth: u16,        // for WAV: 16, 24, 32 (float)
    pub bitrate_kbps: u32,     // for MP3 / OGG: 64, 128, 192, 256, 320
}

fn format_duration(seconds: f64) -> String {
    if seconds.is_nan() || seconds < 0.0 {
        return "00:00".to_string();
    }
    let total_secs = seconds.round() as u64;
    let mins = total_secs / 60;
    let secs = total_secs % 60;
    format!("{:02}:{:02}", mins, secs)
}

/// Decode any supported audio container and codec into interleaved f32 PCM
pub fn decode_audio(data: &[u8], filename_hint: &str) -> Result<(DecodedPcm, AudioMetadata), String> {
    if data.is_empty() {
        return Err("Input data is empty".to_string());
    }

    let cursor = Cursor::new(data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = filename_hint.rsplit('.').next() {
        hint.with_extension(ext);
    }

    let meta_opts: MetadataOptions = Default::default();
    let fmt_opts: FormatOptions = Default::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .map_err(|e| format!("Media probe error: {}", e))?;

    let mut format_reader = probed.format;
    let track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No valid audio track found".to_string())?;

    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);
    let bits_per_sample = codec_params.bits_per_sample;
    let codec_name = format!("{:?}", codec_params.codec);

    let dec_opts: DecoderOptions = Default::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &dec_opts)
        .map_err(|e| format!("Codec initialization error: {}", e))?;

    let mut interleaved_samples: Vec<f32> = Vec::new();

    // Read and decode all packets
    loop {
        let packet = match format_reader.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => {
                // If EOF or end of stream, break gracefully
                break;
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded_ref) => {
                append_audio_buffer(&decoded_ref, &mut interleaved_samples);
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    let total_samples = (interleaved_samples.len() / (channels as usize).max(1)) as u64;
    let duration_seconds = if sample_rate > 0 {
        total_samples as f64 / sample_rate as f64
    } else {
        0.0
    };

    let est_bitrate = if duration_seconds > 0.0 {
        Some(((data.len() as f64 * 8.0) / duration_seconds / 1000.0).round() as u32)
    } else {
        None
    };

    let metadata = AudioMetadata {
        format: filename_hint.rsplit('.').next().unwrap_or("audio").to_uppercase(),
        codec: codec_name,
        sample_rate,
        channels,
        bits_per_sample,
        duration_seconds,
        duration_formatted: format_duration(duration_seconds),
        total_samples,
        file_size_bytes: data.len(),
        bitrate_kbps: est_bitrate,
        title: None,
        artist: None,
        album: None,
    };

    let pcm = DecodedPcm {
        sample_rate,
        channels,
        samples: interleaved_samples,
        duration_seconds,
    };

    Ok((pcm, metadata))
}

fn append_audio_buffer(audio_buf_ref: &AudioBufferRef, out: &mut Vec<f32>) {
    match audio_buf_ref {
        AudioBufferRef::F32(buf) => {
            let num_channels = buf.spec().channels.count();
            let num_frames = buf.frames();
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    out.push(buf.chan(c)[f]);
                }
            }
        }
        AudioBufferRef::S16(buf) => {
            let num_channels = buf.spec().channels.count();
            let num_frames = buf.frames();
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    let s = buf.chan(c)[f] as f32 / 32768.0;
                    out.push(s);
                }
            }
        }
        AudioBufferRef::S24(buf) => {
            let num_channels = buf.spec().channels.count();
            let num_frames = buf.frames();
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    let s = buf.chan(c)[f].0 as f32 / 8388608.0;
                    out.push(s);
                }
            }
        }
        AudioBufferRef::S32(buf) => {
            let num_channels = buf.spec().channels.count();
            let num_frames = buf.frames();
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    let s = buf.chan(c)[f] as f32 / 2147483648.0;
                    out.push(s);
                }
            }
        }
        AudioBufferRef::U8(buf) => {
            let num_channels = buf.spec().channels.count();
            let num_frames = buf.frames();
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    let s = (buf.chan(c)[f] as f32 - 128.0) / 128.0;
                    out.push(s);
                }
            }
        }
        _ => {
            // Generic sample conversion fallback
            let spec = audio_buf_ref.spec();
            let num_channels = spec.channels.count();
            let num_frames = audio_buf_ref.frames();
            let mut sample_buf = AudioBuffer::<f32>::new(num_frames as u64, *spec);
            audio_buf_ref.convert(&mut sample_buf);
            out.reserve(num_frames * num_channels);
            for f in 0..num_frames {
                for c in 0..num_channels {
                    out.push(sample_buf.chan(c)[f]);
                }
            }
        }
    }
}

/// Resample and remix channels
pub fn process_pcm(
    pcm: &DecodedPcm,
    target_sample_rate: u32,
    target_channels: u16,
) -> DecodedPcm {
    let src_sr = pcm.sample_rate;
    let src_ch = pcm.channels as usize;
    let dst_sr = if target_sample_rate > 0 { target_sample_rate } else { src_sr };
    let dst_ch = if target_channels > 0 { target_channels as usize } else { src_ch };

    if pcm.samples.is_empty() {
        return DecodedPcm {
            sample_rate: dst_sr,
            channels: dst_ch as u16,
            samples: Vec::new(),
            duration_seconds: 0.0,
        };
    }

    // 1. Channel remix
    let remixed: Vec<f32>;
    let src_frames = pcm.samples.len() / src_ch.max(1);

    if src_ch == dst_ch {
        remixed = pcm.samples.clone();
    } else if src_ch >= 2 && dst_ch == 1 {
        // Stereo / surround to Mono
        let mut mono = Vec::with_capacity(src_frames);
        for f in 0..src_frames {
            let left = pcm.samples[f * src_ch];
            let right = pcm.samples[f * src_ch + 1];
            mono.push((left + right) * 0.5);
        }
        remixed = mono;
    } else if src_ch == 1 && dst_ch == 2 {
        // Mono to Stereo
        let mut stereo = Vec::with_capacity(src_frames * 2);
        for f in 0..src_frames {
            let sample = pcm.samples[f];
            stereo.push(sample);
            stereo.push(sample);
        }
        remixed = stereo;
    } else {
        // Generic fallback: replicate or truncate channels
        let mut out = Vec::with_capacity(src_frames * dst_ch);
        for f in 0..src_frames {
            for c in 0..dst_ch {
                let sc = c % src_ch;
                out.push(pcm.samples[f * src_ch + sc]);
            }
        }
        remixed = out;
    }

    // 2. Resample if needed
    if src_sr == dst_sr || src_frames == 0 {
        let dur = remixed.len() as f64 / (dst_ch as f64 * dst_sr as f64);
        return DecodedPcm {
            sample_rate: dst_sr,
            channels: dst_ch as u16,
            samples: remixed,
            duration_seconds: dur,
        };
    }

    let ratio = dst_sr as f64 / src_sr as f64;
    let dst_frames = ((src_frames as f64) * ratio).round() as usize;
    let mut resampled = Vec::with_capacity(dst_frames * dst_ch);

    // High quality cubic Hermite interpolation
    for df in 0..dst_frames {
        let src_pos = df as f64 / ratio;
        let base_idx = src_pos.floor() as isize;
        let t = (src_pos - base_idx as f64) as f32;

        for c in 0..dst_ch {
            let get_s = |idx: isize| -> f32 {
                let clamped = idx.clamp(0, (src_frames - 1) as isize) as usize;
                remixed[clamped * dst_ch + c]
            };

            let p0 = get_s(base_idx - 1);
            let p1 = get_s(base_idx);
            let p2 = get_s(base_idx + 1);
            let p3 = get_s(base_idx + 2);

            // Hermite spline (Catmull-Rom)
            let a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
            let b = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
            let c_coeff = -0.5 * p0 + 0.5 * p2;
            let d = p1;

            let sample = ((a * t + b) * t + c_coeff) * t + d;
            resampled.push(sample.clamp(-1.0, 1.0));
        }
    }

    let dur = resampled.len() as f64 / (dst_ch as f64 * dst_sr as f64);
    DecodedPcm {
        sample_rate: dst_sr,
        channels: dst_ch as u16,
        samples: resampled,
        duration_seconds: dur,
    }
}

/// Encode PCM into WAV
pub fn encode_wav(pcm: &DecodedPcm, bit_depth: u16) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    let bits = if bit_depth == 24 || bit_depth == 32 || bit_depth == 8 { bit_depth } else { 16 };
    let sample_format = if bits == 32 {
        hound::SampleFormat::Float
    } else {
        hound::SampleFormat::Int
    };

    let spec = hound::WavSpec {
        channels: pcm.channels,
        sample_rate: pcm.sample_rate,
        bits_per_sample: bits,
        sample_format,
    };

    let mut writer = hound::WavWriter::new(&mut cursor, spec)
        .map_err(|e| format!("WAV writer init failed: {}", e))?;

    match bits {
        8 => {
            for &s in &pcm.samples {
                let clamped = s.clamp(-1.0, 1.0);
                let val = ((clamped * 127.0) + 128.0).round() as i8;
                writer.write_sample(val).map_err(|e| e.to_string())?;
            }
        }
        16 => {
            for &s in &pcm.samples {
                let clamped = s.clamp(-1.0, 1.0);
                let val = (clamped * 32767.0).round() as i16;
                writer.write_sample(val).map_err(|e| e.to_string())?;
            }
        }
        24 => {
            for &s in &pcm.samples {
                let clamped = s.clamp(-1.0, 1.0);
                let val = (clamped * 8388607.0).round() as i32;
                writer.write_sample(val).map_err(|e| e.to_string())?;
            }
        }
        32 => {
            for &s in &pcm.samples {
                let clamped = s.clamp(-1.0, 1.0);
                writer.write_sample(clamped).map_err(|e| e.to_string())?;
            }
        }
        _ => return Err(format!("Unsupported WAV bit depth: {}", bits)),
    }

    writer.finalize().map_err(|e| format!("WAV finalize error: {}", e))?;
    Ok(cursor.into_inner())
}

/// Encode PCM into MP3 using pure-Rust rusty_mp3
pub fn encode_mp3(pcm: &DecodedPcm, bitrate_kbps: u32) -> Result<Vec<u8>, String> {
    let target_bitrate = if bitrate_kbps > 0 { bitrate_kbps } else { 192 };
    
    // MP3 standard supports sample rates: 32000, 44100, 48000, 16000, 22050, 24000, 8000, 11025, 12000
    // If not matching, resample to nearest standard rate (44100 or 48000)
    let valid_rates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
    let working_pcm = if !valid_rates.contains(&pcm.sample_rate) {
        let best_rate = if pcm.sample_rate >= 44100 { 44100 } else { 22050 };
        process_pcm(pcm, best_rate, pcm.channels)
    } else {
        pcm.clone()
    };

    let cfg = rusty_mp3::Mp3EncoderConfig {
        bitrate_kbps: target_bitrate,
        vbr_quality: None,
    };

    let mut encoder = rusty_mp3::Mp3Encoder::new(cfg);
    encoder
        .push_pcm_f32(&working_pcm.samples, working_pcm.channels, working_pcm.sample_rate)
        .map_err(|e| format!("MP3 push error: {:?}", e))?;
    encoder.finish();

    let mut mp3_bytes = Vec::new();
    while let Ok(packet) = encoder.next_packet() {
        mp3_bytes.extend_from_slice(&packet);
    }

    Ok(mp3_bytes)
}

/// Encode PCM into OGG Vorbis
pub fn encode_ogg(pcm: &DecodedPcm, quality_kbps: u32) -> Result<Vec<u8>, String> {
    use rusty_vorbis::setup::{parse_setup, SETUP_Q4_STEREO};
    use rusty_vorbis::frame::encode_long_packet;
    use rusty_vorbis::{write_ident_header, write_comment_header, BS0_LOG2, BS1_LOG2, BITRATE_NOMINAL};
    use ogg::writing::{PacketWriter, PacketWriteEndInfo};

    // Ensure stereo or mono
    let channels = pcm.channels.clamp(1, 2) as usize;
    let working_pcm = if pcm.channels != channels as u16 {
        process_pcm(pcm, pcm.sample_rate, channels as u16)
    } else {
        pcm.clone()
    };

    let sr = working_pcm.sample_rate;
    let setup = parse_setup(SETUP_Q4_STEREO, channels as u8)
        .map_err(|e| format!("Vorbis setup error: {:?}", e))?;

    // Determine normalized quality
    let q = if quality_kbps >= 256 {
        0.85
    } else if quality_kbps >= 192 {
        0.75
    } else if quality_kbps >= 128 {
        0.60
    } else {
        0.45
    };

    const N: usize = 2048;
    const HOP: usize = N / 2;

    let frames = working_pcm.samples.len() / channels;
    if frames == 0 {
        return Err("No PCM samples to encode into Ogg".to_string());
    }

    // Split interleaved samples into per-channel vectors
    let mut chans: Vec<Vec<f32>> = vec![Vec::with_capacity(frames); channels];
    for f in 0..frames {
        for c in 0..channels {
            chans[c].push(working_pcm.samples[f * channels + c]);
        }
    }

    let mut starts: Vec<usize> = Vec::new();
    let mut p = 0;
    while p + N <= frames {
        starts.push(p);
        p += HOP;
    }
    let tail = if p < frames { Some(p) } else { None };
    let nblocks = starts.len() + tail.is_some() as usize;

    let mut out_packets: Vec<Vec<u8>> = Vec::with_capacity(nblocks);

    for bi in 0..nblocks {
        let blocks: Vec<Vec<f32>> = if bi < starts.len() {
            let pos = starts[bi];
            (0..channels).map(|c| chans[c][pos..pos + N].to_vec()).collect()
        } else {
            let pos = tail.unwrap();
            (0..channels).map(|c| {
                let mut b = chans[c][pos..].to_vec();
                b.resize(N, 0.0);
                b
            }).collect()
        };

        let pkt = encode_long_packet(&setup, &blocks, sr, q)
            .map_err(|e| format!("Vorbis frame encode error: {:?}", e))?;
        out_packets.push(pkt);
    }

    // Write to OGG container
    let mut ogg_buf = Vec::new();
    {
        let mut writer = PacketWriter::new(&mut ogg_buf);
        let stream_serial = 0x41554449; // "AUDI"

        // Vorbis headers
        let ident = write_ident_header(channels as u8, sr, BS0_LOG2, BS1_LOG2, BITRATE_NOMINAL);
        let comment = write_comment_header("AudioConverter Rust Engine", &[]);
        let setup_bytes = SETUP_Q4_STEREO.to_vec();

        writer.write_packet(ident, stream_serial, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("Ogg write ident error: {}", e))?;
        writer.write_packet(comment, stream_serial, PacketWriteEndInfo::NormalPacket, 0)
            .map_err(|e| format!("Ogg write comment error: {}", e))?;
        writer.write_packet(setup_bytes, stream_serial, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("Ogg write setup error: {}", e))?;

        let mut granule: u64 = 0;
        let last_idx = out_packets.len().saturating_sub(1);

        for (idx, pkt) in out_packets.into_iter().enumerate() {
            granule += HOP as u64;
            let op = if idx == last_idx {
                PacketWriteEndInfo::EndStream
            } else if (idx + 1) % 15 == 0 {
                PacketWriteEndInfo::EndPage
            } else {
                PacketWriteEndInfo::NormalPacket
            };

            writer.write_packet(pkt, stream_serial, op, granule)
                .map_err(|e| format!("Ogg write audio packet error: {}", e))?;
        }
    }

    Ok(ogg_buf)
}

/// WASM API: Analyze media file
#[wasm_bindgen]
pub fn analyze_media(data: &[u8], filename: &str) -> Result<JsValue, JsValue> {
    match decode_audio(data, filename) {
        Ok((_, meta)) => {
            serde_wasm_bindgen::to_value(&meta)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        }
        Err(e) => Err(JsValue::from_str(&e)),
    }
}

/// WASM API: Decode for live browser playback and frequency visualization
#[wasm_bindgen]
pub fn decode_audio_for_player(data: &[u8], filename: &str) -> Result<JsValue, JsValue> {
    match decode_audio(data, filename) {
        Ok((pcm, meta)) => {
            #[derive(Serialize)]
            struct PlayerAudioData {
                pub sample_rate: u32,
                pub channels: u16,
                pub samples: Vec<f32>,
                pub duration_seconds: f64,
                pub metadata: AudioMetadata,
            }

            let payload = PlayerAudioData {
                sample_rate: pcm.sample_rate,
                channels: pcm.channels,
                samples: pcm.samples,
                duration_seconds: pcm.duration_seconds,
                metadata: meta,
            };

            serde_wasm_bindgen::to_value(&payload)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
        }
        Err(e) => Err(JsValue::from_str(&e)),
    }
}

/// WASM API: Convert audio file with target settings
#[wasm_bindgen]
pub fn convert_audio_file(
    data: &[u8],
    filename: &str,
    target_format: &str,
    target_sample_rate: u32,
    target_channels: u16,
    bit_depth: u16,
    bitrate_kbps: u32,
) -> Result<Vec<u8>, JsValue> {
    let (src_pcm, _) = decode_audio(data, filename)
        .map_err(|e| JsValue::from_str(&format!("Decode error: {}", e)))?;

    let processed = process_pcm(&src_pcm, target_sample_rate, target_channels);

    let fmt = target_format.trim().to_lowercase();
    match fmt.as_str() {
        "wav" => encode_wav(&processed, bit_depth)
            .map_err(|e| JsValue::from_str(&format!("WAV conversion error: {}", e))),
        "mp3" => encode_mp3(&processed, bitrate_kbps)
            .map_err(|e| JsValue::from_str(&format!("MP3 conversion error: {}", e))),
        "ogg" => encode_ogg(&processed, bitrate_kbps)
            .map_err(|e| JsValue::from_str(&format!("OGG conversion error: {}", e))),
        _ => Err(JsValue::from_str(&format!("Unsupported output format: {}", target_format))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_sample_files() {
        // Test MP3
        let mp3_data = fs::read("../Samples/MP3/1.mp3").expect("Read 1.mp3");
        let (mp3_pcm, mp3_meta) = decode_audio(&mp3_data, "1.mp3").expect("Decode MP3");
        println!("MP3 Meta: {:?}, samples: {}", mp3_meta, mp3_pcm.samples.len());
        assert!(mp3_pcm.samples.len() > 0);

        // Test WAV
        let wav_data = fs::read("../Samples/WAV/2.wav").expect("Read 2.wav");
        let (wav_pcm, wav_meta) = decode_audio(&wav_data, "2.wav").expect("Decode WAV");
        println!("WAV Meta: {:?}, samples: {}", wav_meta, wav_pcm.samples.len());
        assert!(wav_pcm.samples.len() > 0);

        // Test OGG
        let ogg_data = fs::read("../Samples/OGG/3.ogg").expect("Read 3.ogg");
        let (ogg_pcm, ogg_meta) = decode_audio(&ogg_data, "3.ogg").expect("Decode OGG");
        println!("OGG Meta: {:?}, samples: {}", ogg_meta, ogg_pcm.samples.len());
        assert!(ogg_pcm.samples.len() > 0);

        // Test conversion: WAV -> MP3
        let conv_mp3 = encode_mp3(&wav_pcm, 192).expect("Encode WAV to MP3");
        assert!(!conv_mp3.is_empty());

        // Test conversion: MP3 -> WAV
        let conv_wav = encode_wav(&mp3_pcm, 16).expect("Encode MP3 to WAV");
        assert!(!conv_wav.is_empty());

        // Test conversion: WAV -> OGG
        let conv_ogg = encode_ogg(&wav_pcm, 192).expect("Encode WAV to OGG");
        assert!(!conv_ogg.is_empty());
    }
}

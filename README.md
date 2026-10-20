# SONICMORPH // Rust Audio Converter & Studio Monitor
### Created by YRLD Studios • Open Source (MIT License)

A blazing-fast audio converter and studio monitor powered by **Rust** and **WebAssembly (WASM)**.

Available both as a **standalone Windows executable** (`AudioConverter.exe`) and as an in-browser web app.

---

## Key Features

- **Standalone Single-File Executable (`AudioConverter.exe`)**:
  - 100% portable single `.exe` (~7.3 MB) with all web assets, WASM engine, and samples embedded.
  - Double-click to run anywhere without requiring Node.js or any external dependencies.
  - Automatically starts its embedded server and opens your default browser.
- **Save Converted Files to Source Folder**:
  - Direct saving into the source directory or selected output folder.
  - Powered by the Web File System Access API and native server endpoints.
- **Customizable Filename Suffix**:
  - Choose any custom suffix (defaults to `_converted`).
  - Example: `song.mp3` -> `song_converted.wav`.
  - Leave blank to keep the original filename with the new format extension.
- **Pure Rust WebAssembly Core**:
  - In-browser media analysis and multi-format audio conversion running at native speed.
- **Multi-Format Support**:
  - **MP3**: Full decoding (Symphonia) & encoding (pure-Rust `rusty_mp3`, CBR up to 320 kbps).
  - **WAV**: Full decoding & high-resolution PCM encoding (8-bit, 16-bit, 24-bit, 32-bit float via `hound`).
  - **OGG**: Full Vorbis decoding & encoding (pure-Rust `rusty_vorbis` + `ogg` container writer).
- **Single Files & Entire Folder Drag-and-Drop**:
  - Drag and drop individual tracks or entire nested folder hierarchies (`webkitGetAsEntry` directory recursion).
  - Folder tree structure is preserved in batch downloads.
- **Audio Analysis & Source Info**:
  - Extracts container format, codec, sample rate, channel count, bit depth, bitrate, and duration in real-time.
- **Customizable Output Target Settings**:
  - **Format**: MP3, WAV, OGG.
  - **Channels**: Keep Original, Stereo (2 Channels), Mono (1 Channel - Downmixed).
  - **Frequency / Sample Rate**: Keep Original, 48,000 Hz, 44,100 Hz, 96,000 Hz, 88,200 Hz, 32,000 Hz, 22,050 Hz, 16,000 Hz, 8,000 Hz.
  - **Bit Depth / Bitrate**:
    - WAV: 16-bit PCM, 24-bit PCM, 32-bit Float, 8-bit PCM.
    - MP3: 64 kbps to 320 kbps.
    - OGG: 64 kbps to 320 kbps.
- **DSP Resampling & Remixing**:
  - High-quality Catmull-Rom cubic Hermite spline interpolation for pitch-accurate resampling.
  - Downmixing `(L + R) * 0.5` and upmixing.
- **Studio Audio Player & Frequency Visualizer**:
  - Dual A/B audio player: Listen to the original **Source File** or compare against the **Converted Output**.
  - Real-time 60+ FPS Canvas Frequency Spectrum Analyzer with glowing gradient bars and peak hold decay.
  - Oscilloscope Waveform view and Radial Ring spectrum view.
  - Real-time dB signal meter and volume control.
- **Credits & Open-Source Attribution**:
  - Click the **"Credits"** button in the header to view all open-source libraries, licenses, and links.
- **1-Click Batch ZIP Download**:
  - Pure JavaScript zero-dependency ZIP engine (`zip.js`) packages all converted files for single-click download.

---

## Quick Start Options

### Option 1: Standalone Executable (Recommended for sharing)
Simply run **`AudioConverter.exe`** directly:
```
AudioConverter.exe
```
This single executable embeds everything and will automatically open the studio interface in your browser at `http://127.0.0.1:3000`. You can copy or share this single `.exe` file to any Windows machine!

### Option 2: 1-Click Batch Launcher
Double-click **`start.bat`**.

### Option 3: Node / Terminal
```powershell
npm start
```

---

## Open Source Credits & Licenses

- **Symphonia** (MPL-2.0) — Rust audio decoding and container probing engine.
- **rusty_mp3** (Apache-2.0) — Pure-Rust MP3 encoder & decoder.
- **rusty_vorbis** (Apache-2.0) & **ogg** (MIT) — Pure-Rust Vorbis encoder & Ogg container muxer.
- **hound** (Apache-2.0) — Pure-Rust WAV audio encoder & decoder.
- **wasm-bindgen & Serde** (MIT / Apache-2.0) — WebAssembly bindings and serialization.
- **Web Audio API** (W3C Standard) — Real-time audio DSP and frequency spectrum analyzer.
---
 
## License

This project is open-source software licensed under the [MIT License](LICENSE).
Created by **YRLD Studios**. Free to use, modify, distribute, and build upon.

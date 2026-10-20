use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::Arc;
use std::thread;

// Embed the frontend assets directly into the binary for 100% standalone single-file distribution!
static INDEX_HTML: &[u8] = include_bytes!("../../index.html");
static STYLE_CSS: &[u8] = include_bytes!("../../style.css");
static APP_JS: &[u8] = include_bytes!("../../app.js");
static ZIP_JS: &[u8] = include_bytes!("../../zip.js");
static WASM_JS: &[u8] = include_bytes!("../pkg/converter_engine.js");
static WASM_BG: &[u8] = include_bytes!("../pkg/converter_engine_bg.wasm");

// Embedded Samples for immediate standalone access
static SAMPLE_MP3: &[u8] = include_bytes!("../../Samples/MP3/1.mp3");
static SAMPLE_WAV: &[u8] = include_bytes!("../../Samples/WAV/2.wav");
static SAMPLE_OGG: &[u8] = include_bytes!("../../Samples/OGG/3.ogg");

fn main() {
    println!("===============================================================");
    println!("  SONICMORPH // Rust Audio Converter & Studio Monitor");
    println!("  Copyright (c) YRLD Studios. All rights reserved.");
    println!("===============================================================");

    let host = "127.0.0.1";
    let mut port = 3000;
    let listener = loop {
        match TcpListener::bind(format!("{}:{}", host, port)) {
            Ok(l) => break l,
            Err(_) => {
                port += 1;
                if port > 3050 {
                    eprintln!("Error: Could not bind to any port between 3000 and 3050.");
                    return;
                }
            }
        }
    };

    let url = format!("http://{}:{}", host, port);
    println!(" [OK] Embedded web server running at: {}", url);
    println!(" [OK] Opening in your default web browser...");
    println!(" [INFO] Press Ctrl+C in this terminal window to stop the server.");
    println!("===============================================================");

    // Open browser on Windows
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("xdg-open").arg(&url).spawn();
    }

    let listener = Arc::new(listener);
    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            thread::spawn(move || {
                handle_client(stream);
            });
        }
    }
}

fn handle_client(mut stream: TcpStream) {
    let mut buffer = [0u8; 8192];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut lines = request.lines();
    let first_line = match lines.next() {
        Some(l) => l,
        None => return,
    };

    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let path = parts[1].split('?').next().unwrap_or("/");

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
                    Access-Control-Allow-Headers: Content-Type\r\n\
                    Cross-Origin-Opener-Policy: same-origin\r\n\
                    Cross-Origin-Embedder-Policy: require-corp\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    // Handle native API: save converted file directly to disk
    if method == "POST" && path == "/api/save_file" {
        handle_save_file(&request, &buffer[..bytes_read], &mut stream);
        return;
    }

    // Route static assets
    let (content_type, data) = match path {
        "/" | "/index.html" => ("text/html; charset=utf-8", INDEX_HTML),
        "/style.css" => ("text/css; charset=utf-8", STYLE_CSS),
        "/app.js" => ("text/javascript; charset=utf-8", APP_JS),
        "/zip.js" => ("text/javascript; charset=utf-8", ZIP_JS),
        "/pkg/converter_engine.js" => ("text/javascript; charset=utf-8", WASM_JS),
        "/pkg/converter_engine_bg.wasm" => ("application/wasm", WASM_BG),
        "/Samples/MP3/1.mp3" => ("audio/mpeg", SAMPLE_MP3),
        "/Samples/WAV/2.wav" => ("audio/wav", SAMPLE_WAV),
        "/Samples/OGG/3.ogg" => ("audio/ogg", SAMPLE_OGG),
        _ => {
            let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nNot Found";
            let _ = stream.write_all(not_found.as_bytes());
            return;
        }
    };

    let header = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cross-Origin-Opener-Policy: same-origin\r\n\
         Cross-Origin-Embedder-Policy: require-corp\r\n\
         Cache-Control: no-cache\r\n\r\n",
        content_type,
        data.len()
    );

    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(data);
}

fn handle_save_file(request: &str, _raw_bytes: &[u8], stream: &mut TcpStream) {
    // Find body in HTTP POST
    let body_start = match request.find("\r\n\r\n") {
        Some(idx) => idx + 4,
        None => return,
    };
    let body = &request[body_start..];

    #[derive(serde::Deserialize)]
    struct SavePayload {
        filepath: String,
        base64_data: String,
    }

    let payload: Result<SavePayload, _> = serde_json::from_str(body);
    match payload {
        Ok(p) => {
            // Decode base64
            let decoded = match base64_decode(&p.base64_data) {
                Some(d) => d,
                None => {
                    send_json_error(stream, "Invalid base64 payload");
                    return;
                }
            };

            // Write to disk
            if let Some(parent) = std::path::Path::new(&p.filepath).parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            match std::fs::write(&p.filepath, decoded) {
                Ok(_) => {
                    let resp = "HTTP/1.1 200 OK\r\n\
                                Content-Type: application/json\r\n\
                                Access-Control-Allow-Origin: *\r\n\r\n\
                                {\"success\": true}";
                    let _ = stream.write_all(resp.as_bytes());
                }
                Err(e) => {
                    send_json_error(stream, &format!("File write error: {}", e));
                }
            }
        }
        Err(e) => {
            send_json_error(stream, &format!("Invalid JSON: {}", e));
        }
    }
}

fn send_json_error(stream: &mut TcpStream, msg: &str) {
    let err_body = serde_json::json!({
        "success": false,
        "error": msg
    }).to_string();

    let resp = format!(
        "HTTP/1.1 400 Bad Request\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\r\n{}",
        err_body.len(),
        err_body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let input = input.trim();
    let mut out = Vec::new();
    let chars: Vec<u8> = input.bytes().filter(|&b| b != b'\r' && b != b'\n' && b != b' ').collect();
    if chars.len() % 4 != 0 {
        return None;
    }

    let decode_val = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            b'=' => Some(0),
            _ => None,
        }
    };

    for chunk in chars.chunks(4) {
        let v0 = decode_val(chunk[0])?;
        let v1 = decode_val(chunk[1])?;
        let v2 = decode_val(chunk[2])?;
        let v3 = decode_val(chunk[3])?;

        out.push((v0 << 2) | (v1 >> 4));
        if chunk[2] != b'=' {
            out.push((v1 << 4) | (v2 >> 2));
        }
        if chunk[3] != b'=' {
            out.push((v2 << 6) | v3);
        }
    }

    Some(out)
}

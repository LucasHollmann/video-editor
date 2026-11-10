use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipExport {
    pub source_path: String,
    pub in_point: f64,
    pub out_point: f64,
}

#[cfg(target_os = "windows")]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_cmd: &mut Command) {}

fn run_command(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    hide_console(&mut cmd);
    cmd.output()
        .map_err(|e| format!("failed to run {}: {}", program, e))
}

#[tauri::command]
fn probe_video(path: String) -> Result<VideoInfo, String> {
    let output = run_command(
        "ffprobe",
        &[
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path,
        ],
    )?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse ffprobe output: {}", e))?;

    let duration: f64 = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or("could not read duration")?;

    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("no video stream found")?;

    let width = video_stream["width"].as_u64().unwrap_or(0) as u32;
    let height = video_stream["height"].as_u64().unwrap_or(0) as u32;

    Ok(VideoInfo {
        duration,
        width,
        height,
    })
}

#[tauri::command]
fn export_timeline(clips: Vec<ClipExport>, output_path: String) -> Result<(), String> {
    if clips.is_empty() {
        return Err("no clips to export".into());
    }

    let temp_dir = std::env::temp_dir().join(format!("video-editor-export-{}", std::process::id()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("failed to create temp dir: {}", e))?;

    let mut segment_paths: Vec<PathBuf> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        let segment_path = temp_dir.join(format!("segment_{:04}.mp4", i));
        let duration = (clip.out_point - clip.in_point).max(0.0);

        let output = run_command(
            "ffmpeg",
            &[
                "-y",
                "-ss",
                &clip.in_point.to_string(),
                "-i",
                &clip.source_path,
                "-t",
                &duration.to_string(),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                segment_path.to_str().ok_or("invalid segment path")?,
            ],
        )?;

        if !output.status.success() {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!(
                "ffmpeg failed on clip {}: {}",
                i,
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        segment_paths.push(segment_path);
    }

    let list_path = temp_dir.join("concat_list.txt");
    let list_contents = segment_paths
        .iter()
        .map(|p| format!("file '{}'", p.to_string_lossy().replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_path, list_contents).map_err(|e| format!("failed to write concat list: {}", e))?;

    let output = run_command(
        "ffmpeg",
        &[
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_path.to_str().ok_or("invalid list path")?,
            "-c",
            "copy",
            &output_path,
        ],
    )?;

    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        return Err(format!(
            "ffmpeg concat failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![probe_video, export_timeline])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

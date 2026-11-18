use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformExport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipExport {
    pub kind: String,
    pub source_path: String,
    pub in_point: f64,
    pub out_point: f64,
    pub transform: TransformExport,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackExport {
    pub clips: Vec<ClipExport>,
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

struct PlacedClip<'a> {
    clip: &'a ClipExport,
    start: f64,
    duration: f64,
}

fn even_dim(v: f64) -> i64 {
    let r = (v.round() as i64).max(2);
    if r % 2 == 0 {
        r
    } else {
        r + 1
    }
}

#[tauri::command]
fn export_timeline(
    tracks: Vec<TrackExport>,
    output_path: String,
    canvas_width: u32,
    canvas_height: u32,
) -> Result<(), String> {
    let mut placed: Vec<PlacedClip> = Vec::new();
    let mut total_duration = 0.0_f64;

    for track in &tracks {
        let mut cursor = 0.0_f64;
        for clip in &track.clips {
            let duration = (clip.out_point - clip.in_point).max(0.0);
            if duration > 0.0 {
                placed.push(PlacedClip {
                    clip,
                    start: cursor,
                    duration,
                });
            }
            cursor += duration;
        }
        total_duration = total_duration.max(cursor);
    }

    if placed.is_empty() || total_duration <= 0.0 {
        return Err("no clips to export".into());
    }

    let mut args: Vec<String> = vec!["-y".into()];

    // Input 0: a black canvas acting as the base layer for the whole timeline.
    args.push("-f".into());
    args.push("lavfi".into());
    args.push("-t".into());
    args.push(format!("{:.3}", total_duration));
    args.push("-i".into());
    args.push(format!("color=c=black:s={}x{}:r=30", canvas_width, canvas_height));

    let mut filter_parts: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();
    let mut video_label = "0:v".to_string();

    for (i, pc) in placed.iter().enumerate() {
        let clip = pc.clip;
        let input_index = i + 1;
        let start = pc.start.max(0.0);
        let end = start + pc.duration;

        if clip.kind == "image" {
            args.push("-loop".into());
            args.push("1".into());
            args.push("-t".into());
            args.push(format!("{:.3}", pc.duration));
            args.push("-i".into());
            args.push(clip.source_path.clone());
        } else {
            args.push("-ss".into());
            args.push(format!("{:.3}", clip.in_point));
            args.push("-t".into());
            args.push(format!("{:.3}", pc.duration));
            args.push("-i".into());
            args.push(clip.source_path.clone());

            let ms = (start * 1000.0).round() as i64;
            let label = format!("a{}", i);
            filter_parts.push(format!("[{}:a]adelay={}:all=1[{}]", input_index, ms, label));
            audio_labels.push(label);
        }

        let w = even_dim(clip.transform.width);
        let h = even_dim(clip.transform.height);
        let x = clip.transform.x.round() as i64;
        let y = clip.transform.y.round() as i64;
        let opacity = clip.transform.opacity.clamp(0.0, 1.0);

        let scaled_label = format!("v{}", i);
        filter_parts.push(format!(
            "[{}:v]scale={}:{},format=yuva420p,colorchannelmixer=aa={:.3},setpts=PTS-STARTPTS+({:.3}/TB)[{}]",
            input_index, w, h, opacity, start, scaled_label
        ));

        let out_label = format!("ov{}", i);
        filter_parts.push(format!(
            "[{}][{}]overlay=x={}:y={}:enable='between(t,{:.3},{:.3})'[{}]",
            video_label, scaled_label, x, y, start, end, out_label
        ));
        video_label = out_label;
    }

    let audio_label = if audio_labels.len() == 1 {
        Some(audio_labels[0].clone())
    } else if audio_labels.len() > 1 {
        let inputs: String = audio_labels.iter().map(|l| format!("[{}]", l)).collect();
        filter_parts.push(format!(
            "{}amix=inputs={}:normalize=0:duration=longest[aout]",
            inputs,
            audio_labels.len()
        ));
        Some("aout".to_string())
    } else {
        None
    };

    args.push("-filter_complex".into());
    args.push(filter_parts.join(";"));
    args.push("-map".into());
    args.push(format!("[{}]", video_label));
    if let Some(a) = &audio_label {
        args.push("-map".into());
        args.push(format!("[{}]", a));
    }

    args.push("-c:v".into());
    args.push("libx264".into());
    args.push("-preset".into());
    args.push("veryfast".into());
    args.push("-crf".into());
    args.push("20".into());
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    if audio_label.is_some() {
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("192k".into());
    }
    args.push("-t".into());
    args.push(format!("{:.3}", total_duration));
    args.push(output_path);

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_command("ffmpeg", &args_refs)?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
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

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
}

fn default_rotation() -> f64 {
    0.0
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformExport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    #[serde(default = "default_rotation")]
    pub rotation: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformKeyframeExport {
    pub time: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub opacity: f64,
    pub rotation: f64,
    pub volume: f64,
}

fn default_volume() -> f64 {
    1.0
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipExport {
    pub kind: String,
    pub source_path: String,
    pub start: f64,
    pub in_point: f64,
    pub out_point: f64,
    pub transform: TransformExport,
    #[serde(default)]
    pub keyframes: Vec<TransformKeyframeExport>,
    #[serde(default = "default_volume")]
    pub volume: f64,
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
fn probe_media(path: String) -> Result<VideoInfo, String> {
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

    // Static images have no duration field (or report "N/A"); default to 0 rather
    // than failing, so width/height can still be read for aspect-ratio sizing.
    let duration: f64 = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    let video_stream = json["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"));

    let width = video_stream.and_then(|s| s["width"].as_u64()).unwrap_or(0) as u32;
    let height = video_stream.and_then(|s| s["height"].as_u64()).unwrap_or(0) as u32;

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

// The on-screen bounding box of a `w` x `h` rectangle rotated by `degrees`.
fn rotated_bbox(w: f64, h: f64, degrees: f64) -> (f64, f64) {
    let rad = degrees.to_radians();
    let rot_w = (w * rad.cos()).abs() + (h * rad.sin()).abs();
    let rot_h = (w * rad.sin()).abs() + (h * rad.cos()).abs();
    (rot_w, rot_h)
}

// Builds an ffmpeg time expression (in terms of the output timeline's `t`) for one
// position axis (x or y), piecewise-linearly interpolating between keyframes. Each
// keyframe's `time` is local to the clip, so it's offset by `global_start` (the
// clip's start on the exported timeline). With no keyframes, falls back to a
// constant. Before the first keyframe / after the last, the value holds steady.
fn position_axis_expr(keyframes: &[(f64, f64)], global_start: f64, fallback: f64) -> String {
    if keyframes.is_empty() {
        return format!("{:.3}", fallback);
    }
    let mut sorted = keyframes.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    if sorted.len() == 1 {
        return format!("{:.3}", sorted[0].1);
    }

    let last = sorted.len() - 1;
    let mut expr = format!("{:.3}", sorted[last].1);
    for i in (0..last).rev() {
        let (t0, v0) = sorted[i];
        let (t1, v1) = sorted[i + 1];
        let boundary = global_start + t1;
        let span = (t1 - t0).max(0.001);
        let segment = format!(
            "({v0:.3}+({v1:.3}-{v0:.3})*(t-{seg_start:.3})/{span:.3})",
            v0 = v0,
            v1 = v1,
            seg_start = global_start + t0,
            span = span
        );
        expr = format!("if(lte(t,{boundary:.3}),{segment},{expr})", boundary = boundary, segment = segment, expr = expr);
    }
    let first_boundary = global_start + sorted[0].0;
    format!(
        "if(lt(t,{boundary:.3}),{value:.3},{expr})",
        boundary = first_boundary,
        value = sorted[0].1,
        expr = expr
    )
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

    for track in tracks.iter().rev() {
        for clip in &track.clips {
            let duration = (clip.out_point - clip.in_point).max(0.0);
            if duration > 0.0 {
                let start = clip.start.max(0.0);
                total_duration = total_duration.max(start + duration);
                placed.push(PlacedClip { clip, start, duration });
            }
        }
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
        }

        let has_keyframes = !clip.keyframes.is_empty();

        if clip.kind == "video" || clip.kind == "audio" {
            let ms = (start * 1000.0).round() as i64;
            let label = format!("a{}", i);
            let volume_filter = if has_keyframes {
                let volume_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.volume)).collect();
                let volume_expr = position_axis_expr(&volume_keyframes, start, clip.volume);
                format!("volume='max(({}),0)':eval=frame", volume_expr)
            } else {
                format!("volume={:.3}", clip.volume.max(0.0))
            };
            filter_parts.push(format!(
                "[{}:a]adelay={}:all=1,{}[{}]",
                input_index, ms, volume_filter, label
            ));
            audio_labels.push(label);
        }

        if clip.kind == "audio" {
            // Audio-only clip: no visual contribution to the composited video.
            continue;
        }

        // Base (static) dimensions, used for the rotation bounding-box/centering
        // math even when width/height are themselves animated (an approximation:
        // the rotation shift doesn't re-track an animated size).
        let base_w = even_dim(clip.transform.width);
        let base_h = even_dim(clip.transform.height);

        let x_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.x)).collect();
        let y_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.y)).collect();
        let width_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.width)).collect();
        let height_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.height)).collect();
        let opacity_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.opacity)).collect();
        let rotation_keyframes: Vec<(f64, f64)> = clip.keyframes.iter().map(|k| (k.time, k.rotation)).collect();

        // Width/height: a plain even number normally, or a per-frame expression
        // (rounded to even inside the expression itself) when animated.
        let (scale_w, scale_h, eval_frame) = if has_keyframes {
            let w_expr = position_axis_expr(&width_keyframes, start, clip.transform.width);
            let h_expr = position_axis_expr(&height_keyframes, start, clip.transform.height);
            (
                format!("trunc(({})/2)*2", w_expr),
                format!("trunc(({})/2)*2", h_expr),
                ":eval=frame",
            )
        } else {
            (base_w.to_string(), base_h.to_string(), "")
        };

        // Opacity: colorchannelmixer is fast but takes a constant; when animated,
        // fall back to geq to multiply the existing alpha by a time expression.
        let opacity_filter = if has_keyframes {
            let opacity_expr = position_axis_expr(&opacity_keyframes, start, clip.transform.opacity);
            format!(
                "geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*clip({},0,1)'",
                opacity_expr
            )
        } else {
            format!("colorchannelmixer=aa={:.3}", clip.transform.opacity.clamp(0.0, 1.0))
        };

        // Rotation: a constant angle (with ffmpeg's own rotw()/roth() helpers for
        // the output size) or a per-frame expression over a fixed worst-case box
        // sized from every keyframe's angle, so the canvas size stays constant.
        let (x_shift, y_shift, rotate_filter) = if has_keyframes {
            let max_abs_rotation = rotation_keyframes
                .iter()
                .map(|(_, r)| r.abs())
                .fold(clip.transform.rotation.abs(), f64::max);
            let (fixed_w, fixed_h) = rotated_bbox(base_w as f64, base_h as f64, max_abs_rotation);
            if fixed_w - base_w as f64 > 0.5 || fixed_h - base_h as f64 > 0.5 {
                let rot_expr = position_axis_expr(&rotation_keyframes, start, clip.transform.rotation);
                let filter = format!(
                    ",rotate=a='({})*PI/180':fillcolor=none:ow={:.0}:oh={:.0}",
                    rot_expr, fixed_w, fixed_h
                );
                ((fixed_w - base_w as f64) / 2.0, (fixed_h - base_h as f64) / 2.0, filter)
            } else {
                (0.0, 0.0, String::new())
            }
        } else if clip.transform.rotation.abs() > 0.01 {
            let rotation = clip.transform.rotation;
            let (rot_w, rot_h) = rotated_bbox(base_w as f64, base_h as f64, rotation);
            let filter = format!(
                ",rotate={rot:.6}*PI/180:fillcolor=none:ow=rotw({rot:.6}*PI/180):oh=roth({rot:.6}*PI/180)",
                rot = rotation
            );
            ((rot_w - base_w as f64) / 2.0, (rot_h - base_h as f64) / 2.0, filter)
        } else {
            (0.0, 0.0, String::new())
        };

        let mut x_expr = position_axis_expr(&x_keyframes, start, clip.transform.x);
        let mut y_expr = position_axis_expr(&y_keyframes, start, clip.transform.y);
        if x_shift != 0.0 {
            x_expr = format!("(({})-({:.3}))", x_expr, x_shift);
        }
        if y_shift != 0.0 {
            y_expr = format!("(({})-({:.3}))", y_expr, y_shift);
        }

        let scaled_label = format!("v{}", i);
        filter_parts.push(format!(
            "[{}:v]scale=w='{}':h='{}'{},format=yuva420p,{}{},setpts=PTS-STARTPTS+({:.3}/TB)[{}]",
            input_index, scale_w, scale_h, eval_frame, opacity_filter, rotate_filter, start, scaled_label
        ));

        let out_label = format!("ov{}", i);
        filter_parts.push(format!(
            "[{}][{}]overlay=x='{}':y='{}':enable='between(t,{:.3},{:.3})'[{}]",
            video_label, scaled_label, x_expr, y_expr, start, end, out_label
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
        .invoke_handler(tauri::generate_handler![probe_media, export_timeline])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

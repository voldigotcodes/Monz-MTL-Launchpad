#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    fs,
    io::{BufRead, BufReader},
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::SystemTime,
};
use tauri::{Manager, Window};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
    folder_path: String,
    product_name: String,
    brand_name: Option<String>,
    product_url: String,
    country: String,
    daily_budget: f64,
    campaign_active: bool,
    launch_immediately: bool,
    schedule_time: Option<String>,
    preset: Option<Value>,
    launch_type: Option<String>,
    add_mode: Option<String>,
    campaign_id: Option<String>,
    target_adset_ids: Option<Vec<String>>,
    adset_name: Option<String>,
    multi_advertiser_ads: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct PreviewData {
    campaigns: Value,
    launch_date: String,
    total_ads: u32,
    media_summary: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanArgs {
    folder_path: String,
    country: Option<String>,
}

struct LauncherPaths {
    root: PathBuf,
    launcher_dir: PathBuf,
}

fn project_root() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    }
    #[cfg(not(debug_assertions))]
    {
        env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn launcher_paths(_app: &tauri::AppHandle) -> Result<LauncherPaths, String> {
    #[cfg(debug_assertions)]
    {
        let root = project_root();
        return Ok(LauncherPaths {
            root: root.clone(),
            launcher_dir: root.join("launcher"),
        });
    }
    #[cfg(not(debug_assertions))]
    {
        let launch_py = _app
            .path_resolver()
            .resolve_resource("launcher/launch.py")
            .ok_or_else(|| "Bundled launcher not found (expected resource: launcher/launch.py).".to_string())?;
        let launcher_dir = launch_py
            .parent()
            .ok_or_else(|| "Invalid bundled launcher path.".to_string())?
            .to_path_buf();
        let root = launcher_dir
            .parent()
            .unwrap_or(&launcher_dir)
            .to_path_buf();
        Ok(LauncherPaths { root, launcher_dir })
    }
}

fn python_program() -> String {
    if let Ok(value) = env::var("LAUNCHPAD_PYTHON") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    #[cfg(windows)]
    {
        "python".to_string()
    }
    #[cfg(not(windows))]
    {
        "python3".to_string()
    }
}

fn apply_python_env(
    cmd: &mut Command,
    root: &Path,
    launcher_dir: &Path,
    work_dir: &Path,
) -> Result<(), String> {
    let python_path: OsString =
        env::join_paths([root, launcher_dir]).map_err(|e| e.to_string())?;
    cmd.current_dir(work_dir).env("PYTHONPATH", python_path);
    Ok(())
}

fn unique_summary_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("launch_summary_{nanos}.json"))
}

fn pipe_output(window: Window, reader: impl std::io::Read + Send + 'static, prefix: &str) {
    let label = prefix.to_string();
    std::thread::spawn(move || {
        let buf_reader = BufReader::new(reader);
        for line in buf_reader.lines().flatten() {
            let payload = if label.is_empty() {
                line
            } else {
                format!("{label} {line}")
            };
            let _ = window.emit("launch-log", payload);
        }
    });
}

#[tauri::command]
fn scan_launch_folder(app: tauri::AppHandle, params: ScanArgs) -> Result<PreviewData, String> {
    let paths = launcher_paths(&app)?;
    let mut cmd = Command::new(python_program());
    let work_dir = {
        #[cfg(debug_assertions)]
        {
            paths.root.clone()
        }
        #[cfg(not(debug_assertions))]
        {
            app.path_resolver()
                .app_config_dir()
                .unwrap_or_else(|| paths.root.clone())
        }
    };
    let _ = fs::create_dir_all(&work_dir);
    apply_python_env(&mut cmd, &paths.root, &paths.launcher_dir, &work_dir)?;
    let mut args = vec![
        "-c".to_string(),
        "import json,sys;from launcher.launch_core import build_preview;country=sys.argv[2] if len(sys.argv)>2 else None;print(json.dumps(build_preview(sys.argv[1], country)))".to_string(),
        params.folder_path.clone(),
    ];
    if let Some(country_code) = params.country.clone() {
        args.push(country_code);
    }
    cmd.args(args);

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Python executable not found. Install Python or set LAUNCHPAD_PYTHON.".to_string()
        } else {
            e.to_string()
        }
    })?;
    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err_text.is_empty() {
            "Python preview failed".into()
        } else {
            err_text
        });
    }

    serde_json::from_slice::<PreviewData>(&output.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_launcher(window: Window, payload: LaunchPayload) -> Result<Value, String> {
    let summary_path = unique_summary_path();
    let app = window.app_handle();
    let paths = launcher_paths(&app)?;
    let launch_script = paths
        .launcher_dir
        .join("launch.py")
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "-u".to_string(),
        launch_script,
        "--campaign-folder-path".to_string(),
        payload.folder_path.clone(),
        "--product-url".to_string(),
        payload.product_url.clone(),
        "--country".to_string(),
        payload.country.clone(),
        "--daily-budget".to_string(),
        payload.daily_budget.to_string(),
        "--campaign-status".to_string(),
        if payload.campaign_active { "ACTIVE".into() } else { "PAUSED".into() },
        "--summary-file".to_string(),
        summary_path.to_string_lossy().to_string(),
        "--json-output".to_string(),
    ];

    if !payload.product_name.trim().is_empty() {
        args.push("--product-name".to_string());
        args.push(payload.product_name.clone());
    }
    if payload.launch_immediately {
        args.push("--launch-now".to_string());
    }
    if let Some(start) = payload.schedule_time.as_ref() {
        if !start.is_empty() {
            args.push("--start-time-iso".to_string());
            args.push(start.clone());
        }
    }
    // New launch modes
    args.push("--launch-type".to_string());
    args.push(payload.launch_type.clone().unwrap_or_else(|| "new_campaign".into()));
    args.push("--add-mode".to_string());
    args.push(payload.add_mode.clone().unwrap_or_else(|| "creatives_only".into()));
    if let Some(cid) = payload.campaign_id.as_ref() {
        if !cid.is_empty() {
            args.push("--campaign-id".to_string());
            args.push(cid.clone());
        }
    }
    if let Some(adset_ids) = payload.target_adset_ids.as_ref() {
        if !adset_ids.is_empty() {
            args.push("--target-adset-ids".to_string());
            args.push(adset_ids.join(","));
        }
    }
    if let Some(adset_name) = payload.adset_name.as_ref() {
        if !adset_name.is_empty() {
            args.push("--adset-name".to_string());
            args.push(adset_name.clone());
        }
    }
    if let Some(flag) = payload.multi_advertiser_ads {
        args.push("--multi-advertiser-ads".to_string());
        args.push(flag.to_string());
    }

    let mut child = Command::new(python_program());
    let work_dir = {
        #[cfg(debug_assertions)]
        {
            paths.root.clone()
        }
        #[cfg(not(debug_assertions))]
        {
            app.path_resolver()
                .app_config_dir()
                .unwrap_or_else(|| paths.root.clone())
        }
    };
    let _ = fs::create_dir_all(&work_dir);
    apply_python_env(&mut child, &paths.root, &paths.launcher_dir, &work_dir)?;
    let mut child = child
        .env(
            "COPY_PRESET_JSON",
            serde_json::to_string(&payload.preset).unwrap_or_default(),
        )
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Python executable not found. Install Python or set LAUNCHPAD_PYTHON.".to_string()
            } else {
                e.to_string()
            }
        })?;

    if let Some(stdout) = child.stdout.take() {
        pipe_output(window.clone(), stdout, "");
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_output(window.clone(), stderr, "ERR •");
    }

    let status = tauri::async_runtime::spawn_blocking(move || child.wait())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    let summary_text_result = fs::read_to_string(&summary_path);
    let _ = fs::remove_file(&summary_path);
    let summary_text =
        summary_text_result.map_err(|_| "Launch finished but summary was not written".to_string())?;
    let summary_json: Value = serde_json::from_str(&summary_text).map_err(|e| e.to_string())?;

    if !status.success() {
        return Err(format!("Python exited with status {status}"));
    }

    Ok(summary_json)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_launcher, scan_launch_folder])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_window("main") {
                let _ = window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

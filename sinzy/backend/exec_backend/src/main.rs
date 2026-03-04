use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event as SseEvent, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    path:: PathBuf,
    sync::Arc,
    time::Duration,
};
use tempfile::TempDir;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{broadcast, Mutex, RwLock},
};
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::CorsLayer;
use uuid::Uuid;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};


const REPO_ROOT: &str = "/home/amon/workspace/M-OFDFT";

// CAUTION: Create micromamba environment from terminal.
const MICROMAMBA_BIN: &str = "/usr/local/bin/micromamba";
const MAMBA_ROOT_PREFIX: &str = "/home/amon/.local/share/mamba";
const MAMBA_ENV_NAME: &str = "mofdft";

fn mamba_run_prefix<'a>() -> [&'a str; 5] {
    ["-r", MAMBA_ROOT_PREFIX, "run", "-n", MAMBA_ENV_NAME]
}

fn repo_root() -> PathBuf {
    PathBuf::from(REPO_ROOT)
}


async fn hello() -> &'static str {
    "Hello from Rust backend"
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
enum RunEvent {
    #[serde(rename = "stdout")]
    Stdout { data: String },

    #[serde(rename = "stderr")]
    Stderr { data: String },

    #[serde(rename = "trace")]
    Trace {
        event: String,
        file: String,
        fn_name: String,
        line: u32,
        locals: serde_json::Value,
    },

    #[serde(rename = "exit")]
    Exit { code: i32 },

    #[serde(rename = "error")]
    Error { message: String },

    #[serde(rename = "started")]
    Started { command: String, cwd: String },
}

struct RunHandle {
    tx: broadcast::Sender<RunEvent>,
    child: Arc<Mutex<Child>>,
    _tmp: Option<TempDir>,
    log: Arc<Mutex<VecDeque<RunEvent>>>,
}

async fn record_and_send(log: &Arc<Mutex<VecDeque<RunEvent>>>, tx: &broadcast::Sender<RunEvent>, evt: RunEvent) {
    {
        let mut lg = log.lock().await;
        if lg.len() >= 2000 { lg.pop_front(); }
        lg.push_back(evt.clone());
    }
    let _ = tx.send(evt);
}

#[derive(Clone)]
struct AppState {
    runs: Arc<RwLock<HashMap<String, RunHandle>>>,
    scratch_dir: PathBuf,
    runner_py: PathBuf,
}

#[derive(Serialize)]
struct ScratchFile {
    name: String,
    text: String,
}

async fn read_scratch(State(st): State<AppState>) -> Json<Vec<ScratchFile>> {
    let mut out = Vec::new();

    let mut rd = match tokio::fs::read_dir(&st.scratch_dir).await {
        Ok(r) => r,
        Err(_) => return Json(out),
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        if entry.file_type().await.map(|t| t.is_file()).unwrap_or(false) {
            let name = entry.file_name().to_string_lossy().to_string();
            let text = match tokio::fs::read_to_string(entry.path()).await {
                Ok(t) => t,
                Err(_) => continue,
            };
            out.push(ScratchFile { name, text });
        }
    }

    Json(out)
}

#[derive(Deserialize)]
struct RunRequest {
    name: String,
}

#[derive(Serialize)]
struct RunResponse {
    run_id: String,
}

fn validate_script_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 200 {
        return false;
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }
    name.ends_with(".py") || name.ends_with(".sh")
}

async fn start_run(State(st): State<AppState>, Json(req): Json<RunRequest>) -> Result<Json<RunResponse>, (StatusCode, String)> {
    if !validate_script_name(&req.name) {
        return Err((StatusCode::BAD_REQUEST, "Invalid script name".to_string()));
    }

    let src_path = st.scratch_dir.join(&req.name);
    if !src_path.exists() {
        return Err((StatusCode::NOT_FOUND, "Script not found".to_string()));
    }

    // Decide root directory
    let root = repo_root()
        .canonicalize()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid REPO_ROOT: {e}")))?;

    // prepare temp only if python
    let mut tmp_opt: Option<TempDir> = None;
    let mut tmp_script_opt: Option<PathBuf> = None;

    if req.name.ends_with(".py") {
        let script_text = tokio::fs::read_to_string(&src_path)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read script: {e}")))?;

        let tmp = tempfile::tempdir()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Tempdir error: {e}")))?;
        let tmp_script = tmp.path().join("main.py");

        tokio::fs::write(&tmp_script, script_text)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write temp script: {e}")))?;
        tmp_opt = Some(tmp);
        tmp_script_opt = Some(tmp_script);
    }

    let run_id = Uuid::new_v4().to_string();
    let (tx, _rx) = broadcast::channel::<RunEvent>(1024);
    let log = Arc::new(Mutex::new(VecDeque::new()));

    // Build command
    let mut cmd = if req.name.ends_with(".py") {
        let tmp_script = tmp_script_opt.clone().unwrap();
        let mut c = Command::new(MICROMAMBA_BIN);

        c.args(mamba_run_prefix())
            .arg("python")
            .arg("-u")
            .arg(&st.runner_py)
            .arg(tmp_script)
            .env("PYTHONUNBUFFERED", "1");
        c
    } else if req.name.ends_with(".sh") {
        let script_path = st.scratch_dir.join(&req.name);

        let mut c = Command::new(MICROMAMBA_BIN);

        // not to copy script to temp, run directly
        c.args(mamba_run_prefix())
            .arg("bash")
            .arg("-x")
            .arg(script_path);
        c
    } else {
        return Err((StatusCode::BAD_REQUEST, "Unsupported file type".to_string()));
    };

    // Run from repo root
    cmd.current_dir(&root);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    // In order to understand importing module as dir
    cmd.env("PYTHONPATH", root.to_string_lossy().to_string());

    record_and_send(
        &log,
        &tx,
        RunEvent::Stdout { data: format!("CMD DEBUG: {:?}\n", cmd) },
    ).await;

    // Spawn
    let mut child = cmd
        .spawn()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to spawn python: {e}")))?;

    let stdout = child.stdout.take().ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Missing stdout".to_string()))?;
    let stderr = child.stderr.take().ok_or((StatusCode::INTERNAL_SERVER_ERROR, "Missing stderr".to_string()))?;

    let child = Arc::new(Mutex::new(child));

    // Store handle before streaming begins
    {
        let mut runs = st.runs.write().await;
        runs.insert(
            run_id.clone(),
            RunHandle {
                tx: tx.clone(),
                child: child.clone(),
                _tmp: tmp_opt,
                log: log.clone(),
            },
        );
    }

    record_and_send(&log, &tx, RunEvent::Started { command: format!("{:?}", cmd), cwd: root.to_string_lossy().to_string() }).await;

    // read stdout lines, parse trace prefix, broadcast events
    {
        let log_out = log.clone();
        let tx_out = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(json_part) = line.strip_prefix("__TRACE__") {
                    match serde_json::from_str::<serde_json::Value>(json_part) {
                        Ok(v) => {
                            let event = v.get("event").and_then(|x| x.as_str()).unwrap_or("unknown").to_string();
                            let file = v.get("file").and_then(|x| x.as_str()).unwrap_or("").to_string();
                            let fn_name = v.get("fn").and_then(|x| x.as_str()).unwrap_or("").to_string();
                            let line_no = v.get("line").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                            let locals = v.get("locals").cloned().unwrap_or_else(|| serde_json::Value::Null);

                            record_and_send(&log_out, &tx_out, RunEvent::Trace {
                                event,
                                file,
                                fn_name,
                                line: line_no,
                                locals,
                            }).await;
                        }
                        Err(_) => {
                            record_and_send(&log_out, &tx_out, RunEvent::Stdout { data: format!("{line}\n") }).await;
                        }
                    }
                } else {
                    record_and_send(&log_out, &tx_out, RunEvent::Stdout { data: format!("{line}\n") }).await;
                }
            }
        });
    }

    // read stderr lines
    {
        let log_err = log.clone();
        let tx_err = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                record_and_send(&log_err, &tx_err, RunEvent::Stderr { data: format!("{line}\n") }).await;
            }
        });
    }

    // wait for exit, broadcast exit, and cleanup map entry
    {
        let st2 = st.clone();
        let log_wait = log.clone();
        let tx_wait = tx.clone();
        let run_id2 = run_id.clone();
        let child2 = child.clone();

        tokio::spawn(async move {
            // for abuse
            let timeout = Duration::from_secs(30 * 60);

            let status = tokio::time::timeout(timeout, async {
                let mut ch = child2.lock().await;
                ch.wait().await
            })
            .await;

            match status {
                Ok(Ok(exit_status)) => {
                    let code = exit_status.code().unwrap_or(-1);
                    record_and_send(&log_wait, &tx_wait, RunEvent::Exit { code }).await;
                }
                Ok(Err(e)) => {
                    record_and_send(&log_wait, &tx_wait, RunEvent::Error { message: format!("Wait error: {e}") }).await;
                }
                Err(_) => {
                    // timeout
                    {
                        let mut ch = child2.lock().await;
                        let _ = ch.kill().await;
                    }
                    record_and_send(&log, &tx, RunEvent::Error { message: "Timeout: process killed".to_string() }).await;
                    record_and_send(&log, &tx, RunEvent::Exit { code: -1 }).await;
                }
            }

            // cleanup
            // keep run for a short time so SSE clients can still connect
            tokio::time::sleep(Duration::from_secs(60)).await;
            let mut runs = st2.runs.write().await;
            runs.remove(&run_id2);
        });
    }

    Ok(Json(RunResponse { run_id }))
}


async fn sse_events(
    State(st): State<AppState>,
    Path(run_id): Path<String>,
    _headers: HeaderMap,
) -> Result<Sse<impl futures_util::Stream<Item = Result<SseEvent, axum::Error>>>, (StatusCode, String)> {

    let (tx, log) = {
        let runs = st.runs.read().await;
        let h = runs.get(&run_id).ok_or((StatusCode::NOT_FOUND, "Unkown run_id".to_string()))?;
        (h.tx.clone(), h.log.clone())
    };

    let backlog = {
        let lg = log.lock().await;
        lg.iter().cloned().collect::<Vec<_>>()
    };

    let live = BroadcastStream::new(tx.subscribe()).filter_map(|msg| async move {
        match msg {
            Ok(evt) => {
                let json = serde_json::to_string(&evt).ok()?;
                Some(Ok(SseEvent::default().data(json)))
            }
            Err(_) => None,
        }
    });

    let init = tokio_stream::iter(backlog.into_iter().filter_map(|evt| {
        serde_json::to_string(&evt).ok().map(|json| Ok(SseEvent::default().data(json)))
    }));

    let stream = init.chain(live);


    /*
    let rx = tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| async move {
        match msg {
            Ok(evt) => {
                let json = serde_json::to_string(&evt).ok()?;
                Some(Ok(SseEvent::default().data(json)))
            }
            Err(_) => None,
        }
    });
    */

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}

async fn stop_run(State(st): State<AppState>, Path(run_id): Path<String>) -> Result<StatusCode, (StatusCode, String)> {
    let (child, tx, log) = {
        let runs = st.runs.read().await;
        let h = runs.get(&run_id).ok_or((StatusCode::NOT_FOUND, "Unkown run_id".to_string()))?;
        (h.child.clone(), h.tx.clone(), h.log.clone())
    };

    {
        let mut ch = child.lock().await;
        let _ = ch.kill().await;
    }

    record_and_send(&log, &tx, RunEvent::Error { message: "Stopped by user".to_string() }).await;
    record_and_send(&log, &tx, RunEvent::Exit { code: -1 }).await;

    Ok(StatusCode::NO_CONTENT)
}

#[tokio::main]
async fn main() {
    let scratch_dir = repo_root().join("scratch");

    let runner_py = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("./runner.py").canonicalize()
        .expect("runner.py path invalid");
    if !runner_py.exists() {
        eprintln!("runner.py not found at {:?}!", runner_py);
    }

    let st = AppState {
        runs: Arc::new(RwLock::new(HashMap::new())),
        scratch_dir,
        runner_py,
    };

    let app = Router::new()
        .route("/hello", get(hello))
        .route("/api/scratch", get(read_scratch))
        .route("/api/run", post(start_run))
        .route("/api/run/:id/events", get(sse_events))
        .route("/api/run/:id/stop", post(stop_run))
        .layer(CorsLayer::very_permissive())
        .with_state(st);

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8787);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    //let listener = tokio::net::TcpListener::bind("127:0.0.1:8787")
        //.await
        //.unwrap();

    axum::serve(listener, app).await.unwrap();
}

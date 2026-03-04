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
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{broadcast, Mutex, RwLock},
};
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::CorsLayer;
use uuid::Uuid;
use tokio::io::AsyncWriteExt;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
enum RunEvent {
    #[serde(rename = "stdout")]
    Stdout { data: String },
    #[serde(rename = "stderr")]
    Stderr { data: String },
    #[serde(rename = "exit")]
    Exit { code: i32 },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "started")]
    Started { command: String, cwd: String },
}

struct RunHandle {
    tx: broadcast::Sender<RunEvent>,
    job_id: String,
    tail_child: Arc<Mutex<Child>>,
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
struct RemoteConfig {
    user_host: String,
    repo_root: PathBuf,
}

impl RemoteConfig {
    fn slurm_log_path(&self, job_id: &str) -> String {
        format!("{}/slurm/{}_evaluation.txt", self.repo_root.display(), job_id)
    }
}

fn ssh_base_args(rc: &RemoteConfig) -> Vec<String> {
    vec![
        "-o".into(), "BatchMode=yes".into(),
        "-o".into(), "StrictHostKeyChecking=accept-new".into(),
        rc.user_host.clone(),
    ]
}


#[derive(Serialize, Deserialize)]
struct ScratchFile {
    name: String,
    text: String,
}

async fn read_scratch_remote(State(st): State<AppState>) -> Json<Vec<ScratchFile>> {
    let mut out: Vec<ScratchFile> = Vec::new();

    let remote_scratch = format!("{}/scratch", st.remote.repo_root.display());  
    let remote_program = r#"
set -euo pipefail

if [ -z "${SCRATCH:-}" ]; then echo "SCRATCH not set" >&2; exit 1; fi

perl -CS -MJSON::PP -MEncode -e '
    use strict; use warnings;
    my $scratch = $ENV{SCRATCH} or die "SCRATCH not set\n";
    opendir(my $dh, $scratch) or die "opendir: $!\n";
    my @files = sort grep { -f "$scratch/$_" } readdir($dh);
    closedir $dh;

    my @out;
    for my $f (@files) {
        next unless $f =~ /\.(py|sh|txt|md|json)$/;
        open(my $fh, "<:raw", "$scratch/$f") or next;
        local $/;
        my $bytes = <$fh>;
        close $fh;

        my $text = Encode::decode("UTF-8", $bytes, Encode::FB_DEFAULT);
        push @out, { name => $f, text => $text };
        }
        print JSON::PP->new->utf8->encode(\@out);
        '
"#;

    let remote_cmd = format!("SCRATCH='{}' bash -s", remote_scratch);

    let args = ssh_base_args(&st.remote);

    let mut child = match Command::new("ssh")
        .args(&args)
        .arg(remote_cmd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return Json(out),
    };

    if let Some(mut stdin) = child.stdin.take() {
        if stdin.write_all(remote_program.as_bytes()).await.is_err() {
            return Json(out);
        }
        let _ = stdin.shutdown().await;
    }

    let output = match child.wait_with_output().await {
        Ok(o) => o,
        Err(_) => return Json(out),
    };

    if !output.status.success() {
        eprintln!(
            "[read_scratch_remote stderr] {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Json(out);
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();
    match serde_json::from_str::<Vec<ScratchFile>>(&body) {
        Ok(v) => out = v,
        Err(e) => {
            eprintln!("[read_scratch_remote] JSON parse error: {e}");
            eprintln!(
                "[read_scratch_remote] body head: {}",
                body.chars().take(200).collect::<String>()
            );
        }
    }

    Json(out)
}

async fn ssh_capture(rc: &RemoteConfig, remote_cmd: &str) -> Result<String, String> {
    let mut args = ssh_base_args(rc);
    args.push(remote_cmd.to_string());

    let out = Command::new("ssh")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("ssh spawn failed: {e}"))?;

    if !out.status.success() {
        return Err(format!(
                "ssh failed (code {:?}): {}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

async fn remote_sbatch(rc: &RemoteConfig, script_name: &str) -> Result<String, String> {
    let script_rel = format!("scratch/{}", script_name);
    let cmd = format!("cd {} && sbatch --parsable {}", rc.repo_root.display(), script_rel);
    let out = ssh_capture(rc, &cmd).await?;
    let job_id = out.trim().to_string();

    if job_id.is_empty() || !job_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Unexpected sbatch output: {out:?}"));
    }
    Ok(job_id)
}

async fn spawn_remote_tail(
    rc: RemoteConfig,
    job_id: String,
    log: Arc<Mutex<VecDeque<RunEvent>>>,
    tx: broadcast::Sender<RunEvent>,
) -> Result<Arc<Mutex<Child>>, String> {

    let log_path = rc.slurm_log_path(&job_id);
    let remote_cmd = format!("tail -n +1 -F {}", log_path);

    let mut args = ssh_base_args(&rc);
    args.push(remote_cmd);

    let mut child = Command::new("ssh")
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ssh tail: {e}"))?;

    let stdout = child.stdout.take().ok_or("missing ssh stdout")?;
    let stderr = child.stderr.take().ok_or("missing ssh stderr")?;

    let child = Arc::new(Mutex::new(child));

    {
        let log_out = log.clone();
        let tx_out = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                record_and_send(&log_out, &tx_out, RunEvent::Stdout { data: format!("{line}\n") }).await;
            }
        });
    }

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

    Ok(child)
}

async fn remote_scancel(rc: &RemoteConfig, job_id: &str) -> Result<(), String> {
    let cmd = format!("scancel {}", job_id);
    let _ = ssh_capture(rc, &cmd).await?;
    Ok(())
}

async fn wait_job_done(rc: RemoteConfig, job_id: String, log: Arc<Mutex<VecDeque<RunEvent>>>, tx: broadcast::Sender<RunEvent>) {
    loop {
        let cmd = format!("squeue -j {} -h", job_id);
        let out = match ssh_capture(&rc, &cmd).await {
            Ok(v) => v,
            Err(e) => {
                record_and_send(&log, &tx, RunEvent::Error { message: format!("squeue error: {e}") }).await;
                break;
            }
        };
        if out.trim().is_empty() {
            record_and_send(&log, &tx, RunEvent::Exit { code: 0 }).await;
            break;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}


#[derive(Clone)]
struct AppState {
    runs: Arc<RwLock<HashMap<String, RunHandle>>>,
    remote: RemoteConfig,
}

#[derive(Deserialize)]
struct RunRequest {
    name: String,
}

#[derive(Serialize)]
struct RunResponse {
    run_id: String,
    job_id: String,
}

fn validate_remote_script(name: &str) -> bool {
    if name.is_empty() || name.len() > 200 { return false; }
    if name.contains('/') || name.contains('\\') || name.contains("..") { return false; }
    name.ends_with(".sh")
}

async fn start_remote_run(
    State(st): State<AppState>,
    Json(req): Json<RunRequest>,
) -> Result<Json<RunResponse>, (StatusCode, String)> {
    if !validate_remote_script(&req.name) {
        return Err((StatusCode::BAD_REQUEST, "Files other than shell scripts are not supported".to_string()));
    }

    let run_id = Uuid::new_v4().to_string();
    let (tx, _rx) = broadcast::channel::<RunEvent>(1024);
    let log = Arc::new(Mutex::new(VecDeque::new()));

    let job_id = remote_sbatch(&st.remote, &req.name)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    record_and_send(
        &log,
        &tx,
        RunEvent::Started {
            command: format!("sbatch {}", req.name),
            cwd: st.remote.repo_root.display().to_string(),
    }
    )
    .await;

    let tail_child = spawn_remote_tail(st.remote.clone(), job_id.clone(), log.clone(), tx.clone())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Store
    {
        let mut runs = st.runs.write().await;
        runs.insert(
            run_id.clone(),
            RunHandle {
                tx: tx.clone(),
                job_id: job_id.clone(),
                tail_child: tail_child.clone(),
                log: log.clone(),
            },
        );
    }

    // Wait + cleanup
    {
        let st2 = st.clone();
        let run_id2 = run_id.clone();
        let job_id2 = job_id.clone();
        let log2 = log.clone();
        let _tx2 = tx.clone();
        let tail2 = tail_child.clone();
        tokio::spawn(async move {
            wait_job_done(st2.remote.clone(), job_id2, log2.clone(), tx.clone()).await;
            {
                let mut ch = tail2.lock().await;
                let _ = ch.kill().await;
            }

            tokio::time::sleep(Duration::from_secs(60)).await;
            let mut runs = st2.runs.write().await;
            runs.remove(&run_id2);
        });
    }

    Ok(Json(RunResponse { run_id, job_id }))
}

async fn sse_events(
    State(st): State<AppState>,
    Path(run_id): Path<String>,
    _headers: HeaderMap,
) -> Result<Sse<impl futures_util::Stream<Item = Result<SseEvent, axum::Error>>>, (StatusCode, String)> {
    let (tx, log) = {
        let runs = st.runs.read().await;
        let h = runs.get(&run_id).ok_or((StatusCode::NOT_FOUND, "Unknown run_id".to_string()))?;
        (h.tx.clone(), h.log.clone())
    };

    let backlog = {
        let lg = log.lock().await;
        lg.iter().cloned().collect::<Vec<_>>()
    };

    let init = tokio_stream::iter(backlog.into_iter().filter_map(|evt| {
        serde_json::to_string(&evt).ok().map(|json| Ok(SseEvent::default().data(json)))
    }));

    let live = BroadcastStream::new(tx.subscribe()).filter_map(|msg| async move {
        match msg {
            Ok(evt) => {
                let json = serde_json::to_string(&evt).ok()?;
                Some(Ok(SseEvent::default().data(json)))
            }
            Err(_) => None,
        }
    });

    let stream = init.chain(live);

    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(10))))
}


async fn stop_remote_run(
    State(st): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let (job_id, tail_child, tx, log) = {
        let runs = st.runs.read().await;
        let h = runs.get(&run_id).ok_or((StatusCode::NOT_FOUND, "Unkown run_id".to_string()))?;
        (h.job_id.clone(), h.tail_child.clone(), h.tx.clone(), h.log.clone())
    };

    remote_scancel(&st.remote, &job_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    {
        let mut ch = tail_child.lock().await;
        let _ = ch.kill().await;
    }

    record_and_send(&log, &tx, RunEvent::Error { message: "Stopped by user".to_string() }).await;
    record_and_send(&log, &tx, RunEvent::Exit { code: -1 }).await;

    Ok(StatusCode::NO_CONTENT)
}

#[tokio::main]
async fn main() {
    let remote = RemoteConfig {
        user_host: "nadeko".to_string(),
        repo_root: PathBuf::from("/home/asuzuki/M-OFDFT"),
    };

    let st = AppState {
        runs: Arc::new(RwLock::new(HashMap::new())),
        remote,
    };

    let app = Router::new()
        .route("/api/scratch", get(read_scratch_remote))
        .route("/api/run", post(start_remote_run))
        .route("/api/run/:id/events", get(sse_events))
        .route("/api/run/:id/stop", post(stop_remote_run))
        .layer(CorsLayer::very_permissive())
        .with_state(st);

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8787);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    axum::serve(listener, app).await.unwrap();
}


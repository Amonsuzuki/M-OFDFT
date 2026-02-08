use axum::{routing::get, Router};
use tower_http::cors::CorsLayer;
use serde::Serialize;
use tokio::fs;
use std::path::PathBuf;

#[derive(Serialize)]
struct ScratchFile {
    name: String,
    text: String,
}

async fn read_scratch() -> axum::Json<Vec<ScratchFile>> {
    let mut out = Vec::new();

    let scratch_dir = PathBuf::from("../../../scratch");

    let mut rd = match fs::read_dir(&scratch_dir).await {
        Ok(r) => r,
        Err(_) => return axum::Json(out),
    };

    while let Ok(Some(entry)) = rd.next_entry().await {
        if entry.file_type().await.map(|t| t.is_file()).unwrap_or(false) {
            let name = entry.file_name().to_string_lossy().to_string();
            let text = match fs::read_to_string(entry.path()).await {
                Ok(t) => t,
                Err(_) => continue,
            };
            out.push(ScratchFile { name, text });
        }
    }

    axum::Json(out)
}

async fn hello() -> &'static str {
    "Hello from Rust backend"
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/hello", get(hello))
        .route("/api/scratch", get(read_scratch))
        .layer(CorsLayer::very_permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8787")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}

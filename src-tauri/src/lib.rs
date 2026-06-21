// Tessera's Rust core. The webview keeps doing what a browser does well
// (research fan-out against CORS-open archives, the weave, the UI); this
// crate does what a browser cannot: talk to ANY model server without CORS,
// with API keys that never enter webview-page code. The learner's model --
// local weights via Ollama / an OpenAI-compatible server, or a hosted API --
// is reached only from here.
//
// Everything below is plain async Rust over HTTP, deliberately free of
// Windows-only assumptions: the same commands compile on Linux/macOS, and
// the logic is wasm32-friendly (reqwest maps to fetch) so the core can also
// serve the pure-web build as WebAssembly as it grows.

use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmReq {
    provider: String,
    base_url: Option<String>,
    model: String,
    api_key: Option<String>,
    system: String,
    user: String,
    max_tokens: Option<u32>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())
}

fn trim_base(base: &Option<String>, default: &str) -> String {
    let raw = base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default);
    raw.trim_end_matches('/').to_string()
}

async fn post_json(
    req: reqwest::RequestBuilder,
    body: Value,
) -> Result<Value, String> {
    let res = req
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {}", text.chars().take(220).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|e| format!("bad json from server: {e}"))
}

/// One completion against whichever backend the learner configured.
/// Returns the raw text reply; the TS side owns prompts and JSON parsing.
#[tauri::command]
async fn llm_complete(req: LlmReq) -> Result<String, String> {
    let http = client()?;
    let max_tokens = req.max_tokens.unwrap_or(1400);

    match req.provider.as_str() {
        "ollama" => {
            let base = trim_base(&req.base_url, "http://localhost:11434");
            let data = post_json(
                http.post(format!("{base}/api/chat")),
                json!({
                    "model": req.model,
                    "stream": false,
                    "options": { "temperature": 0.2 },
                    "messages": [
                        { "role": "system", "content": req.system },
                        { "role": "user", "content": req.user }
                    ]
                }),
            )
            .await?;
            Ok(data["message"]["content"].as_str().unwrap_or_default().to_string())
        }
        "anthropic" => {
            let data = post_json(
                http.post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", req.api_key.as_deref().unwrap_or_default())
                    .header("anthropic-version", "2023-06-01"),
                json!({
                    "model": req.model,
                    "max_tokens": max_tokens,
                    "system": req.system,
                    "messages": [{ "role": "user", "content": req.user }]
                }),
            )
            .await?;
            let text = data["content"]
                .as_array()
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter_map(|b| b["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();
            Ok(text)
        }
        // "openai" and anything OpenAI-compatible (LM Studio, llama.cpp, vLLM)
        _ => {
            let base = trim_base(&req.base_url, "https://api.openai.com/v1");
            let mut builder = http.post(format!("{base}/chat/completions"));
            if let Some(key) = req.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
                builder = builder.header("authorization", format!("Bearer {key}"));
            }
            let data = post_json(
                builder,
                json!({
                    "model": req.model,
                    "temperature": 0.2,
                    "max_tokens": max_tokens,
                    "messages": [
                        { "role": "system", "content": req.system },
                        { "role": "user", "content": req.user }
                    ]
                }),
            )
            .await?;
            Ok(data["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or_default()
                .to_string())
        }
    }
}

/// The locally installed Ollama models, for the settings screen.
#[tauri::command]
async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<String>, String> {
    let base = trim_base(&base_url, "http://localhost:11434");
    let http = client()?;
    let res = http
        .get(format!("{base}/api/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("could not reach ollama: {e}"))?;
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(data["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| m["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

// -- YouTube source feed (desktop only) --------------------------------------
// Discovery and transcript fetch run here because the browser is CORS-blocked
// from YouTube's search and caption endpoints. The TS side owns relevance,
// snippet trimming, and the official embed; this just fetches. Best-effort:
// any failure returns empty and the caller skips the video.

/// Search YouTube for videos via the Data API (key supplied by the user).
#[tauri::command]
async fn yt_search(query: String, api_key: String, max: Option<u32>) -> Result<Vec<Value>, String> {
    let http = client()?;
    let n = max.unwrap_or(6).min(10).to_string();
    let res = http
        .get("https://www.googleapis.com/youtube/v3/search")
        .query(&[
            ("part", "snippet"),
            ("type", "video"),
            ("maxResults", n.as_str()),
            ("q", query.as_str()),
            ("key", api_key.as_str()),
        ])
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| format!("youtube search failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("youtube search {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let data: Value = serde_json::from_str(&text).map_err(|e| format!("bad json from youtube: {e}"))?;
    let out = data["items"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|it| {
            let vid = it["id"]["videoId"].as_str()?;
            let sn = &it["snippet"];
            Some(json!({
                "videoId": vid,
                "title": sn["title"].as_str().unwrap_or_default(),
                "channel": sn["channelTitle"].as_str().unwrap_or_default(),
                "description": sn["description"].as_str().unwrap_or_default(),
                "date": sn["publishedAt"].as_str().unwrap_or_default().get(0..10).unwrap_or_default(),
            }))
        })
        .collect::<Vec<_>>();
    Ok(out)
}

/// Best-effort transcript fetch: read the caption track off the watch page's
/// player response, then pull the json3 timed text. Empty when unavailable.
#[tauri::command]
async fn yt_transcript(video_id: String) -> Result<Vec<Value>, String> {
    let http = client()?;
    let page = http
        .get(format!("https://www.youtube.com/watch?v={video_id}&hl=en"))
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| format!("watch page failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let base = match extract_caption_base_url(&page) {
        Some(b) => b,
        None => return Ok(vec![]), // no captions -> caller skips this video
    };
    // Always request json3; drop any format the caption URL already carries.
    let cleaned = base
        .split('&')
        .filter(|p| !p.starts_with("fmt="))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("{cleaned}&fmt=json3");
    let data: Value = http
        .get(&url)
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| format!("transcript fetch failed: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for ev in data["events"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let start = ev["tStartMs"].as_f64().unwrap_or(0.0) / 1000.0;
        let dur = ev["dDurationMs"].as_f64().map(|d| d / 1000.0);
        let text: String = ev["segs"]
            .as_array()
            .map(|segs| segs.iter().filter_map(|s| s["utf8"].as_str()).collect())
            .unwrap_or_default();
        let text = text.replace('\n', " ");
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        out.push(json!({ "text": text, "start": start, "dur": dur }));
    }
    Ok(out)
}

// -- Google Scholar source feed (desktop only) -------------------------------
// Scholar has no official API and blocks direct browser access, so the request
// goes out from here via SerpApi's google_scholar engine, with a SerpApi key
// the user supplies. The TS side owns relevance, snippet trimming, and card
// shaping; this just fetches and hands back a thin slice. Best-effort: any
// failure returns empty and the caller skips the feed.
#[tauri::command]
async fn scholar_search(
    query: String,
    api_key: String,
    max: Option<u32>,
) -> Result<Vec<Value>, String> {
    let http = client()?;
    let n = max.unwrap_or(6).min(20).to_string();
    let res = http
        .get("https://serpapi.com/search.json")
        .query(&[
            ("engine", "google_scholar"),
            ("q", query.as_str()),
            ("num", n.as_str()),
            ("api_key", api_key.as_str()),
        ])
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("scholar search failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "scholar search {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let data: Value =
        serde_json::from_str(&text).map_err(|e| format!("bad json from serpapi: {e}"))?;
    let out = data["organic_results"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|it| {
            let link = it["link"].as_str()?;
            Some(json!({
                "title": it["title"].as_str().unwrap_or_default(),
                "link": link,
                "snippet": it["snippet"].as_str().unwrap_or_default(),
                "summary": it["publication_info"]["summary"].as_str().unwrap_or_default(),
                "citedBy": it["inline_links"]["cited_by"]["total"].as_u64().unwrap_or(0),
            }))
        })
        .collect::<Vec<_>>();
    Ok(out)
}

/// Pull the first caption track's baseUrl out of a watch page's player response.
fn extract_caption_base_url(page: &str) -> Option<String> {
    let anchor = page.find("\"captionTracks\":")?;
    let rest = &page[anchor..];
    let key = "\"baseUrl\":\"";
    let b = rest.find(key)? + key.len();
    let after = &rest[b..];
    let end = after.find('"')?;
    Some(after[..end].replace("\\u0026", "&").replace("\\/", "/"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            llm_complete,
            list_ollama_models,
            yt_search,
            yt_transcript,
            scholar_search
        ])
        .run(tauri::generate_context!())
        .expect("error while running tessera");
}

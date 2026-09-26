import base64
import html
import io
import json
import mimetypes
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import cv2
import requests
import streamlit as st
import streamlit.components.v1 as components
from groq import Groq

try:
    from docx import Document
except Exception:  # pragma: no cover - optional dependency
    Document = None

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
except Exception:  # pragma: no cover - optional dependency
    colors = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    inch = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None
    TA_LEFT = None


APP_TITLE = "Meeting Requirement & Summary Agent"
TRANSCRIPTION_MODEL = "whisper-large-v3-turbo"
DEFAULT_LLM_MODEL = "openai/gpt-oss-120b"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".mpeg", ".mpga"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | AUDIO_EXTENSIONS


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


def get_api_key() -> str:
    try:
        secret_key = st.secrets.get("GROQ_API_KEY", "")
    except Exception:
        secret_key = ""
    env_key = os.environ.get("GROQ_API_KEY", "")
    return secret_key or env_key


def get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def infer_media_kind(name: str, content_type: str | None = None) -> str:
    suffix = Path(name).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"

    guessed_type, _ = mimetypes.guess_type(name)
    media_type = content_type or guessed_type or ""
    if media_type.startswith("image/"):
        return "image"
    if media_type.startswith("video/"):
        return "video"
    if media_type.startswith("audio/"):
        return "audio"
    return "unknown"


def is_direct_media_url(url: str) -> bool:
    parsed = urlparse(url)
    return Path(parsed.path).suffix.lower() in MEDIA_EXTENSIONS


def fetch_url_text(url: str) -> tuple[str, str]:
    response = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    response.raise_for_status()
    return response.text, (response.headers.get("content-type") or "").split(";")[0].strip().lower()


def extract_meta_content(html_text: str, property_name: str) -> str:
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(property_name)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+name=["\']{re.escape(property_name)}["\'][^>]+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def resolve_page_media_url(url: str) -> tuple[str, str]:
    html_text, content_type = fetch_url_text(url)
    if content_type.startswith("image/") or content_type.startswith("video/") or content_type.startswith("audio/"):
        return url, infer_media_kind(url, content_type)

    candidate = extract_meta_content(html_text, "og:video:secure_url")
    if not candidate:
        candidate = extract_meta_content(html_text, "og:video:url")
    if not candidate:
        candidate = extract_meta_content(html_text, "og:video")
    if candidate:
        return candidate, infer_media_kind(candidate)

    candidate = extract_meta_content(html_text, "twitter:player:stream")
    if candidate:
        return candidate, infer_media_kind(candidate)

    candidate = extract_meta_content(html_text, "og:image:secure_url")
    if not candidate:
        candidate = extract_meta_content(html_text, "og:image")
    if candidate:
        return candidate, "image"

    raise ValueError("No usable image, audio, or video media was found on that page.")


def download_remote_media(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http:// or https://.")

    response = requests.get(url, stream=True, timeout=30)
    response.raise_for_status()

    content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
    kind = infer_media_kind(parsed.path or url, content_type)
    if kind == "unknown":
        raise ValueError("Please provide a direct audio, image, or video file URL.")

    suffix = Path(parsed.path).suffix.lower()
    if not suffix:
        suffix = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/bmp": ".bmp",
            "audio/mpeg": ".mp3",
            "audio/mp4": ".m4a",
            "audio/wav": ".wav",
            "audio/ogg": ".ogg",
            "video/mp4": ".mp4",
            "video/webm": ".webm",
            "video/x-msvideo": ".avi",
            "video/quicktime": ".mov",
            "video/x-matroska": ".mkv",
        }.get(content_type, ".bin")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                tmp.write(chunk)
        return tmp.name, kind


def fetch_file_bytes(uploaded_file) -> bytes:
    return uploaded_file.getvalue()


def make_data_url(file_bytes: bytes, mime: str) -> str:
    encoded = base64.b64encode(file_bytes).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


def format_timestamp(seconds: float | int | None) -> str:
    if seconds is None:
        return "--:--"
    total = max(0, int(float(seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def safe_json_loads(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise ValueError("The model did not return valid JSON.")
        return json.loads(match.group(0))


def build_meeting_context_prompt(context: dict[str, str]) -> str:
    participants = context.get("participants", "").strip()
    glossary = context.get("glossary", "").strip()
    project_name = context.get("project_name", "").strip()
    notes = context.get("notes", "").strip()
    title = context.get("meeting_title", "").strip()
    return (
        f"Meeting title: {title or 'Untitled'}\n"
        f"Project: {project_name or 'Not provided'}\n"
        f"Participants: {participants or 'Not provided'}\n"
        f"Glossary: {glossary or 'Not provided'}\n"
        f"Additional notes: {notes or 'None'}"
    )


def transcript_segments_to_text(segments: list[TranscriptSegment], max_chars: int | None = None) -> str:
    lines = []
    for segment in segments:
        lines.append(f"[{format_timestamp(segment.start)} - {format_timestamp(segment.end)}] {segment.text}")
    text = "\n".join(lines)
    if max_chars and len(text) > max_chars:
        return text[:max_chars] + "\n[...truncated...]"
    return text


def parse_transcription_response(response: Any) -> tuple[str, list[TranscriptSegment]]:
    text = get_attr(response, "text", "") or ""
    raw_segments = get_attr(response, "segments", []) or []
    segments: list[TranscriptSegment] = []

    for raw in raw_segments:
        start = float(get_attr(raw, "start", 0.0) or 0.0)
        end = float(get_attr(raw, "end", start) or start)
        seg_text = (get_attr(raw, "text", "") or "").strip()
        if seg_text:
            segments.append(TranscriptSegment(start=start, end=end, text=seg_text))

    if not segments and text.strip():
        segments = [TranscriptSegment(start=0.0, end=0.0, text=text.strip())]

    if not text.strip():
        text = " ".join(segment.text for segment in segments).strip()

    return text, segments


def transcribe_media(
    client: Groq,
    *,
    media_path: str | None = None,
    media_url: str | None = None,
    media_bytes: bytes | None = None,
    filename: str | None = None,
    language: str = "en",
    prompt: str = "",
) -> tuple[str, list[TranscriptSegment]]:
    kwargs: dict[str, Any] = {
        "model": TRANSCRIPTION_MODEL,
        "response_format": "verbose_json",
        "timestamp_granularities": ["segment", "word"],
        "temperature": 0.0,
    }
    if language:
        kwargs["language"] = language
    if prompt.strip():
        kwargs["prompt"] = prompt.strip()[:500]

    if media_url:
        response = client.audio.transcriptions.create(url=media_url, **kwargs)
    elif media_path:
        with open(media_path, "rb") as file:
            response = client.audio.transcriptions.create(file=(Path(media_path).name, file.read()), **kwargs)
    elif media_bytes is not None:
        upload_name = filename or "meeting_media"
        response = client.audio.transcriptions.create(file=(upload_name, media_bytes), **kwargs)
    else:
        raise ValueError("No audio or video input was provided.")

    return parse_transcription_response(response)


def chunk_transcript(segments: list[TranscriptSegment], max_chars: int = 12000) -> list[dict[str, Any]]:
    if not segments:
        return []

    chunks: list[dict[str, Any]] = []
    current: list[TranscriptSegment] = []
    current_chars = 0

    for segment in segments:
        line = f"[{format_timestamp(segment.start)} - {format_timestamp(segment.end)}] {segment.text}"
        if current and current_chars + len(line) > max_chars:
            chunks.append(
                {
                    "start": current[0].start,
                    "end": current[-1].end,
                    "text": transcript_segments_to_text(current),
                }
            )
            current = []
            current_chars = 0
        current.append(segment)
        current_chars += len(line)

    if current:
        chunks.append(
            {
                "start": current[0].start,
                "end": current[-1].end,
                "text": transcript_segments_to_text(current),
            }
        )

    return chunks


def build_extraction_prompt(context_prompt: str, chunk: dict[str, Any], output_style: str) -> tuple[str, str]:
    system = (
        "You are a senior meeting analyst. Extract requirements, decisions, action items, risks, open questions, and topic summaries.\n"
        "Return JSON only. Never invent facts. Every item must include a short verbatim evidence_quote and a timestamp.\n"
        "If the transcript does not support an item, omit it."
    )
    user = f"""
{context_prompt}

Output style: {output_style}

Transcript segment:
{chunk["text"]}

Return JSON with this shape:
{{
  "topic_title": "short topic name",
  "topic_summary": "1-3 sentence summary of this segment",
  "requirements": [
    {{
      "text": "requirement wording",
      "type": "functional | non-functional | constraint | assumption | dependency",
      "priority": "must | should | could",
      "raised_by": "speaker or unknown",
      "timestamp": "HH:MM:SS",
      "confidence": 0.0,
      "evidence_quote": "short quote"
    }}
  ],
  "decisions": [
    {{
      "text": "decision wording",
      "rationale": "why it was chosen",
      "decided_by": "speaker or group",
      "timestamp": "HH:MM:SS",
      "confidence": 0.0,
      "evidence_quote": "short quote"
    }}
  ],
  "action_items": [
    {{
      "text": "task wording",
      "owner": "person or team",
      "due_date": "if stated, otherwise blank",
      "timestamp": "HH:MM:SS",
      "confidence": 0.0,
      "evidence_quote": "short quote"
    }}
  ],
  "risks": [
    {{
      "text": "risk or concern",
      "severity": "low | medium | high",
      "timestamp": "HH:MM:SS",
      "confidence": 0.0,
      "evidence_quote": "short quote"
    }}
  ],
  "open_questions": [
    {{
      "text": "open question",
      "owner": "if any",
      "timestamp": "HH:MM:SS",
      "confidence": 0.0,
      "evidence_quote": "short quote"
    }}
  ]
}}
""".strip()
    return system, user


def build_verification_prompt(context_prompt: str, artifact: dict[str, Any], transcript_text: str, output_style: str) -> tuple[str, str]:
    system = (
        "You are a strict verifier for meeting extraction. Keep only items that are supported by the transcript.\n"
        "Lower confidence when support is indirect. Remove unsupported items. Return JSON only."
    )
    user = f"""
{context_prompt}

Output style: {output_style}

Structured artifact to verify:
{json.dumps(artifact, ensure_ascii=True, indent=2)}

Transcript evidence:
{transcript_text}

Return the same JSON structure, but verified and cleaned.
""".strip()
    return system, user


def build_summary_prompt(context_prompt: str, artifact: dict[str, Any], output_style: str) -> tuple[str, str]:
    system = "You are a professional meeting summarizer. Write concise, faithful meeting prose based only on verified notes."
    user = f"""
{context_prompt}

Output style: {output_style}

Verified meeting artifact:
{json.dumps(artifact, ensure_ascii=True, indent=2)}

Write JSON only in this shape:
{{
  "executive_summary": "5-10 sentences depending on style",
  "next_steps": ["item 1", "item 2"],
  "follow_up_meeting": "short line about follow-up if relevant"
}}
""".strip()
    return system, user


def groq_chat_json(
    client: Groq,
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_completion_tokens: int = 2500,
    temperature: float = 0.2,
) -> dict[str, Any]:
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_completion_tokens=max_completion_tokens,
    )
    content = (response.choices[0].message.content or "").strip()
    return safe_json_loads(content)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def merge_item_lists(existing: list[dict[str, Any]], incoming: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    merged: list[dict[str, Any]] = []

    def item_key(item: dict[str, Any]) -> tuple[Any, ...]:
        return (
            kind,
            normalize_text(str(item.get("text", ""))),
            normalize_text(str(item.get("timestamp", ""))),
            normalize_text(str(item.get("owner", ""))),
            normalize_text(str(item.get("raised_by", ""))),
            normalize_text(str(item.get("decided_by", ""))),
        )

    for item in existing + incoming:
        key = item_key(item)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)

    return merged


def merge_chunk_artifacts(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    if not chunks:
        return {}

    artifact: dict[str, Any] = {
        "topics": [],
        "requirements": [],
        "decisions": [],
        "action_items": [],
        "risks": [],
        "open_questions": [],
    }

    for chunk in chunks:
        artifact["topics"].append(
            {
                "title": chunk.get("topic_title", "Untitled topic"),
                "summary": chunk.get("topic_summary", ""),
                "start": chunk.get("start"),
                "end": chunk.get("end"),
            }
        )
        artifact["requirements"] = merge_item_lists(artifact["requirements"], chunk.get("requirements", []), "requirements")
        artifact["decisions"] = merge_item_lists(artifact["decisions"], chunk.get("decisions", []), "decisions")
        artifact["action_items"] = merge_item_lists(artifact["action_items"], chunk.get("action_items", []), "action_items")
        artifact["risks"] = merge_item_lists(artifact["risks"], chunk.get("risks", []), "risks")
        artifact["open_questions"] = merge_item_lists(artifact["open_questions"], chunk.get("open_questions", []), "open_questions")

    return artifact


def apply_sorting(artifact: dict[str, Any]) -> dict[str, Any]:
    for key in ("requirements", "decisions", "action_items", "risks", "open_questions"):
        artifact[key] = sorted(
            artifact.get(key, []),
            key=lambda item: float(str(item.get("timestamp", "0")).replace(":", "")) if str(item.get("timestamp", "")).strip() else 0.0,
        )
    artifact["topics"] = sorted(
        artifact.get("topics", []),
        key=lambda item: float(item.get("start") or 0.0),
    )
    return artifact


def verify_artifact(
    client: Groq,
    *,
    model: str,
    context_prompt: str,
    artifact: dict[str, Any],
    transcript_text: str,
    output_style: str,
) -> dict[str, Any]:
    system_prompt, user_prompt = build_verification_prompt(context_prompt, artifact, transcript_text, output_style)
    verified = groq_chat_json(
        client,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_completion_tokens=3500,
        temperature=0.0,
    )
    return apply_sorting(verified)


def write_summary(
    client: Groq,
    *,
    model: str,
    context_prompt: str,
    artifact: dict[str, Any],
    output_style: str,
) -> dict[str, Any]:
    system_prompt, user_prompt = build_summary_prompt(context_prompt, artifact, output_style)
    summary = groq_chat_json(
        client,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_completion_tokens=1800,
        temperature=0.25,
    )
    return summary


def select_relevant_segments(segments: list[TranscriptSegment], question: str, max_segments: int = 5) -> list[TranscriptSegment]:
    question_tokens = {token for token in re.findall(r"[a-zA-Z0-9]+", question.lower()) if len(token) > 2}
    if not question_tokens:
        return segments[:max_segments]

    scored: list[tuple[int, TranscriptSegment]] = []
    for segment in segments:
        text_tokens = set(re.findall(r"[a-zA-Z0-9]+", segment.text.lower()))
        score = len(text_tokens & question_tokens)
        if score:
            scored.append((score, segment))

    if not scored:
        return segments[:max_segments]

    scored.sort(key=lambda item: item[0], reverse=True)
    selected = [item[1] for item in scored[:max_segments]]
    selected.sort(key=lambda item: item.start)
    return selected


def answer_question(
    client: Groq,
    *,
    model: str,
    question: str,
    transcript_segments: list[TranscriptSegment],
    artifact: dict[str, Any],
    context_prompt: str,
) -> dict[str, Any]:
    relevant_segments = select_relevant_segments(transcript_segments, question)
    evidence_text = transcript_segments_to_text(relevant_segments, max_chars=8000)
    system_prompt = "You answer questions about a meeting transcript. Be faithful, cite timestamps, and do not invent details."
    user_prompt = f"""
{context_prompt}

Meeting artifact:
{json.dumps(artifact, ensure_ascii=True, indent=2)}

Question:
{question}

Relevant transcript evidence:
{evidence_text}

Return JSON only in this shape:
{{
  "answer": "direct answer",
  "citations": [
    {{"timestamp": "HH:MM:SS", "quote": "short quote"}}
  ]
}}
""".strip()
    return groq_chat_json(
        client,
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_completion_tokens=1200,
        temperature=0.2,
    )


def media_preview_html(media_bytes: bytes, mime: str, segments: list[TranscriptSegment]) -> str:
    data_url = make_data_url(media_bytes, mime)
    segment_rows = []
    for segment in segments[:200]:
        segment_rows.append(
            f"""
            <tr>
              <td class="time"><button data-start="{segment.start:.2f}">{html.escape(format_timestamp(segment.start))}</button></td>
              <td>{html.escape(segment.text)}</td>
            </tr>
            """
        )
    table_html = "".join(segment_rows) or "<tr><td colspan='2'>No transcript available yet.</td></tr>"

    tag_name = "audio" if mime.startswith("audio/") else "video"
    return f"""
    <html>
    <head>
      <style>
        body {{
          font-family: Inter, Arial, sans-serif;
          background: linear-gradient(180deg, #0f172a 0%, #111827 100%);
          color: #e5e7eb;
          margin: 0;
          padding: 0;
        }}
        .wrap {{
          padding: 16px;
        }}
        .player {{
          width: 100%;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
          background: #000;
        }}
        {tag_name} {{
          width: 100%;
          max-height: 420px;
          display: block;
          background: #000;
        }}
        table {{
          width: 100%;
          border-collapse: collapse;
          margin-top: 16px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 16px;
          overflow: hidden;
        }}
        td {{
          padding: 10px 12px;
          vertical-align: top;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
          color: #e5e7eb;
        }}
        td.time {{
          width: 110px;
          white-space: nowrap;
        }}
        button {{
          border: 0;
          border-radius: 999px;
          padding: 8px 10px;
          background: #f59e0b;
          color: #111827;
          font-weight: 700;
          cursor: pointer;
        }}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="player">
          <{tag_name} id="player" controls src="{data_url}"></{tag_name}>
        </div>
        <table>
          <tbody>
            {table_html}
          </tbody>
        </table>
      </div>
      <script>
        const player = document.getElementById("player");
        document.querySelectorAll("button[data-start]").forEach((button) => {{
          button.addEventListener("click", () => {{
            player.currentTime = parseFloat(button.dataset.start || "0");
            player.play();
          }});
        }});
      </script>
    </body>
    </html>
    """


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
    if not rows:
        return "_No items extracted._"
    header = "| " + " | ".join(label for _, label in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    lines = [header, separator]
    for row in rows:
        values = []
        for key, _ in columns:
            value = row.get(key, "")
            values.append(str(value).replace("\n", " ").strip() or "-")
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def render_markdown_report(context: dict[str, str], artifact: dict[str, Any], summary: dict[str, Any], source_name: str) -> str:
    lines: list[str] = []
    lines.append(f"# {context.get('meeting_title', '').strip() or 'Meeting Summary'}")
    lines.append("")
    lines.append("## Meeting Header")
    lines.append(f"- **Title:** {context.get('meeting_title', '').strip() or 'Untitled'}")
    lines.append(f"- **Project:** {context.get('project_name', '').strip() or 'Not provided'}")
    lines.append(f"- **Date:** {context.get('meeting_date', '').strip() or 'Not provided'}")
    lines.append(f"- **Duration:** {context.get('meeting_duration', '').strip() or 'Not provided'}")
    lines.append(f"- **Participants:** {context.get('participants', '').strip() or 'Not provided'}")
    lines.append(f"- **Source:** {source_name}")
    lines.append("")
    lines.append("## Executive Summary")
    lines.append(summary.get("executive_summary", "").strip() or artifact.get("executive_summary", "").strip() or "_No summary generated._")
    lines.append("")
    lines.append("## Key Topics")
    for topic in artifact.get("topics", []):
        lines.append(
            f"- **{topic.get('title', 'Untitled')}** "
            f"({format_timestamp(topic.get('start'))} - {format_timestamp(topic.get('end'))}): "
            f"{topic.get('summary', '').strip() or 'No summary.'}"
        )
    if not artifact.get("topics"):
        lines.append("- _No topics extracted._")
    lines.append("")
    lines.append("## Requirements")
    lines.append(
        markdown_table(
            artifact.get("requirements", []),
            [
                ("text", "Requirement"),
                ("type", "Type"),
                ("priority", "Priority"),
                ("raised_by", "Raised by"),
                ("timestamp", "Timestamp"),
                ("confidence", "Confidence"),
            ],
        )
    )
    lines.append("")
    lines.append("## Decisions")
    lines.append(
        markdown_table(
            artifact.get("decisions", []),
            [
                ("text", "Decision"),
                ("rationale", "Rationale"),
                ("decided_by", "Decided by"),
                ("timestamp", "Timestamp"),
                ("confidence", "Confidence"),
            ],
        )
    )
    lines.append("")
    lines.append("## Action Items")
    lines.append(
        markdown_table(
            artifact.get("action_items", []),
            [
                ("text", "Task"),
                ("owner", "Owner"),
                ("due_date", "Due date"),
                ("timestamp", "Timestamp"),
                ("confidence", "Confidence"),
            ],
        )
    )
    lines.append("")
    lines.append("## Risks")
    if artifact.get("risks"):
        for item in artifact.get("risks", []):
            lines.append(
                f"- **{item.get('text', '')}** "
                f"({item.get('severity', 'medium')}, {format_timestamp(item.get('timestamp'))}, conf {item.get('confidence', 0)})"
            )
    else:
        lines.append("_No risks extracted._")
    lines.append("")
    lines.append("## Open Questions")
    if artifact.get("open_questions"):
        for item in artifact.get("open_questions", []):
            owner = item.get("owner", "")
            suffix = f" - owner: {owner}" if owner else ""
            lines.append(
                f"- **{item.get('text', '')}**{suffix} "
                f"({format_timestamp(item.get('timestamp'))}, conf {item.get('confidence', 0)})"
            )
    else:
        lines.append("_No open questions extracted._")
    lines.append("")
    lines.append("## Next Steps")
    for step in summary.get("next_steps", []):
        lines.append(f"- {step}")
    if not summary.get("next_steps"):
        lines.append("- _No next steps generated._")
    if summary.get("follow_up_meeting"):
        lines.append("")
        lines.append(f"Follow-up: {summary.get('follow_up_meeting')}")
    return "\n".join(lines)


def build_docx_bytes(context: dict[str, str], artifact: dict[str, Any], summary: dict[str, Any], source_name: str) -> bytes | None:
    if Document is None:
        return None

    document = Document()
    document.add_heading(context.get("meeting_title", "").strip() or "Meeting Summary", level=0)
    document.add_paragraph(f"Project: {context.get('project_name', '').strip() or 'Not provided'}")
    document.add_paragraph(f"Date: {context.get('meeting_date', '').strip() or 'Not provided'}")
    document.add_paragraph(f"Duration: {context.get('meeting_duration', '').strip() or 'Not provided'}")
    document.add_paragraph(f"Participants: {context.get('participants', '').strip() or 'Not provided'}")
    document.add_paragraph(f"Source: {source_name}")

    document.add_heading("Executive Summary", level=1)
    document.add_paragraph(summary.get("executive_summary", "").strip() or "No summary generated.")

    document.add_heading("Key Topics", level=1)
    for topic in artifact.get("topics", []):
        document.add_paragraph(
            f"{topic.get('title', 'Untitled')} ({format_timestamp(topic.get('start'))} - {format_timestamp(topic.get('end'))}): "
            f"{topic.get('summary', '').strip() or 'No summary.'}",
            style="List Bullet",
        )

    sections = [
        ("Requirements", artifact.get("requirements", []), ["Requirement", "Type", "Priority", "Raised by", "Timestamp", "Confidence"]),
        ("Decisions", artifact.get("decisions", []), ["Decision", "Rationale", "Decided by", "Timestamp", "Confidence"]),
        ("Action Items", artifact.get("action_items", []), ["Task", "Owner", "Due date", "Timestamp", "Confidence"]),
    ]
    for title, rows, headers in sections:
        document.add_heading(title, level=1)
        if not rows:
            document.add_paragraph("No items extracted.")
            continue
        table = document.add_table(rows=1, cols=len(headers))
        table.style = "Table Grid"
        header_row = table.rows[0].cells
        for index, header in enumerate(headers):
            header_row[index].text = header
        for row in rows:
            row_cells = table.add_row().cells
            for index, key in enumerate([h.lower().replace(" ", "_") for h in headers]):
                row_cells[index].text = str(row.get(key, "") or "")

    for title, rows in [("Risks", artifact.get("risks", [])), ("Open Questions", artifact.get("open_questions", []))]:
        document.add_heading(title, level=1)
        if not rows:
            document.add_paragraph("No items extracted.")
            continue
        for row in rows:
            document.add_paragraph(str(row.get("text", "")), style="List Bullet")

    document.add_heading("Next Steps", level=1)
    for step in summary.get("next_steps", []):
        document.add_paragraph(step, style="List Bullet")

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def build_pdf_bytes(context: dict[str, str], artifact: dict[str, Any], summary: dict[str, Any], source_name: str) -> bytes | None:
    if SimpleDocTemplate is None:
        return None

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="BodySmall",
            parent=styles["BodyText"],
            fontSize=9,
            leading=11,
            alignment=TA_LEFT,
        )
    )
    story: list[Any] = []

    story.append(Paragraph(context.get("meeting_title", "").strip() or "Meeting Summary", styles["Title"]))
    story.append(Spacer(1, 0.15 * inch))
    meta_lines = [
        f"<b>Project:</b> {context.get('project_name', '').strip() or 'Not provided'}",
        f"<b>Date:</b> {context.get('meeting_date', '').strip() or 'Not provided'}",
        f"<b>Duration:</b> {context.get('meeting_duration', '').strip() or 'Not provided'}",
        f"<b>Participants:</b> {context.get('participants', '').strip() or 'Not provided'}",
        f"<b>Source:</b> {source_name}",
    ]
    for line in meta_lines:
        story.append(Paragraph(line, styles["BodySmall"]))
    story.append(Spacer(1, 0.15 * inch))

    story.append(Paragraph("Executive Summary", styles["Heading1"]))
    story.append(Paragraph(summary.get("executive_summary", "").strip() or "No summary generated.", styles["BodySmall"]))
    story.append(Spacer(1, 0.1 * inch))

    story.append(Paragraph("Key Topics", styles["Heading1"]))
    for topic in artifact.get("topics", []):
        story.append(
            Paragraph(
                f"<b>{html.escape(str(topic.get('title', 'Untitled')))}</b> "
                f"({format_timestamp(topic.get('start'))} - {format_timestamp(topic.get('end'))}): "
                f"{html.escape(str(topic.get('summary', '') or 'No summary.'))}",
                styles["BodySmall"],
            )
        )

    def add_table(title: str, rows: list[dict[str, Any]], headers: list[tuple[str, str]]) -> None:
        story.append(Paragraph(title, styles["Heading1"]))
        if not rows:
            story.append(Paragraph("No items extracted.", styles["BodySmall"]))
            return
        table_data = [[header for _, header in headers]]
        for row in rows:
            table_data.append([str(row.get(key, "") or "") for key, _ in headers])
        table = Table(table_data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("LEADING", (0, 0), (-1, -1), 10),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 0.12 * inch))

    add_table(
        "Requirements",
        artifact.get("requirements", []),
        [("text", "Requirement"), ("type", "Type"), ("priority", "Priority"), ("raised_by", "Raised by"), ("timestamp", "Timestamp"), ("confidence", "Confidence")],
    )
    add_table(
        "Decisions",
        artifact.get("decisions", []),
        [("text", "Decision"), ("rationale", "Rationale"), ("decided_by", "Decided by"), ("timestamp", "Timestamp"), ("confidence", "Confidence")],
    )
    add_table(
        "Action Items",
        artifact.get("action_items", []),
        [("text", "Task"), ("owner", "Owner"), ("due_date", "Due date"), ("timestamp", "Timestamp"), ("confidence", "Confidence")],
    )

    for title, rows in [("Risks", artifact.get("risks", [])), ("Open Questions", artifact.get("open_questions", []))]:
        story.append(Paragraph(title, styles["Heading1"]))
        if not rows:
            story.append(Paragraph("No items extracted.", styles["BodySmall"]))
            continue
        for row in rows:
            story.append(Paragraph(f"• {html.escape(str(row.get('text', '')))}", styles["BodySmall"]))
        story.append(Spacer(1, 0.08 * inch))

    story.append(Paragraph("Next Steps", styles["Heading1"]))
    for step in summary.get("next_steps", []):
        story.append(Paragraph(f"• {html.escape(step)}", styles["BodySmall"]))

    doc.build(story)
    return buffer.getvalue()


def render_timeline(segments: list[TranscriptSegment]) -> None:
    for segment in segments:
        st.markdown(f"**[{format_timestamp(segment.start)} - {format_timestamp(segment.end)}]** {segment.text}")


def initialize_state() -> None:
    defaults = {
        "meeting_artifact": None,
        "meeting_summary": None,
        "transcript_text": "",
        "transcript_segments": [],
        "current_source_name": "",
        "current_source_bytes": None,
        "current_source_mime": "",
        "current_source_kind": "",
        "qa_history": [],
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def main() -> None:
    st.set_page_config(page_title=APP_TITLE, page_icon="📝", layout="wide")
    initialize_state()

    st.title(APP_TITLE)
    st.caption(
        "Upload a meeting recording or paste a transcript, then generate a traceable summary with requirements, decisions, action items, risks, and open questions."
    )

    with st.sidebar:
        st.header("Run Settings")
        api_key = get_api_key()
        if not api_key:
            api_key = st.text_input("Groq API key", type="password")
            st.caption("You can also set `GROQ_API_KEY` in your environment or Streamlit secrets.")

        llm_model = st.selectbox(
            "Analysis model",
            [DEFAULT_LLM_MODEL, "qwen/qwen3.6-27b", "openai/gpt-oss-20b"],
            index=0,
        )
        transcription_language = st.text_input("Transcription language", value="en")
        output_style = st.selectbox("Output style", ["Standard", "Brief", "Detailed"], index=0)
        extract_vision = st.checkbox("Include visual keyframe notes for video files", value=False)

        st.header("Meeting Context")
        meeting_title = st.text_input("Meeting title", value="")
        meeting_date = st.text_input("Meeting date", value="")
        meeting_duration = st.text_input("Duration", value="")
        project_name = st.text_input("Project name", value="")
        participants = st.text_area("Participants", value="", height=90, help="Separate names with commas or new lines.")
        glossary = st.text_area("Glossary / domain terms", value="", height=90)
        notes = st.text_area("Extra context", value="", height=90)
        consent = st.checkbox("All participants agreed to recording", value=False)

    input_mode = st.radio("Input type", ["Meeting recording", "Transcript paste"], horizontal=True)
    uploaded_file = None
    media_url = ""
    transcript_override = ""

    if input_mode == "Meeting recording":
        source_mode = st.radio("Source", ["Upload file", "Direct URL"], horizontal=True)
        if source_mode == "Upload file":
            uploaded_file = st.file_uploader(
                "Upload audio or video",
                type=["mp3", "m4a", "wav", "ogg", "flac", "mp4", "mov", "m4v", "avi", "mkv", "webm"],
            )
        else:
            media_url = st.text_input("Paste a direct audio or video URL")
    else:
        transcript_override = st.text_area(
            "Paste transcript text",
            height=260,
            help="Include timestamps if you have them. The more structure you include, the better the citations.",
        )

    context = {
        "meeting_title": meeting_title,
        "meeting_date": meeting_date,
        "meeting_duration": meeting_duration,
        "project_name": project_name,
        "participants": participants,
        "glossary": glossary,
        "notes": notes,
    }
    context_prompt = build_meeting_context_prompt(context)

    resolved_media_bytes: bytes | None = None
    resolved_media_path: str | None = None
    resolved_media_kind = ""
    resolved_media_mime = ""
    source_name = ""

    if input_mode == "Meeting recording":
        if uploaded_file is not None:
            resolved_media_bytes = fetch_file_bytes(uploaded_file)
            source_name = uploaded_file.name
            resolved_media_kind = infer_media_kind(uploaded_file.name)
            resolved_media_mime = uploaded_file.type or mimetypes.guess_type(uploaded_file.name)[0] or (
                "audio/mpeg" if resolved_media_kind == "audio" else "video/mp4" if resolved_media_kind == "video" else "application/octet-stream"
            )
        elif media_url.strip():
            try:
                parsed = urlparse(media_url.strip())
                source_name = media_url.strip()
                if is_direct_media_url(media_url.strip()):
                    head_type = ""
                    try:
                        response = requests.head(media_url.strip(), allow_redirects=True, timeout=15)
                        response.raise_for_status()
                        head_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
                    except Exception:
                        pass
                    resolved_media_kind = infer_media_kind(parsed.path or media_url.strip(), head_type)
                    resolved_media_mime = head_type or (
                        "audio/mpeg" if resolved_media_kind == "audio" else "video/mp4" if resolved_media_kind == "video" else "application/octet-stream"
                    )
                    resolved_media_path = media_url.strip()
                else:
                    resolved_page_url, kind = resolve_page_media_url(media_url.strip())
                    if kind in {"audio", "video", "image"} and is_direct_media_url(resolved_page_url):
                        resolved_media_path = resolved_page_url
                        resolved_media_kind = kind
                        resolved_media_mime = (
                            "audio/mpeg" if kind == "audio" else "video/mp4" if kind == "video" else "image/jpeg"
                        )
                    else:
                        resolved_media_path, resolved_media_kind = download_remote_media(resolved_page_url)
                        resolved_media_mime = (
                            "audio/mpeg" if resolved_media_kind == "audio" else "video/mp4" if resolved_media_kind == "video" else "image/jpeg"
                        )
            except Exception as exc:
                st.error(f"Could not load media from URL: {exc}")
                return
    else:
        source_name = "Pasted transcript"

    if input_mode == "Meeting recording" and not uploaded_file and not media_url.strip():
        st.info("Upload a file or paste a direct media URL to begin.")
        return
    if input_mode == "Transcript paste" and not transcript_override.strip():
        st.info("Paste a transcript to begin.")
        return

    if input_mode == "Meeting recording":
        if resolved_media_bytes and resolved_media_kind in {"video", "audio", "image"}:
            if resolved_media_kind == "video":
                st.video(resolved_media_bytes)
            elif resolved_media_kind == "audio":
                st.audio(resolved_media_bytes)
            else:
                st.image(resolved_media_bytes, caption=source_name, use_container_width=True)
        elif resolved_media_path and resolved_media_kind in {"video", "audio", "image"} and Path(resolved_media_path).exists():
            if resolved_media_kind == "video":
                st.video(resolved_media_path)
            elif resolved_media_kind == "audio":
                st.audio(resolved_media_path)
            else:
                st.image(resolved_media_path, caption=source_name, use_container_width=True)

    run_col_1, run_col_2 = st.columns([1, 1])
    with run_col_1:
        run_button = st.button("Generate meeting summary", type="primary", use_container_width=True)
    with run_col_2:
        clear_button = st.button("Clear results", use_container_width=True)

    if clear_button:
        st.session_state.meeting_artifact = None
        st.session_state.meeting_summary = None
        st.session_state.transcript_text = ""
        st.session_state.transcript_segments = []
        st.session_state.qa_history = []
        st.rerun()

    if run_button:
        if not api_key:
            st.warning("Add a Groq API key before running the analysis.")
            return
        if not consent:
            st.warning("Please confirm recording consent before processing.")
            return

        client = Groq(api_key=api_key)
        status = st.status("Preparing the meeting workspace...", expanded=True)
        try:
            if input_mode == "Meeting recording":
                status.update(label="Transcribing the recording...", state="running")
                if resolved_media_bytes is not None:
                    transcript_text, transcript_segments = transcribe_media(
                        client,
                        media_bytes=resolved_media_bytes,
                        filename=source_name,
                        language=transcription_language,
                        prompt=glossary or notes,
                    )
                elif resolved_media_path:
                    if resolved_media_path.startswith("http://") or resolved_media_path.startswith("https://"):
                        transcript_text, transcript_segments = transcribe_media(
                            client,
                            media_url=resolved_media_path,
                            language=transcription_language,
                            prompt=glossary or notes,
                        )
                    else:
                        transcript_text, transcript_segments = transcribe_media(
                            client,
                            media_path=resolved_media_path,
                            language=transcription_language,
                            prompt=glossary or notes,
                        )
                else:
                    raise ValueError("No recording source was available.")
            else:
                status.update(label="Loading the pasted transcript...", state="running")
                transcript_text = transcript_override.strip()
                transcript_segments = []
                for line in [line.strip() for line in transcript_text.splitlines() if line.strip()]:
                    match = re.match(r"^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(.*)$", line)
                    if match:
                        timestamp_text, body = match.groups()
                        parts = [int(part) for part in timestamp_text.split(":")]
                        seconds = 0
                        for part in parts:
                            seconds = seconds * 60 + part
                        transcript_segments.append(TranscriptSegment(start=float(seconds), end=float(seconds), text=body))

            if not transcript_segments and transcript_text.strip():
                transcript_segments = [TranscriptSegment(start=0.0, end=0.0, text=transcript_text.strip())]

            st.session_state.transcript_text = transcript_text
            st.session_state.transcript_segments = transcript_segments
            st.session_state.current_source_name = source_name
            st.session_state.current_source_bytes = resolved_media_bytes
            st.session_state.current_source_mime = resolved_media_mime
            st.session_state.current_source_kind = resolved_media_kind

            status.update(label="Extracting requirements, decisions, and action items...", state="running")
            chunks = chunk_transcript(transcript_segments or [TranscriptSegment(start=0.0, end=0.0, text=transcript_text)])
            extracted_chunks: list[dict[str, Any]] = []
            for index, chunk in enumerate(chunks, start=1):
                chunk_system, chunk_user = build_extraction_prompt(context_prompt, chunk, output_style)
                extracted = groq_chat_json(
                    client,
                    model=llm_model,
                    system_prompt=chunk_system,
                    user_prompt=chunk_user,
                    max_completion_tokens=2200,
                    temperature=0.2,
                )
                extracted["start"] = chunk["start"]
                extracted["end"] = chunk["end"]
                extracted_chunks.append(extracted)
                status.write(f"Processed chunk {index} of {len(chunks)}")

            status.update(label="Merging and verifying items...", state="running")
            artifact = merge_chunk_artifacts(extracted_chunks)
            artifact = verify_artifact(
                client,
                model=llm_model,
                context_prompt=context_prompt,
                artifact=artifact,
                transcript_text=transcript_segments_to_text(transcript_segments, max_chars=15000),
                output_style=output_style,
            )
            summary = write_summary(
                client,
                model=llm_model,
                context_prompt=context_prompt,
                artifact=artifact,
                output_style=output_style,
            )

            artifact["meeting_header"] = context
            artifact["executive_summary"] = summary.get("executive_summary", "")
            artifact["next_steps"] = summary.get("next_steps", [])
            artifact["follow_up_meeting"] = summary.get("follow_up_meeting", "")
            artifact = apply_sorting(artifact)

            st.session_state.meeting_artifact = artifact
            st.session_state.meeting_summary = summary
            st.session_state.qa_history = []
            status.update(label="Meeting summary ready.", state="complete")

            if extract_vision and resolved_media_kind == "video" and resolved_media_bytes:
                st.info(
                    "Visual keyframe analysis is intentionally kept out of this first pass so the meeting summary stays focused and reliable. "
                    "We can add it next if you want the screen-share notes pipeline."
                )
        except Exception as exc:
            status.update(label="Processing failed.", state="error")
            st.error(f"Analysis failed: {exc}")

    artifact = st.session_state.meeting_artifact
    summary = st.session_state.meeting_summary
    transcript_segments = st.session_state.transcript_segments
    transcript_text = st.session_state.transcript_text

    if artifact and summary:
        tab_overview, tab_transcript, tab_edit, tab_qa, tab_export = st.tabs(
            ["Overview", "Transcript", "Edit", "Ask the meeting", "Export"]
        )

        with tab_overview:
            col_left, col_right = st.columns([1.15, 0.85], gap="large")
            with col_left:
                st.subheader("Executive Summary")
                st.write(artifact.get("executive_summary", "") or summary.get("executive_summary", ""))

                st.subheader("Key Topics")
                for topic in artifact.get("topics", []):
                    st.markdown(
                        f"**{topic.get('title', 'Untitled')}** "
                        f"({format_timestamp(topic.get('start'))} - {format_timestamp(topic.get('end'))})  \n"
                        f"{topic.get('summary', '').strip() or 'No topic summary.'}"
                    )

                st.subheader("Requirements")
                st.markdown(
                    markdown_table(
                        artifact.get("requirements", []),
                        [
                            ("text", "Requirement"),
                            ("type", "Type"),
                            ("priority", "Priority"),
                            ("raised_by", "Raised by"),
                            ("timestamp", "Timestamp"),
                            ("confidence", "Confidence"),
                        ],
                    )
                )

                st.subheader("Decisions")
                st.markdown(
                    markdown_table(
                        artifact.get("decisions", []),
                        [
                            ("text", "Decision"),
                            ("rationale", "Rationale"),
                            ("decided_by", "Decided by"),
                            ("timestamp", "Timestamp"),
                            ("confidence", "Confidence"),
                        ],
                    )
                )

                st.subheader("Action Items")
                st.markdown(
                    markdown_table(
                        artifact.get("action_items", []),
                        [
                            ("text", "Task"),
                            ("owner", "Owner"),
                            ("due_date", "Due date"),
                            ("timestamp", "Timestamp"),
                            ("confidence", "Confidence"),
                        ],
                    )
                )

                st.subheader("Risks and Open Questions")
                for item in artifact.get("risks", []):
                    st.markdown(
                        f"- **Risk:** {item.get('text', '')} "
                        f"({item.get('severity', 'medium')}, {format_timestamp(item.get('timestamp'))}, conf {item.get('confidence', 0)})"
                    )
                for item in artifact.get("open_questions", []):
                    st.markdown(
                        f"- **Question:** {item.get('text', '')} "
                        f"({format_timestamp(item.get('timestamp'))}, conf {item.get('confidence', 0)})"
                    )

            with col_right:
                st.subheader("Meeting Header")
                st.write(
                    {
                        "title": context.get("meeting_title") or "Untitled",
                        "date": context.get("meeting_date") or "Not provided",
                        "duration": context.get("meeting_duration") or "Not provided",
                        "participants": context.get("participants") or "Not provided",
                        "project": context.get("project_name") or "Not provided",
                        "source": source_name,
                    }
                )
                if st.session_state.current_source_bytes and st.session_state.current_source_mime in {"video/mp4", "audio/mpeg", "audio/mp4", "image/jpeg"}:
                    st.subheader("Source Preview")
                    preview_html = media_preview_html(
                        st.session_state.current_source_bytes,
                        st.session_state.current_source_mime,
                        transcript_segments,
                    )
                    components.html(preview_html, height=780, scrolling=True)
                else:
                    st.info("Transcript-based review is available even when there is no embeddable media preview.")

        with tab_transcript:
            st.subheader("Transcript")
            if transcript_segments:
                render_timeline(transcript_segments)
            else:
                st.text_area("Transcript", value=transcript_text, height=500)

        with tab_edit:
            st.subheader("Edit Extracted Items")
            st.caption("Adjust speaker names, wording, or priorities, then re-run the narrative summary and exports.")

            reqs = st.data_editor(
                artifact.get("requirements", []),
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "text": st.column_config.TextColumn("Requirement"),
                    "type": st.column_config.SelectboxColumn("Type", options=["functional", "non-functional", "constraint", "assumption", "dependency"]),
                    "priority": st.column_config.SelectboxColumn("Priority", options=["must", "should", "could"]),
                    "raised_by": st.column_config.TextColumn("Raised by"),
                    "timestamp": st.column_config.TextColumn("Timestamp"),
                    "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, step=0.01),
                },
                key="edit_requirements",
            )
            decisions = st.data_editor(
                artifact.get("decisions", []),
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "text": st.column_config.TextColumn("Decision"),
                    "rationale": st.column_config.TextColumn("Rationale"),
                    "decided_by": st.column_config.TextColumn("Decided by"),
                    "timestamp": st.column_config.TextColumn("Timestamp"),
                    "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, step=0.01),
                },
                key="edit_decisions",
            )
            actions = st.data_editor(
                artifact.get("action_items", []),
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "text": st.column_config.TextColumn("Task"),
                    "owner": st.column_config.TextColumn("Owner"),
                    "due_date": st.column_config.TextColumn("Due date"),
                    "timestamp": st.column_config.TextColumn("Timestamp"),
                    "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, step=0.01),
                },
                key="edit_actions",
            )
            risks = st.data_editor(
                artifact.get("risks", []),
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "text": st.column_config.TextColumn("Risk"),
                    "severity": st.column_config.SelectboxColumn("Severity", options=["low", "medium", "high"]),
                    "timestamp": st.column_config.TextColumn("Timestamp"),
                    "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, step=0.01),
                },
                key="edit_risks",
            )
            questions = st.data_editor(
                artifact.get("open_questions", []),
                use_container_width=True,
                num_rows="dynamic",
                column_config={
                    "text": st.column_config.TextColumn("Question"),
                    "owner": st.column_config.TextColumn("Owner"),
                    "timestamp": st.column_config.TextColumn("Timestamp"),
                    "confidence": st.column_config.NumberColumn("Confidence", min_value=0.0, max_value=1.0, step=0.01),
                },
                key="edit_questions",
            )

            if st.button("Apply edits to current artifact", type="primary"):
                artifact["requirements"] = list(reqs)
                artifact["decisions"] = list(decisions)
                artifact["action_items"] = list(actions)
                artifact["risks"] = list(risks)
                artifact["open_questions"] = list(questions)
                artifact = apply_sorting(artifact)
                st.session_state.meeting_artifact = artifact
                st.success("Edits saved. Re-run Export to refresh the downloadable files.")

        with tab_qa:
            st.subheader("Ask the meeting")
            st.caption("Ask a follow-up question and the app will answer using the transcript and the extracted artifact.")

            if prompt := st.chat_input("Ask about the meeting"):
                if not api_key:
                    st.error("Add your Groq API key first.")
                else:
                    client = Groq(api_key=api_key)
                    with st.spinner("Finding the most relevant evidence..."):
                        try:
                            answer = answer_question(
                                client,
                                model=llm_model,
                                question=prompt,
                                transcript_segments=transcript_segments,
                                artifact=artifact,
                                context_prompt=context_prompt,
                            )
                            st.session_state.qa_history.append({"role": "user", "content": prompt})
                            st.session_state.qa_history.append({"role": "assistant", "content": answer})
                        except Exception as exc:
                            st.error(f"Question answering failed: {exc}")

            for entry in st.session_state.qa_history:
                if entry["role"] == "user":
                    st.chat_message("user").write(entry["content"])
                else:
                    with st.chat_message("assistant"):
                        st.write(entry["content"].get("answer", ""))
                        citations = entry["content"].get("citations", [])
                        if citations:
                            st.markdown("**Citations**")
                            for citation in citations:
                                st.markdown(
                                    f"- `{citation.get('timestamp', '--:--')}` - {citation.get('quote', '')}"
                                )

        with tab_export:
            st.subheader("Export")
            markdown_report = render_markdown_report(context, artifact, summary, source_name)
            docx_bytes = build_docx_bytes(context, artifact, summary, source_name)
            pdf_bytes = build_pdf_bytes(context, artifact, summary, source_name)

            st.download_button(
                "Download Markdown",
                markdown_report.encode("utf-8"),
                file_name="meeting_summary.md",
                mime="text/markdown",
                use_container_width=True,
            )
            if docx_bytes:
                st.download_button(
                    "Download DOCX",
                    docx_bytes,
                    file_name="meeting_summary.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    use_container_width=True,
                )
            else:
                st.info("DOCX export becomes available after installing `python-docx`.")
            if pdf_bytes:
                st.download_button(
                    "Download PDF",
                    pdf_bytes,
                    file_name="meeting_summary.pdf",
                    mime="application/pdf",
                    use_container_width=True,
                )
            else:
                st.info("PDF export becomes available after installing `reportlab`.")

            st.markdown("### Markdown preview")
            st.code(markdown_report, language="markdown")
    else:
        st.info("Run the meeting pipeline to generate the summary, or paste a transcript and process it.")


if __name__ == "__main__":
    main()

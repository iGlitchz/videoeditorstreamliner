"""One-shot local transcription worker. JSON is written to stdout; diagnostics to stderr."""
from __future__ import annotations

import json
import os
import sys


def choose_device() -> tuple[str, str]:
    requested = os.environ.get("WHISPER_DEVICE", "auto").lower()
    if requested in {"cpu", "cuda"}:
        return requested, "float16" if requested == "cuda" else "int8"
    try:
        import ctranslate2
        cuda_types = ctranslate2.get_supported_compute_types("cuda")
        if "float16" in cuda_types:
            return "cuda", "float16"
        if "int8_float16" in cuda_types:
            return "cuda", "int8_float16"
    except Exception:
        pass
    return "cpu", "int8"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: worker.py <audio-path>", file=sys.stderr)
        return 2
    audio_path = os.path.abspath(sys.argv[1])
    if not os.path.isfile(audio_path):
        print("audio file does not exist", file=sys.stderr)
        return 2
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper is not installed. Run: pip install -r apps/transcription-worker/requirements.txt", file=sys.stderr)
        return 3
    device, compute_type = choose_device()
    model_name = os.environ.get("WHISPER_MODEL", "small.en")
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        segments, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True, vad_filter=True)
        text_parts: list[str] = []
        words: list[dict[str, object]] = []
        for segment in segments:
            text_parts.append(segment.text.strip())
            for word in segment.words or []:
                words.append({"word": word.word, "start": word.start, "end": word.end, "probability": word.probability})
        print(json.dumps({"text": " ".join(text_parts).strip(), "words": words, "duration": float(info.duration), "language": info.language, "device": device}))
        return 0
    except Exception as exc:
        if device == "cuda":
            print(f"CUDA transcription failed ({exc}). Set WHISPER_DEVICE=cpu to force fallback.", file=sys.stderr)
        else:
            print(f"Transcription failed: {exc}", file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())

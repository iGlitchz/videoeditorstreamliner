# Transcription worker

Install into a Python 3.10+ virtual environment:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r apps\transcription-worker\requirements.txt
```

Set `PYTHON_EXECUTABLE` to the virtual environment's `python.exe`. The worker asks CTranslate2 which CUDA compute types are available and otherwise uses CPU `int8`. Override with `WHISPER_DEVICE=cpu` or `cuda`; select a model with `WHISPER_MODEL` (default `small.en`). Model files are downloaded by faster-whisper on first use.

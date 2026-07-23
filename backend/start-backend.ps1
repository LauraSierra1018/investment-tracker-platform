$ErrorActionPreference = "Stop"
if (-not (Test-Path ".venv")) { py -m venv .venv }
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload --port 8000

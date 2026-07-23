# Investment Research Platform

Aplicación full stack para buscar, analizar y seguir acciones usando criterios fundamentales, técnicos y de riesgo.

## Componentes
- `backend`: FastAPI + SQLite + yfinance.
- `frontend`: Next.js + TypeScript + Tailwind.

## Inicio rápido

### Backend
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py -m uvicorn app.main:app --reload --port 8000
```

### Frontend
En otra terminal:
```powershell
cd frontend
npm install
npm run dev
```

Abre http://localhost:3000 y la documentación de la API en http://localhost:8000/docs.

## Variables opcionales
Copia `backend/.env.example` a `backend/.env`.
- `OPENAI_API_KEY`: habilita análisis narrativo con IA.
- `OPENAI_MODEL`: modelo a utilizar.
- `ALPHA_VANTAGE_API_KEY`: reservado para un proveedor alternativo/licenciado.

## Aviso
La aplicación es una herramienta de investigación educativa. No ejecuta operaciones ni garantiza resultados.

# Investment Research AI

Plataforma full-stack para investigación de acciones y ETFs, seguimiento de portafolios y análisis cuantitativo orientado a toma de decisiones.

El proyecto combina **Research**, **Watchlist**, **Portfolio**, **Portfolio Lab**, análisis de riesgo y un **Opportunity Engine** que prioriza activos según la composición actual del portafolio del usuario.

## Funcionalidades principales

### Research

- Búsqueda de acciones y ETFs por ticker o nombre.
- Información de precio, fundamentales, valoración y riesgo.
- Gráficos históricos.
- Investment Score basado en criterios cuantitativos.
- Comparación de múltiples activos.
- Análisis asistido por IA.
- Registro automático de activos consultados en **Research Universe**.
- Acciones directas desde Research:
  - Agregar a Watchlist.
  - Probar en Portfolio Lab.
  - Ver impacto frente al portafolio actual.

### Research Opportunities

La plataforma no recomienda activos únicamente por tener un score alto.

El **Opportunity Engine** evalúa candidatos según su encaje con el portafolio actual:

- Calidad de inversión.
- Beneficio de diversificación.
- Ajuste al perfil de riesgo.
- Valoración.
- Crecimiento.
- Penalización por concentración.

De esta forma, Research puede priorizar activos que aporten más valor estructural al portafolio, incluso cuando su Investment Score individual sea menor que el de otros candidatos.

Las oportunidades se obtienen desde el **Research Universe**, no únicamente desde la Watchlist.

## Watchlist

- Watchlist privada por usuario.
- Persistencia en base de datos.
- Ranking por Investment Score.
- Métricas de precio, valoración, crecimiento, riesgo y potencial.
- Independiente de fallos temporales de proveedores de mercado.

## Portfolio

El módulo Portfolio está dividido en dos entornos independientes:

### Real Portfolio

Permite analizar las inversiones reales del usuario.

Incluye:

- Valor actual.
- Capital invertido.
- P/L.
- Distribución por activo.
- Distribución por sector.
- Concentración.
- Diversificación.
- Calidad.
- Valoración.
- Crecimiento.
- Riesgo.
- Beta ponderada.
- Evolución histórica estimada.
- Portfolio Health.
- Alertas cuantitativas.
- Oportunidades de investigación personalizadas.

Las posiciones repetidas de un mismo ticker se consolidan para el análisis, conservando los lotes originales en la base de datos.

### Portfolio Lab

Entorno completamente simulado para probar ideas sin modificar el portafolio real.

Permite:

- Crear múltiples mock portfolios.
- Definir capital inicial.
- Añadir acciones o ETFs usando montos ficticios.
- Manejar posiciones fraccionarias.
- Visualizar allocation.
- Probar directamente activos enviados desde Research.
- Ejecutar simulaciones probabilísticas a un año.

## Simulación Monte Carlo

Portfolio Lab incluye una simulación de aproximadamente:

- 252 sesiones futuras.
- 10.000 trayectorias.
- Retornos históricos.
- Volatilidad.
- Covarianza entre activos.
- Shocks correlacionados mediante descomposición de Cholesky.

Resultados:

- Bear Scenario — Percentil 5.
- Base Scenario — Percentil 50.
- Bull Scenario — Percentil 95.
- Probabilidad de terminar por encima del valor inicial.
- Retorno mediano.
- Volatilidad anualizada.

La simulación es una herramienta probabilística y educativa; no constituye una predicción garantizada.

## SnapTrade — Broker Integration

El proyecto incorpora una integración con **SnapTrade Commercial** para que cada usuario pueda conectar su propio broker.

La integración está diseñada como **read-only**.

La aplicación puede consultar:

- Conexiones.
- Cuentas.
- Posiciones.
- Balances.
- Efectivo.
- Estado de sincronización.

La aplicación **no crea, modifica ni cancela órdenes**.

Cada usuario autenticado mediante Supabase tiene su propia identidad SnapTrade y conecta únicamente sus propias cuentas.

Arquitectura:

```text
Usuario
   ↓
Supabase Auth
   ↓
SnapTrade Commercial User
   ↓
Connection Portal
   ↓
Broker del usuario
   ↓
Accounts / Positions / Balances
   ↓
Real Portfolio
   ↓
Portfolio Health
   ↓
Research Opportunities
```

Los `userSecret` de SnapTrade se almacenan cifrados en backend y nunca se exponen al navegador.

## Arquitectura general

```text
RESEARCH
├── Investigación individual
├── Comparación
├── Research Universe
├── Opportunities
│   └── Personalizadas según Portfolio
├── Watchlist
└── IA

PORTFOLIO
├── Real Portfolio
│   ├── Manual
│   └── SnapTrade read-only
│
└── Portfolio Lab
    ├── Mock portfolios
    └── Monte Carlo

BACKEND
├── FastAPI
├── SQLAlchemy
├── Supabase PostgreSQL
├── Supabase Auth
├── Market Data
├── Opportunity Engine
├── Research Universe
├── OpenAI
└── SnapTrade

FRONTEND
├── Next.js
├── React
├── TypeScript
├── Tailwind CSS
└── Recharts
```

## Stack tecnológico

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- Recharts
- Supabase Auth

### Backend

- FastAPI
- Python
- SQLAlchemy
- Pydantic
- PostgreSQL / Supabase
- OpenAI API
- SnapTrade API
- yfinance

### Deployment

- Frontend: Vercel
- Backend: Render
- Database: Supabase PostgreSQL

## Variables de entorno

Nunca subas archivos `.env` al repositorio.

Backend:

```env
DATABASE_URL=
FRONTEND_ORIGIN=

OPENAI_API_KEY=
OPENAI_MODEL=

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=

SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
SNAPTRADE_ENCRYPTION_KEY=
SNAPTRADE_REDIRECT_URL=
```

Frontend:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
BACKEND_URL=
```

## Instalación local

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

API:

```text
http://127.0.0.1:8000
```

Swagger:

```text
http://127.0.0.1:8000/docs
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend:

```text
http://localhost:3000
```

## Endpoints relevantes

### Research

```text
GET  /stocks/{ticker}
GET  /stocks/{ticker}/history
GET  /search
POST /portfolio/universe/{ticker}
```

### Watchlist

```text
GET    /watchlist
POST   /watchlist
DELETE /watchlist/{ticker}
```

### Portfolio

```text
GET    /portfolio
POST   /portfolio
PUT    /portfolio/{position_id}
DELETE /portfolio/{position_id}

GET /portfolio/analysis
GET /portfolio/history
GET /portfolio/opportunities
GET /portfolio/impact/{ticker}
```

### SnapTrade

```text
GET  /portfolio/broker/status
POST /portfolio/broker/connect
POST /portfolio/broker/reconnect/{authorization_id}
POST /portfolio/broker/sync
GET  /portfolio/broker/positions
```

No existen endpoints de trading.

## Modelo de scoring

El Investment Score combina múltiples criterios cuantitativos, entre ellos:

- Market Cap.
- P/E.
- Revenue.
- Free Float.
- Analyst Upside.
- Revenue Growth.
- Earnings Growth.
- ROE.
- ROA.
- Operating Margin.
- Debt / Equity.
- Current Ratio.
- Free Cash Flow.
- Beta.

Las métricas sin datos disponibles no penalizan automáticamente el score; se excluyen del denominador cuando corresponde.

## Seguridad

- Autenticación mediante Supabase.
- Watchlist y Portfolio son privados por usuario.
- `.env` está excluido del repositorio.
- Consumer keys y secretos se mantienen exclusivamente en backend.
- SnapTrade funciona en modo read-only.
- Los secretos individuales de SnapTrade se almacenan cifrados.
- Portfolio Lab nunca se mezcla con dinero real.
- No se implementan endpoints de órdenes.

## Estado actual

Actualmente están implementados:

- Research completo.
- Comparador de activos.
- Watchlist privada.
- Research Universe.
- Investment Score.
- Real Portfolio.
- Consolidación de lotes.
- Portfolio Health.
- Opportunity Engine.
- Research Opportunities personalizadas.
- Portfolio Lab.
- Monte Carlo a un año.
- Integración Research → Portfolio Lab.
- Análisis de impacto desde Research.
- Base de integración SnapTrade read-only.

## Próximos pasos

- Completar flujo de conexión y reconexión de brokers.
- Mejorar sincronización de balances y cash.
- Añadir Universe Discovery para encontrar activos que todavía no hayan sido investigados.
- Ampliar cobertura de ETFs.
- Incorporar exposición por asset class.
- Mejorar el análisis de impacto antes/después en Portfolio Lab.
- Añadir métricas históricas del portafolio sincronizado.
- Preparar despliegue completo de SnapTrade en producción.

## Disclaimer

Investment Research AI es una herramienta educativa y de investigación.

La información, scores, simulaciones y oportunidades mostradas por la plataforma no constituyen asesoría financiera personalizada ni garantizan rendimientos futuros.

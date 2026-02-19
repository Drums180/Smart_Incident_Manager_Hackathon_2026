# Safety AnalystBot

Two-panel app: safety dashboard + RAG-powered chatbot over 196 incident records.

## Stack

- Backend: FastAPI + ChromaDB + Sentence Transformers + Groq/Anthropic
- Frontend: Next.js 14 + Tailwind + Zustand

## Run locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Add hackathon_base_table.csv to backend/data/
# Add severity_model.pkl to backend/models/ (optional)
uvicorn main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Deploy

**Backend → Render**
1. Push to GitHub
2. New Web Service → connect repo → Root Directory: backend
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add env vars: `FRONTEND_URL` (your Vercel URL)

**Frontend → Vercel**
1. Import repo → Root Directory: frontend
2. Add env var: `NEXT_PUBLIC_API_URL` (your Render URL)

## Environment variables

**Backend:** `FRONTEND_URL`, `CHROMA_PATH`, `DEFAULT_CSV_PATH`, `SEVERITY_MODEL_PATH`

**Frontend:** `NEXT_PUBLIC_API_URL`

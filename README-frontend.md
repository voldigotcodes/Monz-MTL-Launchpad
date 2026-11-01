# Monz MTL Launchpad — Web Frontend

Next.js (App Router) web UI that drives the existing Python backend API. Focused on a calm, linear launch flow: upload → preview → confirm → launch → poll logs/results.

## Stack
- Next.js + React + TypeScript
- Browser uploads (folder / files / zip)
- Backend does all Meta + launch logic

## Run in dev
```bash
npm install
npm run dev
```
Requirements:
- Backend API running on `http://localhost:8000` (see below).
- Frontend env: `NEXT_PUBLIC_API_BASE=http://localhost:8000`

Start the backend (example):
```bash
python3 -m uvicorn launcher.backend:app --reload --port 8000
```

## Build
```bash
npm run build
npm run start
```

## UI behaviors
- **Uploads**: Folder uploads via `<input webkitdirectory>`, plus optional ZIP upload.
- **Preview**: Backend preview via `GET /uploads/{upload_id}/preview`.
- **Launch**: Starts a backend job via `POST /launch/jobs`.
- **Logs**: Polls `GET /launch/jobs/{job_id}?after=N` for incremental logs.
- **Presets**: Stored in browser localStorage.
- **Settings**: Status checks only (no token storage in the UI).

## Folder conventions (UI mirrors backend)
```
/CampaignFolder
  /AdsetA
    creative1.mp4
    creative2.jpg
  /AdsetB              # nested folders => carousel
    /Carousel1
      frame1.png
      frame2.png
    single.png
```
Ad counts: one ad per file, or one ad per carousel group (>=2 images).

# Swap

Monorepo with three apps:

| Directory | Stack | Purpose |
|-----------|--------|---------|
| `web/` | Next.js (Vercel) | Web app |
| `mobile/` | Bare React Native | iOS & Android |
| `server/` | Express (TypeScript) | Marketplace API |

## Setup

```bash
# Server (marketplace API — keep this running)
cd server
cp .env.example .env   # set RELAI_PUBLISHABLE_KEY + ALLOW_RESEED=true
npm install && npm run dev

# Web (same marketplace + Relai login as mobile; no physical unlock)
cd web
cp .env.example .env.local   # NEXT_PUBLIC_RELAI_PUBLISHABLE_KEY + NEXT_PUBLIC_API_BASE_URL
npm install && npm run dev

# Mobile (bare RN — not Expo)
cd mobile
cp .env.example .env   # RELAI_PUBLISHABLE_KEY + API_BASE_URL=http://localhost:4000
npm install
# iOS once:
cd ios && bundle install && bundle exec pod install && cd ..
npm start              # Metro
# other terminal:
npm run ios            # or: npm run android
```

- Web: http://localhost:3000  
- API: http://localhost:4000 (`GET /health`, `GET /api/listings`)  
- Mobile: iOS Simulator / Android emulator via `npm run ios` / `npm run android`

## Deploy web to Vercel

1. Import this repo in Vercel.
2. Set **Root Directory** to `web`.
3. Deploy (framework is detected as Next.js).

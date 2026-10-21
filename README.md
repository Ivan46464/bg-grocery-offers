# BG Оферти — grocery offer tracker for Bulgaria

Search the weekly promotions of **Lidl, Kaufland, Billa and Metro** in one place and see the cheapest match first.

## Features

| Tab | What it does |
|-----|--------------|
| **Оферти** | Fuzzy search (BG / EN / Latin-letter typing, typo-tolerant), cheapest first. Quick-filter chips: Постни, Био, Млечни, Месо, Плодове, Напитки, Хляб, Сладко, Дом. Store chips, sort by price or discount. Tap an offer → details, 90-day price trend, add to cart / watch. |
| **Количка** | One shopping list, three views. **Списък:** write items or pick specific products with pictures (`/api/catalog/search` = current offers + METRO's catalogue), tick them off in the store, quantity + price paid, "fill prices from offers". **Най-евтино:** *best single store* and *best split trip* with € saved (EAN / strict name matching, so "Маджаров кашкавал" never becomes a croissant). **Разходи:** finishing a trip logs it (store, date, items, total) → this month, 6-month bars, per-store split, trip history. All on-device. |
| Tap an offer | Detail sheet shows the **same product in other stores** (with price difference) and **similar products** of the same kind (`/api/offers/{id}/similar`) — plain string matching, no AI service involved. |
| **Скенер** | Point the camera at an EAN-13 in the store → exact barcode matches (Metro, Kaufland publish them) or name matches via Open Food Facts → "cheaper elsewhere?" |
| **Наблюдение** | Watchlist of **specific products** (picked with a picture, matched by EAN / strict name) + optional target price. Re-checked after every scrape; push notification (needs FCM, see §6) or in-app alert. |
| Fake-discount detector | Every scrape is appended to `price_history`; an offer gets a green **Най-ниска за 90 дни** badge or an amber **Беше X €** warning when it was cheaper recently. |

```
Market/
├── backend/            FastAPI + SQLite + scrapers        (Python 3.11+)
│   ├── main.py         API endpoints, startup/periodic scraping
│   ├── models.py       Offer, PriceHistory, PushToken, Watch tables + API schemas
│   ├── database.py     engine / session / tiny auto-migration
│   ├── scraper.py      one scraper class per store + mock fallback
│   ├── search.py       fuzzy search (RapidFuzz, BG/EN synonyms, transliteration)
│   ├── tags.py         keyword → category chips (постни, млечни, …)
│   ├── history.py      price history + 90-day-low detection
│   ├── cart.py         smart-cart optimiser
│   ├── catalog.py      product picker search (offers + METRO catalogue) + strict cross-store matching
│   ├── barcode.py      EAN lookup (+ Open Food Facts fallback)
│   ├── push.py         watchlist evaluation + Expo push
│   ├── leaflet_ocr.py  Kaufland leaflet pages -> products via OCR (run by GitHub Actions, not on Render)
│   └── requirements.txt
├── data/kaufland_leaflet.json   OCR output, committed by the workflow, merged by the Kaufland scraper
├── mobile/             Expo / React Native app              (Node 18+)
│   ├── App.js          bottom tabs, safe areas, notification handler
│   ├── src/config.js   ← API URL lives here
│   ├── src/api.js      fetch wrapper (70 s timeout, cold-start aware)
│   ├── src/theme.js    colours / spacing / typography tokens
│   ├── src/screens/    SearchScreen, CartScreen, ScannerScreen, WatchScreen
│   ├── src/components/ SearchBar, Chips, OfferCard, OfferSheet, Sparkline, …
│   ├── app.json        app name, Android package id, camera/notification plugins
│   └── eas.json        EAS build profiles (preview = .apk)
├── .github/workflows/keepalive.yml   pings the API every 10 min so Render never sleeps
├── render.yaml         one-click Render deploy blueprint
└── README.md
```

### Current scraper status

| Store    | Status | How |
|----------|--------|-----|
| Lidl     | ✅ ~670 offers | wildcard storefront search `/q/search?q=*&offset=N` (48/page, product JSON in `data-grid-data`) + Lidl Plus page |
| Kaufland | ✅ ~850 offers + leaflet extras | server-rendered `.k-product-tile` HTML, weekly validity per section. The printed leaflet has products the site never lists, so `backend/leaflet_ocr.py` OCRs every page of the current leaflets (leaflets.kaufland.com API → page images → RapidOCR Cyrillic) into `data/kaufland_leaflet.json`; [leaflet-ocr.yml](.github/workflows/leaflet-ocr.yml) refreshes it Mon + Thu and the scraper merges leaflet-only items (labelled "Брошура стр. N", linked to the page) |
| Billa    | ✅ ~275 offers | ssbbilla.site's text transcription of the whole leaflet (billa.bg itself is image-only; no product images); falls back to broshuri.net |
| Metro    | ✅ ~350 offers | shop.metro.bg search + variants JSON |

**Loyalty cards & multi-buy:** Kaufland Card (XTRA) and Lidl Plus prices are scraped into `card_price`
(`card_only` when there is no price without the card), Billa cashback is subtracted into `card_price`, and
labels like "1+1 безплатно" / "-60% на всеки втори" land in `promo_label`. Search, cart and watchlist sort
by `effective_price` = the card price when one exists.

If a scraper breaks (site redesign) it falls back to demo rows flagged `is_mock: true`, and the app shows a yellow "демо данни" banner for that store until you fix the selectors in `scraper.py`.

---

## 1. Run the backend locally

```bash
cd backend
```

```bash
python -m venv .venv
```

Windows:
```bash
.venv\Scripts\activate
```
macOS / Linux:
```bash
source .venv/bin/activate
```

```bash
pip install -r requirements.txt
```

```bash
uvicorn main:app --reload
```

On first start the DB is empty, so all scrapers run in the background (~5 s). Then open:

* http://127.0.0.1:8000/docs — interactive API docs
* http://127.0.0.1:8000/api/search?q=сирене
* http://127.0.0.1:8000/api/search?q=cheese&sort=discount
* http://127.0.0.1:8000/api/stores — counts + real/demo flag per store

Test a single scraper without the server:

```bash
python scraper.py
```

### API reference

| Method | Path | Query / body | Notes |
|--------|------|--------------|-------|
| GET | `/api/status` | – | `scraping` flag + per-store counts (app polls this on cold start) |
| GET | `/api/tags` | `store` | quick-filter chips with counts |
| GET | `/api/search` | `q` (required), `store`, `tag`, `sort=price\|score\|discount`, `limit` | fuzzy search, cheapest first |
| GET | `/api/offers` | `store`, `tag`, `sort=price\|discount\|newest`, `limit`, `offset` | browse without a query |
| GET | `/api/offers/{id}/history` | `days` | price points for the trend line |
| GET | `/api/offers/{id}/similar` | – | same product in other stores + similar products (same kind) |
| GET | `/api/barcode/{ean}` | – | exact + similar offers for a scanned code |
| GET | `/api/catalog/search` | `q`, `limit` | specific products to pick (offers + METRO catalogue), with image + EAN |
| POST | `/api/cart/optimize` | `{"items": [{"name","barcode","exact":true}, "яйца"]}` | best single store + best split trip |
| POST | `/api/cart/add` | `{"item_name","added_by","raw_message"}` (+ `X-API-Key` when `BRIDGE_TOKEN` is set) | list inbox: LoveChat sends items written in the chat ("купи домати") |
| GET / POST | `/api/cart/inbox`, `/api/cart/inbox/ack` | – / `{"ids":[…]}` | the app merges unconsumed inbox items into its on-device list on the Количка tab, then acks |
| POST | `/api/push/register` | `{"token": "ExponentPushToken[..]"}` | save a push token |
| GET/POST/DELETE | `/api/watch` | `token`, `{"token","query","target_price"}` | watchlist |
| GET | `/api/stores` | – | per-store count, `is_mock`, `last_scraped` |
| POST | `/api/refresh` | `token` | re-run scrapers now (protected by `REFRESH_TOKEN`) |
| GET | `/health` | – | for uptime pings |

Environment variables (all optional):

| Var | Default | Meaning |
|-----|---------|---------|
| `SCRAPE_INTERVAL_HOURS` | `12` | periodic re-scrape while the server is awake |
| `SCRAPE_ON_STARTUP` | `auto` | `auto` = only if DB empty, `always`, `never` |
| `REFRESH_TOKEN` | *(empty = open)* | secret for `POST /api/refresh` |
| `DATABASE_URL` | `sqlite:///./offers.db` | swap for Postgres later if needed |

---

## 2. Deploy the backend (free) — Render

### Why Render and not your PythonAnywhere account?

PythonAnywhere's **free** tier only allows outbound HTTP to a whitelist of sites. `lidl.bg` and
`kaufland.bg` are not on it, so the scrapers would fail with a proxy error; you would need the
$5/month plan to lift that (and its FastAPI/ASGI support is still in beta). Render's free tier has
no such limit, supports FastAPI natively and deploys straight from GitHub. The trade-off: a free
Render service sleeps after 15 min idle and the first request afterwards takes ~30–50 s. The app
handles that (20 s timeout + "try again" button), and step 2.4 shows how to keep it awake for free.

### 2.1 Push the code to GitHub

```bash
cd C:\Users\ilko0\PycharmProjects\Market
```
```bash
git init
```
```bash
git add .
```
```bash
git commit -m "BG grocery offers: FastAPI backend + Expo app"
```
Create an empty repo on https://github.com/new (e.g. `bg-grocery-offers`, public or private), then:
```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/bg-grocery-offers.git
```
```bash
git branch -M main
```
```bash
git push -u origin main
```

### 2.2 Create the service on Render

1. Go to https://render.com → sign up with GitHub (free, no card).
2. **New +** → **Blueprint** → pick your repo → Render reads `render.yaml` and shows one service
   `bg-grocery-offers-api`. Click **Apply**.

   *Manual alternative (New + → Web Service):*
   * Root Directory: `backend`
   * Runtime: Python 3
   * Build Command: `pip install -r requirements.txt`
   * Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   * Instance type: **Free**
   * Environment → add `PYTHON_VERSION` = `3.12.7` and `REFRESH_TOKEN` = any long random string
3. Wait ~2 min for the first deploy. Your URL will be like
   `https://bg-grocery-offers-api.onrender.com` (copy it — the app needs it).
4. Check: `https://<your-url>/api/stores` should list 4 stores with counts.

**Current deployment:** `https://bg-grocery-offers-api.onrender.com`, created from the public repo URL
(GitHub account not connected to Render). That mode has **no auto-deploy**: after a `git push`, open the
service on https://dashboard.render.com → **Manual Deploy → Deploy latest commit**. To get auto-deploy on push,
connect your GitHub account in Render (Settings → Git provider) and re-link the repo.

### 2.3 Note on the database

SQLite lives on the service's disk, which Render **wipes on every deploy/restart** on the free plan.
That's fine here: the DB is a cache, and `main.py` re-scrapes on startup whenever it's empty.
If you ever want persistence, add a Render Postgres (free 30 days, then $7) and set `DATABASE_URL`.

### 2.4 Keep it awake (already set up)

A **cron-job.org** job (account: the app owner's) requests `https://bg-grocery-offers-api.onrender.com/health`
**every 5 minutes**, so the free instance never spins down and the app opens instantly. While awake the API
re-scrapes every 12 h by itself. Manage it at https://console.cron-job.org/jobs.

[.github/workflows/keepalive.yml](.github/workflows/keepalive.yml) does the same from GitHub Actions as a
backup, but GitHub throttles frequent schedules heavily (it ran ~6 times in 19 h), so don't rely on it alone.

If you ever need a manual re-scrape: `curl -X POST "https://<your-url>/api/refresh?token=<REFRESH_TOKEN>"`
(`REFRESH_TOKEN` is in Render → your service → **Environment**).

---

## 3. Point the mobile app at the deployed backend

Open [mobile/src/config.js](mobile/src/config.js) and change one line:

```js
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://bg-grocery-offers-api.onrender.com").replace(/\/$/, "");
```

(or copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_API_URL` there).

For local testing against your PC instead, use your LAN IP, e.g. `http://192.168.1.23:8000`
(run `ipconfig` to find it; phone and PC must be on the same Wi-Fi). `localhost` will **not** work
from a phone.

### Try it in Expo Go first (no build needed)

```bash
cd mobile
```
```bash
npm install
```
```bash
npx expo start
```
Install **Expo Go** from Google Play, scan the QR code in the terminal, and the app opens on your phone with live reload.

---

## 4. Build the Android APK with EAS

You need a free account at https://expo.dev (sign up once).

```bash
npm install -g eas-cli
```
```bash
cd mobile
```
```bash
eas login
```
```bash
eas init
```
`eas init` links the folder to a project on expo.dev and writes `extra.eas.projectId` into `app.json`
(already done for this repo: project `@ivan464/bg-grocery-offers`). If the interactive prompt gives you
trouble, `eas init --non-interactive --force` does the same without asking.

```bash
eas build -p android --profile preview
```

* The `preview` profile in `eas.json` sets `buildType: "apk"`, so you get an installable `.apk` (not a Play-Store `.aab`).
* First time it asks *"Generate a new Android Keystore?"* → **Yes** (EAS stores it for you). Already done here;
  `--non-interactive` also works and generates the keystore in the cloud.
* The build runs on Expo's servers (free tier: ~30 builds/month, queue time varies). You'll see a link like
  `https://expo.dev/accounts/<you>/projects/bg-grocery-offers/builds/<id>`.
* When it finishes, the terminal prints a **download URL** and shows a QR code. Open it on your phone
  (or run `eas build:list` later to get the link again).

### Install on your phone

1. Open the download link on the phone → `application-<id>.apk` downloads.
2. Tap it. Android asks to allow installs from Chrome/Files → **Allow**, then **Install**.
3. Open **BG Оферти**, type „сирене".

### Updating the app later

* JS-only changes: bump `version`/`versionCode` in `app.json`, run the same `eas build` command, install the new APK over the old one (same package id `com.ilko.bgoffers`, same keystore).
* Backend changes don't need a new APK — just `git push`.

---

## 5. Price history on the free tier

`price_history` lives in the same SQLite file, and Render's free disk is wiped on every deploy, so the
90-day badges only accumulate between deploys. For permanent history create a free Postgres (e.g.
https://neon.tech), add `psycopg[binary]` to `requirements.txt`, and set `DATABASE_URL` on Render to the
`postgresql://…` connection string — nothing else changes.

## 6. Push notifications (optional)

The watchlist works without any setup: the app shows hits in-app and fires a local notification when
opened. For real background push on Android you need Firebase Cloud Messaging credentials on the EAS
project: follow https://docs.expo.dev/push-notifications/fcm-credentials/ (create a Firebase project,
download `google-services.json`, `eas credentials` → upload), then rebuild the APK. After that
`POST /api/push/register` receives `ExponentPushToken[…]` tokens and the backend pushes through Expo.

## 7. When a scraper breaks

Each class in [backend/scraper.py](backend/scraper.py) has a CONFIG block (URLs, CSS selectors or JSON keys) at the top:

1. Open the store's promo page in Chrome → **F12** → **Elements** (HTML sites) or **Network → Fetch/XHR** (JSON sites) → find the new selector / endpoint.
2. Edit only the CONFIG block.
3. Test with `python scraper.py` — the store switches back from demo to real data automatically.

To add store **logos**: drop PNGs into `mobile/assets/` and set `logo: require("../assets/lidl.png")` in `STORES` inside `src/config.js`.

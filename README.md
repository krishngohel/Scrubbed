# Scrubbed by Meridia

**The intelligent application platform for pre-med students.**

Scrubbed turns your application record into school-specific, personalized outlines for every secondary essay prompt you face — so you always start writing from the strongest possible angle, not a blank page.

---

## Overview

Scrubbed is a full-stack web application with two core pages:

| File | Purpose |
|---|---|
| `index.html` | Landing page — product overview, manifesto, how it works, features |
| `vault.html` | The Premed Vault — application record storage, template editor, file export |

---

## Running the App

> **Important:** You must run the app through the Node.js server. Opening `index.html` directly in a browser will not work — authentication requires the backend API.

### Prerequisites

- **Node.js v22 or higher** — [nodejs.org](https://nodejs.org)
  - Check your version: `node --version`
  - This project uses Node's built-in SQLite (`node:sqlite`), available from v22+

---

### Step 1 — Install dependencies

Open a terminal in the project folder and run:

```bash
npm install
```

This installs Express, bcryptjs, jsonwebtoken, and cors. It takes about 5–10 seconds. You only need to do this once.

**Expected output:**

```
added 112 packages, and audited 113 packages in 3s
found 0 vulnerabilities
```

---

### Step 2 — Start the server

```bash
node server.js
```

**Expected output:**

```
Scrubbed server running at http://localhost:3000
```

Leave this terminal open while you use the app. To stop the server, press `Ctrl + C`.

---

### Step 3 — Open the app

Open your browser and go to:

```
http://localhost:3000
```

> Do **not** open `index.html` as a file (`file:///...`). Always use `http://localhost:3000`.

---

### Step 4 — Create an account

1. Click **Log in** in the top-right navigation bar
2. The auth modal will open on the **Log in** tab
3. Click **Create account** to switch to the signup tab
4. Enter a username (minimum 3 characters)
5. Enter a password — requirements appear below the field and grey out as you meet each one:
   - At least 8 characters
   - One uppercase letter (A–Z)
   - One lowercase letter (a–z)
   - One number (0–9)
   - One special character (`!@#$` etc.)
6. Confirm your password
7. Click **Create account**

You are automatically logged in. The "Log in" button becomes a circular user icon.

---

### Step 5 — Log in (returning users)

1. Click **Log in** in the navigation bar
2. Enter your username and password
3. Click **Log in**

Your session persists across page refreshes and navigating between pages — the JWT is stored in `localStorage` and validated automatically on every load.

---

### Development mode (auto-restart on file changes)

```bash
npm run dev
```

Requires nodemon (included as a dev dependency). The server restarts automatically whenever you edit a backend file.

---

## Project Structure

```
Scrubbed/
├── index.html          # Marketing / landing page (includes auth modal)
├── vault.html          # Premed Vault application (includes auth modal)
├── server.js           # Express server — entry point
├── db.js               # SQLite database setup (node:sqlite)
├── package.json        # Dependencies and scripts
├── scrubbed.db         # SQLite database (auto-created on first run)
├── routes/
│   └── auth.js         # POST /auth/signup, POST /auth/login
├── middleware/
│   └── auth.js         # JWT verification middleware
├── node_modules/       # Installed packages (do not commit)
└── README.md
```

---

## Auth API Reference

### `POST /auth/signup`

Create a new account.

**Request body:**
```json
{ "username": "yourname", "password": "Secure@99" }
```

**Responses:**
| Status | Meaning |
|---|---|
| `201` | Account created |
| `400` | Missing fields or password fails requirements |
| `409` | Username already taken |

---

### `POST /auth/login`

Log in with existing credentials.

**Request body:**
```json
{ "username": "yourname", "password": "Secure@99" }
```

**Success response `200`:**
```json
{
  "token": "<JWT>",
  "user": { "id": 1, "username": "yourname" }
}
```

**Responses:**
| Status | Meaning |
|---|---|
| `200` | Success — returns JWT and user |
| `400` | Missing fields |
| `401` | Invalid username or password |

---

### `GET /me` *(protected)*

Verify a token and retrieve the logged-in user.

**Header required:**
```
Authorization: Bearer <token>
```

**Success response `200`:**
```json
{ "id": 1, "username": "yourname" }
```

**Responses:**
| Status | Meaning |
|---|---|
| `200` | Token valid — returns user |
| `401` | Missing, invalid, or expired token |

---

## Database

SQLite is used for local development. The database file (`scrubbed.db`) is created automatically in the project root when the server starts for the first time.

**`users` table:**

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Stable user identifier — used to associate all future data |
| `username` | TEXT UNIQUE | Case-sensitive, minimum 3 characters |
| `password_hash` | TEXT | bcrypt hash, 10 salt rounds |
| `created_at` | TIMESTAMP | Set automatically |

The `id` field is the single source of truth for per-user data. All future tables (files, records, edits) will reference it as `user_id`.

---

## Features

### Landing Page (`index.html`)
- Animated hero with rotating headline verbs
- Floating application query cards (auto-cycling)
- Manifesto / About section with staggered scroll reveals
- How It Works — 3 steps with inner-element stagger animations
- Features overview with scroll-triggered glass shimmer
- Ambient rainforest audio (Web Audio API — rain layers, wind LFO, bird chirps)
- **Auth modal** — login and account creation in one popup, with live password requirements

### The Premed Vault (`vault.html`)
- 9 file templates across two types: **Spreadsheet** (xlsx) and **Document** (pdf)
- In-browser template editor — spreadsheet cells + document sections, all `contenteditable`
- Tab navigation between spreadsheet cells
- Live word count in document editor
- File persistence via `localStorage`
- **Updatable files** — reopen any saved file to edit and save changes
- **Export individual files** — `.xlsx` for logs via SheetJS, `.pdf` via browser print
- **Export All** — batch exports all logs into one `.xlsx` workbook and opens each document for PDF print
- Upload any file format (UI placeholder — backend storage coming soon)
- **Auth modal** — same login/signup system as landing page

### Template Library

| Template | Type | Export |
|---|---|---|
| Clinical Hour Log | Spreadsheet | .xlsx |
| Volunteer Hour Log | Spreadsheet | .xlsx |
| Physician Shadowing Log | Spreadsheet | .xlsx |
| Research Log | Spreadsheet | .xlsx |
| Work & Employment Record | Spreadsheet | .xlsx |
| Recommendation Letter | Document | .pdf |
| Personal Statement | Document | .pdf |
| Activity Description | Document | .pdf |
| Secondary Essay | Document | .pdf |

---

## Tech Stack

**Frontend**
- Pure HTML / CSS / JavaScript — no frameworks, no build step
- [SheetJS (xlsx)](https://sheetjs.com/) — client-side `.xlsx` generation (CDN)
- Web Audio API — generative rainforest ambient sound
- IntersectionObserver — scroll-triggered animations
- CSS custom properties — design token system
- `localStorage` — client-side file persistence
- Google Fonts — Cormorant Garamond, DM Sans, DM Mono

**Backend**
- Node.js + Express — HTTP server and routing
- `node:sqlite` (built-in) — SQLite database, no native compilation required
- bcryptjs — password hashing (10 salt rounds)
- jsonwebtoken — JWT authentication (7-day expiry)
- cors — cross-origin request handling

---

## Design System

| Token | Value | Usage |
|---|---|---|
| `--forest` | `#2d5a27` | Primary green |
| `--forest-mid` | `#3d7a35` | Hover / gradient end |
| `--forest-light` | `#5a9e50` | Accents |
| `--forest-pale` | `#a8c9a0` | Borders / subtle fills |
| `--orange` | `#d4621a` | Accent / emphasis |
| `--orange-warm` | `#e07535` | Hover orange |
| `--warm-white` | `#f5f4f0` | Page background |
| `--off-white` | `#fafaf8` | Subtle alternating sections |
| `--ink` | `#1e2e1c` | Body text |
| `--ink-faint` | `#7a8a78` | Secondary text |
| Font Display | Cormorant Garamond | Headlines |
| Font Body | DM Sans | Body copy, UI |
| Font Mono | DM Mono | Labels, badges, data |

---

## Pending

- [ ] Server-side file storage and sync across devices
- [ ] SecondaryAI — AI-powered school-specific outline generation
- [ ] Portfolio health analysis (repeated stories, unused credentials)
- [ ] Submission timing intelligence
- [ ] Real file upload parsing and standardization

---

## License

© 2026 Meridia. All rights reserved.

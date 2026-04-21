# Scrubbed by Meridia

**The intelligent application platform for pre-med students.**

Scrubbed turns your application record into school-specific, personalized outlines for every secondary essay prompt you face — so you always start writing from the strongest possible angle, not a blank page.

---

## Overview

Scrubbed is a static web application with two core pages:

| File | Purpose |
|---|---|
| `index.html` | Landing page — product overview, manifesto, how it works, features |
| `vault.html` | The Premed Vault — application record storage, template editor, file export |

---

## Features

### Landing Page (`index.html`)
- Animated hero with rotating headline verbs
- Floating application query cards (auto-cycling)
- Manifesto / About section with staggered scroll reveals
- How It Works — 3 steps with inner-element stagger animations
- Features overview with scroll-triggered glass shimmer
- Ambient rainforest audio (Web Audio API — rain layers, wind LFO, bird chirps)

### The Premed Vault (`vault.html`)
- 9 file templates across two types: **Spreadsheet** (xlsx) and **Document** (pdf)
- In-browser template editor — spreadsheet cells + document sections, all `contenteditable`
- Tab navigation between spreadsheet cells
- Live word count in document editor
- File persistence via `localStorage`
- **Updatable files** — reopen any saved file to edit and save changes
- **Export individual files** — `.xlsx` for logs via SheetJS, `.pdf` via browser print
- **Export All** — batch exports all logs into one `.xlsx` workbook and opens each document for PDF print
- Upload any file format (UI placeholder — backend pending)

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

- **Pure HTML / CSS / JavaScript** — no frameworks, no build step
- **[SheetJS (xlsx)](https://sheetjs.com/)** — client-side `.xlsx` generation (CDN)
- **Web Audio API** — generative rainforest ambient sound
- **IntersectionObserver** — scroll-triggered animations
- **CSS custom properties** — design token system
- **`localStorage`** — client-side file persistence
- **Google Fonts** — Cormorant Garamond, DM Sans, DM Mono

---

## Project Structure

```
Scrubbed/
├── index.html      # Marketing / landing page
├── vault.html      # Premed Vault application
└── README.md
```

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

## Getting Started

No build step required. Open `index.html` in any modern browser.

```bash
# Optional: serve locally to avoid file:// CORS edge cases
npx serve .
# or
python -m http.server 8080
```

---

## Pending (Backend / Auth)

The following features are UI-complete but require a backend before they are functional:

- [ ] User login and account creation
- [ ] Server-side file storage and sync across devices
- [ ] SecondaryAI — AI-powered school-specific outline generation
- [ ] Portfolio health analysis (repeated stories, unused credentials)
- [ ] Submission timing intelligence
- [ ] Real file upload parsing and standardization

---

## License

© 2026 Meridia. All rights reserved.

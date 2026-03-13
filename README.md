# Wahi Bar Inventory System (MVP)

Web-based inventory and ordering starter system for a bar.

## What this includes

- Vendor setup
- Liquor item setup with:
  - Item name
  - FOH/BOH classification
  - Vendor
  - Case size (qty)
  - Multiple bottle sizes (for example: 1L, 750ml) per item
- Par and Levels tool:
  - FOH Par and Levels
  - BOH Par and Levels
- Daily stock count entry (full bottles + partial percentage)
- Reorder suggestion report based on par levels and case size

## Tech stack

- Node.js
- Express
- SQLite (`better-sqlite3`)
- Vanilla HTML/CSS/JavaScript frontend

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## App navigation

- `/` landing page
- `/add-item` add vendors + items
- `/item-catalog` item list, sorting, and editing
- `/catalog` legacy alias to Add Item
- `/par-levels` FOH/BOH par and level setup
- `/counts` daily count entry
- `/reorder` reorder suggestions

## API endpoints (current)

- `GET /api/vendors`
- `POST /api/vendors`
- `GET /api/items`
- `POST /api/items`
- `GET /api/counts?date=YYYY-MM-DD`
- `POST /api/counts`
- `GET /api/par-levels?area=FOH|BOH`
- `POST /api/par-levels`
- `GET /api/reorder?date=YYYY-MM-DD`

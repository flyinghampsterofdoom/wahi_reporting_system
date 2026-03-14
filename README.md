# Wahi Bar Inventory System (MVP)

Web-based inventory and ordering starter system for a bar.

## What this includes

- Vendor setup
  - Name
  - Address
  - Email
  - Corporate number
  - Representative name/phone/email
- Liquor item setup with:
  - Item name
  - FOH/BOH classification
  - Vendor
  - Case size (qty)
  - Cost per tracked bottle size
  - Multiple bottle sizes (for example: 1L, 750ml) per item
- Recipe Builder:
  - Create/edit recipes
  - Typed lines (`Ingredient`, `Recipe`, `Direction`, `Cook Temperature`, `Time`, `Note`)
  - Pull ingredients from Item Catalog
  - Pull nested recipes (self-reference blocked)
  - Live total cost rollup from tracked item costs
- Par and Levels tool:
  - FOH Par and Levels
  - BOH Par and Levels
- Daily stock count entry (full bottles + partial percentage)
- Reorder suggestion report based on par levels and case size

## Tech stack

- Node.js
- Express
- SQLite (`better-sqlite3`) or Postgres (`pg`)
- Vanilla HTML/CSS/JavaScript frontend

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Import price book data (Excel)

```bash
npm run import:pricebook -- "/absolute/path/to/Wahi Price Book V2.1.xlsx"
```

This preserves source-of-truth math inputs in dedicated tables and syncs `Ingredients` into the operational Item Catalog (`vendors`, `items`, `item_sizes`, and area assignments):

- `pricebook_ingredients`
- `pricebook_recipes`
- `pricebook_recipe_lines`
- `pricebook_conversions`
- `pricebook_yields`
- `pricebook_densities`
- `pricebook_drink_catalog`
- `pricebook_food_catalog`
- `pricebook_syrup_catalog`

## App navigation

- `/` landing page
- `/add-item` legacy alias redirects to Item Catalog
- `/item-catalog` item list, sorting, editing, and inline Add Item
- `/add-vendor` vendor profile setup
- `/areas` area/location setup and item-area assignments
- `/catalog` legacy alias redirects to Item Catalog
- `/recipe-builder` recipe creation and line builder
- `/par-levels` FOH/BOH par and level setup
- `/counts` FOH/BOH inventory count entry
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
- `GET /api/pricebook/summary`
- `GET /api/pricebook/recipes`
- `GET /api/pricebook/recipe-lines?recipeName=...`
- `GET /api/recipe-builder/options`
- `GET /api/recipe-builder/recipes`
- `POST /api/recipe-builder/recipes`
- `GET /api/recipe-builder/recipes/:id`
- `PUT /api/recipe-builder/recipes/:id`
- `PUT /api/recipe-builder/recipes/:id/lines`

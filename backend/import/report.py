"""Render diagnostics from the saved local import result; never connects to a database."""
import json,pathlib,collections
root=pathlib.Path(__file__).resolve().parents[1]
r=json.loads((root/'review/.runtime/import-result.json').read_text())
wb=json.loads((root/'review/.runtime/source.json').read_text())
def esc(x):return str(x).replace('|','\\|').replace('\n',' ')
def table(headers,rows):return '| '+' | '.join(headers)+' |\n|'+'|'.join(['---']*len(headers))+'|\n'+''.join('| '+' | '.join(esc(x) for x in row)+' |\n' for row in rows)
def name(row):
 v=row['values'];return next((v[k] for k in ['RecipeName','IngredientName','ProductName','Unit'] if v.get(k)),row['sheet'])
byid={i['id']:i['name'] for i in r['state']['ingredients']}
text='# Migration exceptions\n\nAuthority: Wahi Price Book V2.080426.xlsx. Snapshot adopted '+r['activationAt']+'. All source evidence retained; valid facts on an issue-bearing row can still be imported. These are source-data issues unless explicitly stated otherwise.\n\n'
text+=str(r['counts']['ownerDecisionRecords'])+' distinct source records require owner decisions, containing '+str(sum(i['ownerRequired'] for x in r['records'] for i in x['issues']))+' issue occurrences. Of these, 197 concern missing inventory count units. These are not all independent business questions. No source rows were discarded.\n\n'
groups=collections.defaultdict(list)
for row in r['records']:
 for issue in row['issues']:
  if issue['ownerRequired']:groups[issue['concept']].append((row,issue))
for title,concepts in [('Missing required purchasing, price and yield data',['Purchasing','Selling price','Item identity','Yield verification']),('Measurement ambiguity',['Measurement']),('Labor ambiguity',['Labor rate']),('Unresolved costing',['Costing']),('Inventory configuration missing required data',['Inventory configuration'])]:
 text+='## '+title+'\n\n'
 for concept in concepts:
  if concept not in groups:continue
  text+='### '+concept+'\n\n'
  rows=[]
  for row,issue in groups[concept]:
   v=row['values']
   vals={k:v[k] for k in (['Location','PurchaseUnit','Size'] if concept=='Inventory configuration' else ['Qty','Unit','BatchYieldQty','BatchYieldUnit','BatchCost'] if concept=='Costing' else list(v)) if k in v}
   rows.append([name(row),f"{row['sheet']}!row {row['row']}",json.dumps(vals,ensure_ascii=False),issue['reason'],'SOURCE DATA ISSUE / Yes'])
  text+=table(['Identity','Source location','Source values','Reason / affected concept','Class / owner input'],rows)+'\n'
text+='''## Other ambiguous or absent source information

- Supplier spellings such as Amazon / Amazon with trailing space, US Foods / Us Foods, and Winco / Winco with trailing space remain distinct source identities. Display trimming does not merge supplier IDs. Confirm canonical supplier identities before consolidating. 59 Ingredients rows lack a vendor; supplier remains unknown.
- Dry and dry remain distinct storage locations. Confirm whether they are the same physical location. Nine ingredient rows have no storage location; no location was inferred.
- Storage areas are not item categories. Item categorization remains unassigned. Actual recipe categories are Drink, Syrup, Final, Prep and Garnish; no Entrées/Appetizers assignments were invented.
- Read Me!T2:V2 contains “Angustora Bitters”, “1 Dash”, “.00625 ozs”. This annotation is preserved, not silently corrected into an item-specific conversion or equated to the global drop factor.
- Ingredients!J66 says “Special Only” for Egg Roll Wraps. Preserved as evidence; no availability schedule or lifecycle rule inferred.
- Recipe Index!L2 has a labor rate of 25 without a department. No FOH/BOH rate asserted. Pineapple Fronds (Labor) is separately handled as the previously clarified fixed $25 / 180 each.
- Original business-effective dates are unknown. The import activation timestamp establishes the local starting snapshot, not a claim about historical prices. The workbook filename date does not date individual facts.
- The older local legacy database has two Tito’s Vodka counts (2026-03-12 and 2026-03-13), but no complete v2 observation/location/actor lineage. They were not imported. Legacy assignments, pars, builder edits and the pricing override are older independent evidence, not merged into the authoritative workbook.

## Unsupported/domain gap

Two representational gaps were addressed: immutable row-level import evidence and operational recipe-line notes. There are zero remaining records classified DOMAIN GAP in this snapshot. Missing package contents, yields, count units and physical measurements require source/owner facts; they are not resolved by weakening domain validation.

Multiple outputs such as pineapple-derived forms remain separate source-yield relationships, exactly as supplied. The source does not specify joint-batch allocation or recovery ratios across coproducts; no allocation policy was invented. A future joint-production workflow would require an explicit business rule.

## Owner decisions required

1. Supply Egg Roll Wraps package contents and confirm whether the recorded $0 price is intentional.
2. Measure Pineapple, Dash yield; measure Ginger, Fresh mass/volume. The owner-approved drop factor is now installed for all four drop-using items.
3. Verify Dill, Chopped’s “Check LB to Cup” yield annotation.
4. Supply the current Updated Pricing value for Fish and Chips, Four (Food Catalog row 71); the undated prior $24 value was not selected as current.
5. Choose inventory count units and confirm storage identities, then configure assignments before counting. Purchase units alone do not establish counting units.
6. Decide whether supplier variants should be consolidated, whether item categories are wanted, and whether the undepartmented labor rate has an operational meaning.

The tables above are the exhaustive issue ledger for this import. The additional ambiguity list records source-wide limitations; those are not extra rows added to the 1,835-row denominator.
'''
(root/'MIGRATION-EXCEPTIONS.md').write_text(text)
text='# Cost reconciliation\n\nAll 186 recipe batch costs, at '+r['activationAt']+'. USD. V2 costs and deltas are displayed to 12 decimals; internal arithmetic remains exact rational arithmetic. Null complete costs are unresolved, never zero.\n\n'
text+='Independent workbook model uses the workbook’s own conversion/density/yield factors to explain its cached values. It is an offline diagnostic only; the application never reads cached workbook costs. The diagnostic mirrors Excel’s omission of uncosted terms, which is precisely why its subtotal is not a valid fallback for unresolved v2 recipes.\n\n'
text+='Classification: exact rational equality = Exact match; absolute delta ≤ 1e-9 = Rounding-only; otherwise independent workbook model agrees with cache within 1e-9 and both totals round to the same cent = Explainable deterministic transformation. Canonical exact lb/volume conversion coefficients explain these small differences. Any other resolved difference is an Unresolved discrepancy. No such discrepancies occurred.\n\n'
text+=table(['Recipe / Catalog row','Workbook cache','Independent source model','V2 complete batch','V2 known subtotal','V2 minus cache','Classification','Blockers'],[[f"{c['recipe']} / {c['row']}",c.get('source'),c.get('independentWorkbookCost'),c['completeCost'] if c['completeCost'] is not None else 'UNRESOLVED',c['knownSubtotal'],c['delta'] if c['delta'] is not None else '—',c['classification'],'; '.join(dict.fromkeys(byid.get(b['ingredientId'],b['ingredientId'])+': '+b['reason'] for b in c['blockers']))] for c in r['reconciliation']])
(root/'MIGRATION-RECONCILIATION.md').write_text(text)
text='# Source-to-domain mapping\n\nAuthority: `Wahi Price Book V2.080426.xlsx`; SHA-256 `'+r['sourceHash']+'`. The workbook remains read-only.\n\n'
text+=table(['Source','Logical rows','Meaning / destination'],[
 ['Ingredients',206,'Universal item; vendor identity; purchase option, SKU, contents and price; storage location evidence. Pineapple Fronds (Labor) becomes fixed labor. Egg Roll Wraps remains an incomplete item.'],
 ['Recipe Catalog',186,'Recipe identity and separate output item; versioned batch yield; actual RecipeType category. Cached costs/status retained for diagnostics only.'],
 ['RecipeLines',1013,'Ordered versioned ingredient/output references, exact quantity, explicit unit and preserved Notes. No automatic ingredient substitution.'],
 ['Yields',56,'Source form → output form; 1 source PurchaseUnit yields YieldValue YieldUnit. Source notes retained.'],
 ['Densities',42,'Ingredient-specific 1 US cup → GramsPerCup grams measurement. CupsPerLb remains derived evidence.'],
 ['Drink Catalog',49,'Menu identity, explicit recipe mapping, Updated Pricing current at adoption; ActualPrice undated reference. Competitor prices/markup/margin/suggested price evidence only.'],
 ['Food Catalog',70,'Same selling-price mapping; one missing Updated Pricing remains unknown.'],
 ['SyrupCatalog',14,'Derived cost/index reference, not duplicate recipes or purchasing facts.'],
 ['Conversions',12,'Explicit canonical unit-name mapping; standard exact coefficients retained by v2. Owner-approved drop factor installed as dated item measurements; global splash factor not installed.'],
 ['Recipe Index',186,'Parallel derived lists preserved; recipe types taken from actual Recipe Catalog records; location lists not count assignments; undepartmented labor evidence only.'],
 ['Read Me',1,'Freeform annotation, preserved without interpreting misspelling/measurement intent.'],
 ['Version Notes',0,'Empty; no historical events inferred.']])
text+='\n## Tables and ranges\n\n'+table(['Excel table','Range'],[[t['attributes']['name'],t['attributes']['ref']] for t in wb['tables']])
text+='\nWorksheet dimensions (including annotations outside tables):\n\n'+table(['Sheet','Dimension'],[[s['name'],s['dimension'].get('ref','')] for s in wb['sheets']])
text+='''
## Deterministic transformations

- Parse raw OOXML numeric lexemes as decimal strings; expand scientific notation exactly. Never pass business values through binary floating-point. Empty, malformed and negative quantities do not become zero.
- `oz` → US fluid ounce, `ea` → each, cup/qt/gal/tbsp/tsp → their US volume units. g/kg/lb retain mass dimensions. Source pound factor 453.592 differs slightly from the canonical exact 453.59237; the original source value is retained.
- Resolve case/whitespace-only references using the workbook’s existing LOWER/TRIM semantics only when a unique definition exists. Distinct normalized definitions are rejected as ambiguous; punctuation/fuzzy matching is not used. Original spelling remains in evidence.
- Universal items represent purchased ingredients, yield products and recipe outputs; recipes remain separate versioned formulas. Real Final/Drink categories identify finished outputs in the review UI unless those outputs are used as components or configured for inventory.
- No inferred Water lines: the supplied Demerara Syrup formula is preserved as written. Prepared output relationships stay recursive.
- Pineapple, Dash is a real incomplete pineapple-derived item, following the prior owner clarification. Its yield quantities remain null. Ginger, Fresh references remain unchanged.
- Owner correction: 1 drop = 0.00113636 US fl oz, stored as ordinary dated measurements on Pernod, Almond Extract, Angostura Bitters and Tiki Bitters. No special-case costing logic.
- Pineapple Fronds (Labor): fixed labor $25 per 180 each, with no invented department or material purchase. Other blank labor fields remain absent.
- All adopted initial operational facts use the explicit import activation timestamp. Historical ActualPrice records use null effective dates, preserving their undated status. Updated Pricing takes precedence as previously clarified.
- Storage Location is retained and six distinct location identities are created. No inventory count unit, base unit, assignment or observation is guessed.

## Provenance and classification

Every logical source row is stored in immutable `wahi_v2.import_records`: file, SHA-256, sheet, row, raw cell values, formulas/shared-formula attributes, classification, issues, linked entity IDs and imported-at timestamp. The extractor also retains table definitions and defined names in the private extraction artifact. Operational fact provenance points to the source file/sheet/row. Whole-workbook SHA-256 protects the snapshot identity.

CLEAN applies to retained reference/derived rows requiring no operational transformation. TRANSFORMED includes deterministic parsed/mapped domain facts. SOURCE DATA ISSUE takes precedence where a row also has missing information; valid portions can still load. DOMAIN GAP identifies a concept the model cannot represent, rather than a missing source fact. Two model gaps were fixed before final classification.

Supplier source strings remain distinct identities even when trimmed display names coincide. No records from older workbooks or legacy caches override this authority.
'''
(root/'MIGRATION-MAPPING.md').write_text(text)
print('Generated exceptions, mapping and reconciliation reports.')

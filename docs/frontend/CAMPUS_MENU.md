# Campus menu replacement

Source: the user's 11 October 2026 menu. `data/campus-menu.json` contains all 233 entries: Main 84, IT 94, MBA 55. Prices are integer paise. Supplied prices remain canteen-specific; similar dishes do not share a global price.

Main's two Pringles entries are distinguished as **Pringles (small)** at ₹55 and **Pringles (large)** at ₹110. No package weight was supplied. IT's “Panner” spelling is corrected to “Paneer”. Other supplied item names remain identifiable.

## Prices added where missing

| Canteen | Item        | Suggested price |
| ------- | ----------- | --------------- |
| Main    | Dil Puff    | ₹25             |
| Main    | Pastries    | ₹60             |
| Main    | Rasmalai    | ₹40             |
| Main    | Veg Puff    | ₹20             |
| Main    | Veg Samosa  | ₹20             |
| IT      | Aloo Masala | ₹35             |
| IT      | Dosa        | ₹30             |
| IT      | Idiyappam   | ₹35             |
| IT      | Idly        | ₹25             |
| IT      | Pongal      | ₹40             |
| IT      | Poori       | ₹40             |

These are proposed operating prices supplied under the user's instruction to fill gaps, not verified campus prices. The source flags them with `estimatedPrice`. Managers can change them through the existing pencil editor.

## Opening stock and counters

The user requested realistic starting quantities instead of zero stock. Counts are estimates, not measured kitchen inventory. Main has higher capacity; IT uses roughly 80% and MBA roughly 60% of the base counts. Chicken biryani starts at 80 in Main and 64 in IT. Other biryanis start at 70/56. Staple breads start at 100/80. Popular tea/coffee starts at 150/120/90. Popular juices and buttermilk start at 70–90 in Main, with lower counts in IT/MBA. Premium ice creams and packaged sweets start at 8–15. Tandoori chicken starts at 12 full, 20 half, 35 quarter in Main; IT starts at 10/16/28. Each item's exact opening and default quantity is in the JSON.

Managers must reconcile these opening counts with actual portions through Stock. Existing reservation protection still applies. Stock is not replenished by page refresh, restart, re-import or a daily timer. The default quantity is an editing reference; it does not automatically publish food.

Keep existing assigned counters:

- Main course: rice, biryani, curries, eggs and tandoori specials.
- Tiffin: dosa/roast variants, chapathi, parotta, batura, tiffins, bakes, snacks and sweets.
- Drinks: hot drinks, juices, milkshakes and ice creams.

Fresh breads, dosa/roast variants and prepared drinks use preparation tokens. Packaged drinks, curd, ice creams, snacks and prepared rice/curries are ready portions. Categories are browsing groups; they do not create unstaffed counters.

## Replacement procedure

1. Apply the additive `category` and `archived` item migration with `npm run db:migrate`.
2. Deploy the backend filters and archived-item checkout guard before importing. Deploy the category/search UI.
3. Preview with `npx tsx scripts/replace-menu.ts`. Apply with `npx tsx --env-file=.env.local scripts/replace-menu.ts --apply`.
4. The importer locks Main, IT and MBA using the same transaction locks as checkout. It archives old catalogue items, inserts the replacement menu and creates opening batches once. It never deletes paid-order portions, credits, reservations or pickup records.
5. Stable item and batch IDs make retries safe. Re-import restores source prices/defaults and visibility but never tops up consumed stock. Do not rerun it to replenish food or overwrite intentional manager edits.
6. Verify exact live item counts, prices, available stock, categories and preserved portion snapshots. Verify a historical pickup can still finish and an archived item cannot be bought or restocked.

The frontend offers category filters alongside readiness and name search. Switching canteens resets filters. Managers have category and item-name search in Stock. Only inner app lists scroll.

## Deployment verification

Release `ea3438a` is deployed to Render and Vercel. The public catalogue returns exactly 233 active items with the expected categories and prices. All 12 previous seed items are archived. All 77 pre-existing order-item snapshots retain their original names, prices, item IDs, counters and batches.

The opening inventory contains 233 new batches and 9,643 portions: Main 4,512, IT 3,836, MBA 1,295. Applying the importer twice leaves batch count and total unchanged; retries do not add stock. Verification fixtures are removed after tests.

Production build, TypeScript and lint passed. Three data checks and three focused database checks passed, including archived-item purchase/restock rejection, historical pickup completion, protected stock and dashboard scope. All 30 isolated frontend checks passed locally and through the public host. Three live student/serving/manager checks passed after import. The full provider payment and connected multi-counter workflow were not rerun for this menu-only release. Physical stock counts and real Android camera/GPS remain outside these checks.

The Supabase platform advisor reports existing warnings for public execute privileges on its `public.rls_auto_enable()` function and disabled leaked-password protection. This menu migration changes neither that function nor Auth settings. Menu tables remain in the existing private schema with unchanged runtime permissions.

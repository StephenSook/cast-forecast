# Crowd check: Amazon listing for each bottle

Matched on 2026-10-29 between 14:32 and 14:38 EDT, after the pre-registration ([crowd-check-preregistration.md](crowd-check-preregistration.md), commit 9c6f0e1, pushed 18:31 UTC) and before any review was fetched. No review text was read for any listing. The machine-readable copy the analysis reads is [crowd-check-asins.json](crowd-check-asins.json).

Sources: listing pages on amazon.com read with free page fetches (TinyFish, Exa) and found with Brave search; FDA labels from openFDA by the set id in `data/bottles/fda_labels.json`. No paid tool was used, so the Apify spend for this step is 0.00 USD.

## Rule (from the pre-registration)
The listing's title names the same brand and product line, and the listing shows the same zinc oxide percent, or the same product name and SPF, as the FDA label.

Two clarifications written here before any review data, because several listings passed the rule for some bottles:
- A listing whose page shows a different zinc oxide percent, or a different active ingredient set, from the label is not a match (for example a Hello Bello Kids SPF 50 lotion listing that states 10% zinc oxide and 8% titanium dioxide).
- When more than one listing passes, the tie-break, in order: same UPC as the label; shows the label's zinc oxide percent; same format as the label (lotion, liquid, stick, spray); single unit over a multipack; most ratings shown on the listing.

## Matches (8 of 8; none dropped)

| Bottle | ASIN | Listing title (start) | Route | Evidence | Ratings shown |
|---|---|---|---|---|---|
| cetaphil-sheer-mineral-face | B08HJKQP7X | Cetaphil Sheer Mineral Face Sunscreen, SPF 50, Zinc Oxide, 1.7oz | zinc percent | Ingredients: "ACTIVE INGREDIENTS: ZINC OXIDE 12% (SUNSCREEN)"; bullet "CETAPHIL SHEER MINERAL FACE LIQUID SUNSCREEN SPF 50". Label: Zinc Oxide 12%, 1.7 FL OZ. | 6,766 |
| babo-sheer-zinc | B01MXSYBWK | Babo Botanicals Sheer Zinc Mineral Sunscreen Lotion SPF30 | product name and SPF | Label name "Babo Botanicals Sheer Zinc Mineral Sunscreen SPF30". Listing Item Form: Lotion; the label's ingredients (water first, shea butter) are a lotion's. The zinc percent was not readable on the listing pages served. | 3,249 |
| supergoop-mineral-sheer-stick | B0DMWTFB6N | Mineral Sheer Stick SPF 30 by Supergoop for Unisex - 0.7 oz Sunscreen | zinc percent | Ingredients: "ACTIVE Zinc Oxide 16%". Listing UPC 816218029890 equals the label UPC 0816218029890. | 44 |
| badger-face-mineral | B0CHN9MGXX | Badger Zinc Oxide Face Sunscreen SPF 30, Organic, No White Cast, 1.7 fl oz | zinc percent | Ingredients: "ZINC OXIDE 18, 75% PURPOSE SUNSCREEN" (comma decimal). Listing UPC 634084471724 equals the label UPC 0634084471724. | 390 |
| hello-bello-mineral | B0B2BF74PC | Hello Bello Baby Sunscreen, SPF55+ UVA/UVB Mineral Lotion w Prebiotics, 3oz | zinc percent | Ingredients: "Active Ingredient, Zinc Oxide (20%)"; its 35 inactive ingredients are the label's 35. Label: Mineral Sunscreen SPF 50, Zinc Oxide 20.0%, 5oz lotion. The listing says SPF 55+, 3oz, for babies. | 1,254 |
| neutrogena-sheer-zinc | B01HOHBO7E | Neutrogena Sheer Zinc Oxide Dry-Touch Sunscreen Lotion with Broad Spectrum SPF 50 ... 3 fl. oz | product name and SPF | Label "Neutrogena Sheer Zinc Mineral Sunscreen Broad Spectrum SPF 50", 3.0 FL OZ tube. Listing item model number 086800110804 equals the label UPC 0086800110804; its inactive list is the label's in another order, minus triethoxycaprylylsilane. Zinc percent not shown on the listing. | 1,195 |
| eltamd-uv-aox-mist | B0C1LR82PG | EltaMD UV AOX Mist 100% Mineral Sunscreen Spray, SPF 40, 5 oz | zinc percent | Ingredients: "Active Ingredients: Zinc Oxide 14.0%"; its inactive list is the label's. | 808 |
| coppertone-pure-and-simple | B073H54CJH | Coppertone Pure and Simple Baby Sunscreen Lotion SPF 50, 6 FL OZ | zinc percent | Ingredients: "Active ingredient: Zinc Oxide 24.08%"; its 22 inactive ingredients are the label's 22. Label: Coppertone Pure and Simple Sunscreen SPF 50, lotion. | 4,398 |

## Candidates considered and not used
- Coppertone B07MH4TDPZ: its UPC 072140028831 equals the label's and its ingredients match, but its title as served on 2026-10-29 is "Coppertone SPORT Sunscreen Lotion SPF 50, 6 FL OZ", which names another product line, so it fails the title part of the rule. Not used, even though it is probably the exact product.
- Coppertone B07NJ6QMGZ (Pure and Simple Kids lotion, 6 fl oz, 24.08%, 540 ratings), B09P4F5HKC (Pure and Simple Baby lotion, 2 x 6 oz, 24.08%, 687 ratings), B07QCGZY9V (Pure and Simple Face lotion, 2 oz, zinc percent not shown when read, 806 ratings): pass the rule, lose the tie-break to B073H54CJH (single unit, most ratings).
- EltaMD B0FL2WBK2M (UV AOX Mist SPF 40, 5 oz, 805 ratings): passes on name and SPF, but its page did not show the zinc percent, so it loses the tie-break to B0C1LR82PG.
- Hello Bello B0B2BF8DXP (Mineral SPF 50 Sunscreen Lotion, 6 fl oz): its page could not be read, so its zinc percent is unknown; loses the tie-break. B0C1WBYX4P (Kids SPF 50 Mineral Sunscreen Lotion, 5oz): its listed ingredients are a different formula from the label's; not a match. B0F9LPXKXP (Kids Mineral Sunscreen SPF 50 Lotion, 5oz): states 10% zinc oxide and 8% titanium dioxide; not a match.
- Neutrogena B08QKQXHYC (3-pack) and B01MDOA0V4 (Sheer Zinc Face, 2 fl oz): lose the tie-break to B01HOHBO7E (same UPC as the label).
- Badger B0G246CZGJ (2-pack of the same face sunscreen): loses the tie-break to the single unit.
- Cetaphil B09RQBBMX8 and B08HJGVNY9 (Sheer Mineral Sunscreen Lotion, zinc oxide plus titanium dioxide) and B08HJM5ZN4 (stick): different products.
- Babo B00HNNQLZ0 ("Sunscreen Unscented SPF30") and B00AH8FASM ("Clear Zinc"): titles do not name the Sheer Zinc line.

## Limits specific to these matches, stated before data
- Two of the eight listings are sold for babies (Hello Bello, Coppertone), so many of their reviewers describe a child's skin. Both bottles are high in zinc (20% and 24.08%), so if baby reviewers mention cast less often, this works against a SUPPORTED result.
- The Supergoop listing shows only 44 ratings, so it may fall under the 20-analysed-review minimum and be dropped by the pre-registered rule.
- The Hello Bello listing states SPF 55+ while the label states SPF 50; the zinc percent and the full inactive list are the same.
- Two listing titles carry the seller's own "No White Cast" claim (Badger) or "Dries Clear" (EltaMD), which reviewers may repeat or argue with.

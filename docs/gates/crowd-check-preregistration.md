# Crowd check pre-registration: do bottles with more predicted whitening get more white cast complaints?

Written on 2026-10-29 at 14:29 EDT (18:29 UTC, read from the system clock), and committed and pushed before any Amazon listing was matched and before any review was fetched. The analysis code, `castforecast/crowd_check.py`, and its tests, `tests/test_crowd_check.py` (hand-written fixture reviews only), are in the same commit. The result will be published next to this file whichever way it lands, including NOT SUPPORTED and NOT TESTABLE.

## Question
Across the 8 catalogue bottles, do bottles with higher predicted whitening get a larger share of recent Amazon reviews complaining about white cast?

This is a corroboration check, not a gate. A SUPPORTED result says the ordering of the predictions agrees with what reviewers complain about; it does not check the predicted L* numbers themselves. A NOT SUPPORTED result does not show the predictions are wrong, because reviews are a noisy measure (see Known limits). Either result is reported in those words.

## Predictions tested (x)
Predicted whitening at skin L* 55, in L*, from `web/src/data/bottles.json` on main at 9e53e36 (the label model applied to each FDA label's zinc oxide percentage). The values are pinned in `PREDICTED_L55` in the code; a test checks they still equal the catalogue.

| Bottle | Zinc oxide on FDA label | Predicted whitening at L* 55 |
|---|---|---|
| cetaphil-sheer-mineral-face | 12% | 2.184193 |
| eltamd-uv-aox-mist | 14% | 2.950630 |
| babo-sheer-zinc | 16% | 3.717068 |
| supergoop-mineral-sheer-stick | 16% | 3.717068 |
| badger-face-mineral | 18.75% | 4.770919 |
| hello-bello-mineral | 20% | 5.249942 |
| neutrogena-sheer-zinc | 21.6% | 5.863092 |
| coppertone-pure-and-simple | 24.08% | 6.813474 |

## Matching rule (bottle to one Amazon US listing)
- Each bottle is matched to ONE Amazon US listing (ASIN) whose title names the same brand and product line, and whose listing shows the same zinc oxide percent, or the same product name and SPF, as the FDA label in `data/bottles/fda_labels.json`.
- If no listing can be matched with confidence, the bottle is DROPPED and reported with the reason. No bottle is matched to a different product line, size format or formula to fill a gap.
- Each match is recorded before any review is fetched, in `docs/gates/crowd-check-asins.md` (listing title, and where the percent or name match came from) and in `docs/gates/crowd-check-asins.json` (the file the code reads: `{"matched": [{"bottle", "asin", ...}], "dropped": [{"bottle", "reason"}]}`), committed and pushed before the review fetch.
- The test needs at least 6 measurable bottles, or it is declared NOT TESTABLE.

## Sample
- One run of the Apify actor `junglee/amazon-reviews-scraper` for all matched ASINs, input: `productUrls` = one `{"url": "https://www.amazon.com/dp/<ASIN>"}` per matched bottle, `maxReviews` 100, `sort` "recent", `filterByRatings` ["allStars"], `includeGdprSensitive` false. Spend cap: the whole crowd check, including any paid listing search, stays at or under 6.00 USD, enforced with `maxTotalChargeUsd` on every paid call.
- Raw rows are kept privately and never committed. Only counts, shares and the statistic are published (no review text and no reviewer data).
- Rows are assigned to the ASIN they were requested for (the ASIN in the row's `input` URL; if absent, `productOriginalAsin`, then `productAsin`). Rows that match no requested ASIN are counted and reported, not used.
- Per ASIN, in this order: rows carrying an `error` field are error records, not reviews; a repeated `reviewId` counts once; at most the first 100 rows in dataset order are kept (the order the actor returned under sort "recent"); reviews with empty text are excluded; non-English reviews are excluded. What is left is "analysed". Each count is reported.
- Text analysed is the review title and the review body joined by a newline (either may be empty; both empty means empty text).
- A bottle with fewer than 20 analysed reviews is dropped as unmeasurable and counts against the 6-bottle minimum. (This threshold is not in the original brief; it is fixed here, before data, so a share is never computed from a handful of reviews.)

## English rule
A review counts as English unless it shows evidence of another language: it is excluded if fewer than half of its letters are a to z, or if it contains more words from a fixed list of Spanish, French, Portuguese and German function words than from a fixed list of English function words. Both lists are in the code (`FOREIGN_MARKERS`, `ENGLISH_MARKERS`). A review with words from neither list (for example "Great product") counts as English.

## Lexicon
Case-insensitive, word-boundary regular expressions (whitespace between words is one or more spaces):

white cast, whitecast, white-cast, white residue, white film, white sheen, white streak(s), white tint, leaves (a|me|my skin)? white, ghostly, ghost(-like)?, ashy, ashen, gr(a|e)y cast, purple cast, chalky, pasty.

Each entry is matched separately, so one phrase can match two entries ("leaves a white cast" matches both "leaves a white" and "white cast").

## Negation
- Tokens are runs of letters and digits, joined across an inner apostrophe, after curly apostrophes are made straight and the text is lowercased ("doesn't" is one token).
- A match is NEGATED if one of these appears within the 4 tokens before the match: no, not, zero, without, never, doesn't, doesnt, didn't, didnt, does not, did not, isn't, isnt, wasn't, wasnt, free of, none, barely any, hardly any. A two-word negator must sit wholly inside the 4-token window.
- Punctuation does not end the window, and only the tokens BEFORE a match are checked. So "not greasy, leaves a white cast" counts as negated, not a complaint (the "not" sits within 4 tokens of both matches), and "white cast free" counts as a complaint. These are accepted errors of a keyword method, fixed now so they cannot be tuned after seeing data.
- "Minimal", "slight", "a little" or "some" white cast counts as PRESENCE: those words are not negators.

## Measures
- Primary, cast COMPLAINT share: analysed reviews with at least one lexicon match that is not negated, divided by analysed reviews.
- Secondary, raw MENTION share: analysed reviews with any lexicon match, negated or not, divided by analysed reviews. Reported and labelled secondary; it has no verdict.

## Statistic and verdict
- Spearman rho between predicted whitening at L* 55 and complaint share across the measurable bottles, computed as the Pearson correlation of average ranks (ties share the mean rank; the two 16% bottles tie on x).
- One-sided exact permutation p: the share of all n! permutations of the share vector (40,320 for 8 bottles) whose rho is greater than or equal to the observed rho.
- SUPPORTED if rho > 0 and p <= 0.05. Otherwise NOT SUPPORTED. If every bottle has the same share, rho is undefined and the verdict is NOT SUPPORTED. If fewer than 6 bottles are measurable, NOT TESTABLE.
- The same rho and p are reported for the mention share, labelled secondary.
- Command: `python -m castforecast.crowd_check <raw reviews json> docs/gates/crowd-check-asins.json <out json>`. The code is run unchanged. If a bug in it is found after seeing data, it is fixed in a separate commit that says so, and both results are reported.

## Known limits
- Reviewers' skin tones are unknown. The prediction is at skin L* 55; a bottle whose reviewers are mostly lighter-skinned will draw fewer cast complaints whatever its zinc.
- Formats differ (stick, mist, liquid, lotion), and format changes how much product people apply and how it spreads.
- Only up to the 100 most recent reviews per listing, so the sample is recent and small.
- Small n: at most 8 bottles, so only a strong ordering can reach p <= 0.05.
- Amazon listing variants: a listing can pool reviews across sizes, multipacks and older formulas.
- The lexicon is English and keyword-based: it misses cast described in other words, counts some unrelated uses (for example "pasty" about texture), and its negation rule makes the errors described above.
- Reviews are not a controlled measurement: expectations, price and marketing shape what people write.

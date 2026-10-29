# Crowd check results: NOT TESTABLE

Question (pre-registered in [crowd-check-preregistration.md](crowd-check-preregistration.md)): across the 8 catalogue bottles, do bottles with higher predicted whitening get a larger share of recent Amazon reviews complaining about white cast?

**Verdict: NOT TESTABLE.** 0 of the 8 bottles reached the pre-registered minimum of 20 analysed reviews, and the test needs at least 6. No rho or p-value exists, so this run says nothing either way about the predictions.

## What happened
- Order kept: the pre-registration and the analysis code were pushed at 18:31 UTC on 2026-10-29 (commit 9c6f0e1), the listing matches at 18:39 UTC (commit 7e41068, [crowd-check-asins.md](crowd-check-asins.md)), and the single review fetch started at 18:40 UTC.
- The one pre-registered run of `junglee/amazon-reviews-scraper` (all 8 ASINs, `maxReviews` 100, sort "recent", all stars, `includeGdprSensitive` false, spend cap 4.80 USD) finished SUCCEEDED in 28 seconds and returned **10 reviews in total, all for the first ASIN (Cetaphil)**. Its status message: "Here are your 10 Amazon reviews. To access more reviews in a single run, upgrade to the Starter plan." The account is on Apify's free plan, and by that message the actor stops at 10 reviews per run on it. This limit was not known when the test was pre-registered.
- Apify spend: 0.06 USD (10 review events at 0.006 USD; run stats `chargedEventCounts` result 10, `usageTotalUsd` 0.06). Listing matching used only free tools.
- `castforecast/crowd_check.py` was run unchanged (identical to commit 9c6f0e1) on the private raw file. The published [crowd-check-results.json](crowd-check-results.json) is its output, byte for byte.

## Per bottle

| Bottle | ASIN | Predicted whitening at L* 55 | Rows returned | Non-English | Analysed | Complaints (share) | Mentions (share) |
|---|---|---|---|---|---|---|---|
| cetaphil-sheer-mineral-face | B08HJKQP7X | 2.18 | 10 | 2 | 8 | 3 (0.375) | 4 (0.500) |
| eltamd-uv-aox-mist | B0C1LR82PG | 2.95 | 0 | 0 | 0 | none | none |
| babo-sheer-zinc | B01MXSYBWK | 3.72 | 0 | 0 | 0 | none | none |
| supergoop-mineral-sheer-stick | B0DMWTFB6N | 3.72 | 0 | 0 | 0 | none | none |
| badger-face-mineral | B0CHN9MGXX | 4.77 | 0 | 0 | 0 | none | none |
| hello-bello-mineral | B0B2BF74PC | 5.25 | 0 | 0 | 0 | none | none |
| neutrogena-sheer-zinc | B01HOHBO7E | 5.86 | 0 | 0 | 0 | none | none |
| coppertone-pure-and-simple | B073H54CJH | 6.81 | 0 | 0 | 0 | none | none |

Every bottle is below the 20-review minimum, so every bottle is dropped as unmeasurable. The Cetaphil numbers are reported because the code computed them; 8 reviews of one bottle carry no information about the question, and they are not a measurement of that bottle either. The two reviews excluded as non-English contained 8 and 11 Spanish, French, Portuguese or German function words and no English ones. The 10 reviews were dated 2026-10-17 to 2026-10-27, so the sort "recent" setting took effect.

## What this does and does not show
- It does not support the predictions and it does not count against them. The pre-registered sample was never collected.
- Running the test as written needs an Apify plan above free, or a different review source. Either one changes the pre-registered collection step, so it would be written down as a dated amendment, committed and pushed before any further review is fetched. The rule, lexicon, negation, statistic, listing matches and analysis code would stay as they are.
- Raw rows are private and not in this repository (no review text, no reviewer data). The actor returned reviewer id and profile link fields even with `includeGdprSensitive` false; they are only in the private raw file.

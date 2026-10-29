# Crowd check amendment 1: a second review fetch with another actor

Written on 2026-10-29 at 14:51 EDT (18:51 UTC, read from the system clock), and committed and pushed before any run 2 review is fetched. It changes only the collection step of [crowd-check-preregistration.md](crowd-check-preregistration.md).

## Why
Run 1 used the pre-registered actor `junglee/amazon-reviews-scraper` on this account's free Apify plan. It returned 10 reviews in total, all for the first ASIN; the actor's status message says the free plan stops it at 10 reviews per run. Run 1 stays recorded as NOT TESTABLE in [crowd-check-results.md](crowd-check-results.md) and its files are not changed.

## What changes
- Actor: `axesso_data/amazon-reviews-scraper`. Read on 2026-10-29 before any run: pay per event, 0.0009 USD per review on the free tier. Neither its README nor its pricing states a free-plan cap on reviews per run. It reads at most 10 review pages per ASIN ("Max value is 10 pages as this is predefined limit by Amazon"); an Amazon review page holds 10 reviews, so that is up to 100 reviews per ASIN. For an ASIN with no reviews it writes three penalty rows.
- Input: one run for all 8 ASINs in [crowd-check-asins.json](crowd-check-asins.json), one entry per ASIN: `asin`, `domainCode` "com", `sortBy` "recent", `maxPages` 10, `reviewerType` "all_reviews", `formatType` "current_format", `mediaType` "all_contents", and no star or keyword filter. This asks for up to the 100 most recent reviews per ASIN, the same sample as the pre-registration.
- Spend cap: `maxTotalChargeUsd` 1.00 USD for this run (800 reviews would cost 0.72 USD). The whole check stays under the 6.00 USD Stephen approved: run 1 cost 0.06 USD.
- Field names: this actor's rows use other field names, so `castforecast/crowd_check_axesso.py` (committed separately, with tests, before the fetch) renames them and then calls the pre-registered `castforecast/crowd_check.py`, which is unchanged: `asin` becomes the requested ASIN, `title` and `text` become the review title and body, `reviewId` is kept, and a row whose `statusCode` is not 200 or whose `statusMessage` is not "FOUND" is an error record. Rows are put in page order (page 1 first) before the per-ASIN rules run, so the 100-review cap, if it ever applies, keeps the most recent pages.
- Raw rows are kept privately as `recon/crowd_check_raw_run2_2026-10-29.json`, never committed.
- Results go in `docs/gates/crowd-check-results-run2.md` and `.json`.

## What does not change
The 8 listings, the English rule, the lexicon, the negation rule, the complaint and mention measures, the 20-review minimum per bottle, the 6-bottle minimum, Spearman rho with average ranks, the one-sided exact permutation p, the SUPPORTED rule (rho > 0 and p <= 0.05), and the known limits.

## Stopping rule
If run 2 also returns too few reviews for the test, it is published as NOT TESTABLE with the actor's own status message quoted, and no third actor is tried. If a bug is found in either module after seeing run 2 data, it is fixed in a separate commit that says so, and both results are reported.

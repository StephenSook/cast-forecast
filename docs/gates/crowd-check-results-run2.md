# Crowd check results, run 2: NOT TESTABLE

Run 2 followed [crowd-check-amendment-1.md](crowd-check-amendment-1.md), which was pushed at 18:51:38 UTC on 2026-10-29 (commit 0c8c7ce, with the input adapter in 826db18) before this run started at 18:51:51 UTC. Run 1's files ([crowd-check-results.md](crowd-check-results.md)) are unchanged.

**Verdict: NOT TESTABLE.** The actor returned no rows, so no bottle had any review, and the test needs 6 bottles with at least 20 analysed reviews each. No rho or p-value exists.

## What happened
- One run of `axesso_data/amazon-reviews-scraper` for all 8 ASINs in [crowd-check-asins.json](crowd-check-asins.json), each with sort "recent", 10 pages, all reviewers, all content, no star or keyword filter, spend cap 1.00 USD.
- The run ended SUCCEEDED after 1.9 seconds with 0 rows. Its status message field was empty. The actor's own message, from the run log: "Actor usage only allowed for paying user. Please make sure you have sufficient quota." The account is on Apify's free plan. This restriction is not stated in the actor's README or pricing as read before the run.
- Spend: the run reports 0 charged events and `usageTotalUsd` 0. The account's monthly usage rose by 0.000055 USD across the run (platform time for a 2-second container).
- The analysis was not run: `castforecast/crowd_check_axesso.py` refuses a reviews file with no rows (exit 1), as the pre-registered `castforecast/crowd_check.py` does. [crowd-check-results-run2.json](crowd-check-results-run2.json) is therefore a record of the run, not analysis output.

| Bottle | ASIN | Rows returned | Analysed |
|---|---|---|---|
| cetaphil-sheer-mineral-face | B08HJKQP7X | 0 | 0 |
| babo-sheer-zinc | B01MXSYBWK | 0 | 0 |
| supergoop-mineral-sheer-stick | B0DMWTFB6N | 0 | 0 |
| badger-face-mineral | B0CHN9MGXX | 0 | 0 |
| hello-bello-mineral | B0B2BF74PC | 0 | 0 |
| neutrogena-sheer-zinc | B01HOHBO7E | 0 | 0 |
| eltamd-uv-aox-mist | B0C1LR82PG | 0 | 0 |
| coppertone-pure-and-simple | B073H54CJH | 0 | 0 |

## Where the check stands
- Both runs are NOT TESTABLE, for the same reason: on Apify's free plan, neither actor returns the pre-registered sample (run 1: 10 reviews in total; run 2: refused, 0 rows).
- Under the amendment's stopping rule, no third actor is tried. The question stays open. Answering it needs a paid Apify plan or a review source that does not depend on one, written down as a further amendment before any fetch.
- Total Apify spend for the whole check: 0.0601 USD by the account's usage counter (run 1: 0.06 USD, run 2: 0.000055 USD).

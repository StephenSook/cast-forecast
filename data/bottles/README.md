# FDA sunscreen labels (openFDA)

`fda_labels.json` holds every openFDA drug label whose structured active substances include zinc oxide, sorted by `castforecast/label_set.py`. openFDA publishes FDA's structured product labels (the ones on DailyMed); each row keeps its label set id, so `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=<set_id>` opens the label the percent was read from. Refetch with `python analysis/bottles/fetch_labels.py` (about 90 requests, one a second; `--cache DIR` keeps the raw pages), then rebuild the site's catalogue with `python -m castforecast.label_catalogue`.

`counts` gives how many labels each rule left out; every label is counted once, under the first rule that applies. Labels left out by the scan rules are only counted. Labels left out by a category, or as a duplicate, are listed with the reason in `excluded`; kept labels have `excluded: null`.

Scan rules (is this a zinc-only sunscreen the model covers):
- `not_zinc_only`: another active ingredient is listed. The model knows zinc oxide only.
- `not_otc`: not a human over-the-counter drug.
- `not_sunscreen`: no sunscreen wording in the name, purpose, indications, display panel or active-ingredient text.
- `unreadable_percent`: the active-ingredient text has no percent, two of them, a range, or a malformed number. It is never guessed.
- `outside_model_range`: the percent is outside the 5 to 30 percent the study measured.

Categories the model cannot speak for:
- `tinted`: iron oxides in the ingredients (as label text or SPL data writes them), or "tint" in the name. The model has no tint term, and iron oxides hide cast.
- `powder`: a powder dosage form, or "powder" in the name. The model was never tested on a powder.
- `lip`: a lipstick dosage form, or "lip" in the name. The tones are skin tones.
- `render_error`: no skin tone has a render within 1.0 L* of its prediction, the bound every render keeps.

Then `duplicate`: labels from one labeler with the same display name and the same percent get the same prediction, so one is kept (the newest, or a featured one) and the others' barcodes are added to its `upcs`.

Row fields: `name` and `brand` are the label's brand name and labeler as the site shows them, without SPF numbers or claim wording (the site shows appearance only); `label_name` and `manufacturer` are as the label gives them. `featured` marks the eight bottles the site shipped first, whose ids never change. `dosage_forms` come from the openFDA NDC directory for the label's product codes. `upc` is the label's barcode when it lists exactly one; `upcs` lists all of its barcodes and its duplicates'. A barcode whose check digit fails, or that is all zeros, is not listed. A barcode two kept labels share opens neither on the site.

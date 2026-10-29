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
- `zinc_too_low`: the model predicts a negative whitening (a darkening) on one of the five tones. Below about 6.3 percent zinc the straight-line fit's intercept goes under zero; that is an artifact of the fit, not an effect, and the site never shows a negative cast.
- `render_error`: no skin tone has a render within 1.0 L* of its prediction, the bound every render keeps.

Then `duplicate`: a label is a duplicate only when it is the same product listed again: the same labeler (compared as displayed, so two spellings of one company match), the same brand name on the label, the same percent and the same dosage forms. One is kept (the newest, or a featured one) and the others' barcodes are added to its `upcs`, except a barcode another kept label lists as its own. An equal percent alone is not one product: one line's lotion, spray and stick, or its SPF 30 and SPF 50, stay separate bottles, and where two kept labels would show the same name in different forms, the form follows the name ("... Lotion", "... Spray").

Row fields: `name` and `brand` are the label's brand name and labeler as the site shows them, without "SPF" and its number, regulatory phrases or claim words (the site shows appearance only; a number a brand puts in its own name, such as "Sun Bum 50", stays); `label_name` and `manufacturer` are as the label gives them. `featured` marks the eight bottles the site shipped first, whose ids never change. `dosage_forms` come from the openFDA NDC directory for the label's product codes. `upc` is the label's barcode when it lists exactly one; `upcs` lists all of its barcodes and its duplicates'. A barcode whose check digit fails, or that is all zeros, is not listed. On the site, a barcode that more than one kept label lists opens none of them: openFDA lists barcodes per label, not per package, so the labels do not say which product the barcode is on, and a shopper is asked to search by name instead.

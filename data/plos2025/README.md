# PLOS ONE 2025 cells (derived data)

`cells.csv` is derived from the raw data of Maldonado Lopez et al., "In vivo and in vitro" whitening of zinc oxide sunscreens, PLOS ONE 2025 (doi [10.1371/journal.pone.0319891](https://doi.org/10.1371/journal.pone.0319891)), published on Mendeley Data as dataset jfpzx7hcz2, version 2, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original authors do not endorse this project.

Changes made: each volunteer x formulation cell is the mean of its replicate before/after L* pairs from `invivo.xlsx`, and one reading outside the 0 to 100 L* scale (row 178, volunteer A839, 30 percent zinc oxide) is dropped. Nothing else is altered. Rebuild it with `analysis/label_model/build_cells.py` after `analysis/gate1/fetch_data.py`.

Columns: volunteer (the study's own code), ita (the study's skin-tone group), formulation, zinc_oxide_pct, pairs (replicates averaged), L_before (mean L* before application), dL (mean L* change).

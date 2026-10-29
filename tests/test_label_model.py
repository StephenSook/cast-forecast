"""Tests for the label model (castforecast/label_model.py) against the committed study table."""

import pytest

from castforecast import label_model
from castforecast.label_model import (
    ALL_CELLS,
    LIGHTNESS_RANGE,
    ZINC_CELLS,
    ZINC_RANGE,
    held_out_mae,
    load_cells,
    predict,
)


def test_the_table_is_the_studys_65_zinc_cells():
    cells = load_cells()
    assert len(cells) == 78  # 13 volunteers x 6 formulations
    assert len(ZINC_CELLS) == 65
    assert len({c.volunteer for c in ZINC_CELLS}) == 13
    assert ZINC_RANGE == (5.0, 30.0)


def test_gate_1s_held_out_error_reproduces_from_the_committed_table():
    # docs/gates/gate1-results.md: label percent model, strict leave-one-cell-out, overall 1.61 L*.
    assert held_out_mae(ZINC_CELLS, ALL_CELLS) == pytest.approx(1.61, abs=0.005)


def test_more_zinc_whitens_more_and_darker_skin_more():
    assert label_model.C > 0
    assert predict(20.0, 55.0) > predict(10.0, 55.0)
    assert predict(20.0, 45.0) > predict(20.0, 65.0)


@pytest.mark.parametrize(
    ("zinc", "lightness"), [(3.0, 55.0), (31.0, 55.0), (20.0, 40.0), (20.0, 72.0)]
)
def test_outside_the_studys_range_is_refused_not_extrapolated(zinc, lightness):
    with pytest.raises(ValueError, match="outside the study"):
        predict(zinc, lightness)


def test_the_lightness_range_is_the_studys():
    lo, hi = LIGHTNESS_RANGE
    assert 43.0 < lo < 45.0 and 68.0 < hi < 69.0

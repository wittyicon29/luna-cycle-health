from datetime import date, timedelta
from types import SimpleNamespace

from app.services.prediction_service import cycle_lengths, get_cycle_summary


def _periods(*gaps, base=date(2025, 1, 1)):
    starts = [base]
    for gap in gaps:
        starts.append(starts[-1] + timedelta(days=gap))
    return [SimpleNamespace(start_date=s, cycle_length=None, pain_level=None, end_date=None, symptoms=None) for s in starts]


def test_summary_uses_computed_lengths_without_stored_values():
    summary = get_cycle_summary(_periods(28, 30))

    assert summary["avg_cycle_length"] == 29.0
    assert summary["min_cycle"] == 28
    assert summary["max_cycle"] == 30


def test_summary_excludes_implausible_gap():
    summary = get_cycle_summary(_periods(28, 90, 30))

    assert summary["avg_cycle_length"] == 29.0
    assert summary["max_cycle"] == 30


def test_summary_with_fewer_than_two_periods_has_no_average():
    assert get_cycle_summary(_periods())["avg_cycle_length"] is None


def test_cycle_lengths_falls_back_to_stored_values_in_range():
    rows = [
        SimpleNamespace(start_date=date(2025, 1, 1), cycle_length=None),
        SimpleNamespace(start_date=date(2025, 6, 1), cycle_length=29),   # gap too large to compute
        SimpleNamespace(start_date=date(2025, 12, 1), cycle_length=90),  # stored out of range
    ]

    assert cycle_lengths(rows) == [29]

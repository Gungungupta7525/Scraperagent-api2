#!/usr/bin/env python3
"""
Frontend experience filter behavior tests.
Replicates the exact JS logic from app.js to verify filter semantics.
Run: python -m pytest tests/test_experience_filter.py -v
"""

import re
import pytest


# ── Exact replicas of the frontend JS functions ──


def _parse_experience_years(text):
    """Exact replica of frontend _parseExperienceYears()."""
    if not text:
        return None
    t = re.sub(r"\s+", " ", text.lower()).strip()

    m = re.search(r"over\s+(\d+)\+?\s*(?:years?|yrs?)", t)
    if m:
        return {"min": int(m.group(1)), "max": 999}

    m = re.search(r"more\s+than\s+(\d+)\+?\s*(?:years?|yrs?)", t)
    if m:
        return {"min": int(m.group(1)), "max": 999}

    m = re.search(r"(\d+)\s*[-\u2013to]+\s*(\d+)\s*(?:years?|yrs?)", t)
    if m:
        return {"min": int(m.group(1)), "max": int(m.group(2))}

    m = re.search(r"(\d+)\+\s*(?:years?|yrs?)|(\d+)\s*(?:years?|yrs?)\s*\+", t)
    if m:
        yrs = int(m.group(1) or m.group(2))
        return {"min": yrs, "max": 999}

    if re.search(r"fresher|entry\s*level|intern|0\s*(?:years?|yrs?)", t):
        return {"min": 0, "max": 1}

    m = re.search(r"(\d+)\s*(?:years?|yrs?)", t)
    if m:
        return {"min": int(m.group(1)), "max": int(m.group(1))}

    return None


def _parse_filter_exp_range(filter_text):
    """Exact replica of frontend _parseFilterExpRange()."""
    t = re.sub(r"\s+", " ", filter_text.lower()).strip()

    if re.search(r"fresher|entry\s*level|intern|0\s*(?:years?|yrs?)", t):
        return {"min": 0, "max": 2}

    m = re.match(r"^(\d+)\+\s*(?:years?|yrs?)?$", t)
    if m:
        return {"min": int(m.group(1)), "max": 999}

    m = re.search(r"(\d+)\s*[-\u2013to]+\s*(\d+)\s*(?:years?|yrs?)?", t)
    if m:
        return {"min": int(m.group(1)), "max": int(m.group(2))}

    m = re.search(r"(\d+)\s*(?:years?|yrs?)", t)
    if m:
        return {"min": int(m.group(1)), "max": 999}

    m = re.search(r"(\d+)", t)
    if m:
        return {"min": int(m.group(1)), "max": 999}

    return None


def _experience_matches_filter(candidate_exp, filter_text):
    """Exact replica of frontend _experienceMatchesFilter()."""
    if not filter_text:
        return True
    cand_range = _parse_experience_years(candidate_exp)
    filter_range = _parse_filter_exp_range(filter_text)
    if not filter_range:
        return True
    if not cand_range:
        return False
    return cand_range["max"] >= filter_range["min"] and cand_range["min"] <= filter_range["max"]


# ── _parseExperienceYears tests ──


class TestParseExperienceYears:
    def test_null(self):
        assert _parse_experience_years(None) is None

    def test_empty(self):
        assert _parse_experience_years("") is None

    def test_plain_years(self):
        assert _parse_experience_years("5 years") == {"min": 5, "max": 5}

    def test_plus_years(self):
        assert _parse_experience_years("5+ years") == {"min": 5, "max": 999}

    def test_plus_no_space(self):
        assert _parse_experience_years("5+years") == {"min": 5, "max": 999}

    def test_years_trailing_plus(self):
        assert _parse_experience_years("5 years+") == {"min": 5, "max": 999}

    def test_years_of_experience(self):
        assert _parse_experience_years("7 years of experience") == {"min": 7, "max": 7}

    def test_yrs(self):
        assert _parse_experience_years("3 yrs experience") == {"min": 3, "max": 3}

    def test_over_years(self):
        assert _parse_experience_years("over 10 years") == {"min": 10, "max": 999}

    def test_over_plus_years(self):
        assert _parse_experience_years("over 10+ years") == {"min": 10, "max": 999}

    def test_more_than_years(self):
        assert _parse_experience_years("more than 6 years") == {"min": 6, "max": 999}

    def test_range_dash(self):
        assert _parse_experience_years("5-8 years") == {"min": 5, "max": 8}

    def test_range_en_dash(self):
        assert _parse_experience_years("3\u20137 years") == {"min": 3, "max": 7}

    def test_range_to(self):
        assert _parse_experience_years("10 to 15 years") == {"min": 10, "max": 15}

    def test_fresher(self):
        assert _parse_experience_years("fresher") == {"min": 0, "max": 1}

    def test_entry_level(self):
        assert _parse_experience_years("entry level") == {"min": 0, "max": 1}

    def test_intern(self):
        assert _parse_experience_years("intern") == {"min": 0, "max": 1}

    def test_no_match_python3(self):
        assert _parse_experience_years("Python 3 developer") is None

    def test_no_match_aws2024(self):
        assert _parse_experience_years("AWS 2024 certified") is None

    def test_no_match_plain_title(self):
        assert _parse_experience_years("Senior Machine Learning Engineer | Python | PyTorch") is None

    def test_backend_format_plus(self):
        assert _parse_experience_years("5+ years") == {"min": 5, "max": 999}

    def test_backend_format_range(self):
        assert _parse_experience_years("5-8 years") == {"min": 5, "max": 8}


# ── _parseFilterExpRange tests ──


class TestParseFilterExpRange:
    def test_at_least(self):
        assert _parse_filter_exp_range("5+ years") == {"min": 5, "max": 999}

    def test_years_as_at_least(self):
        assert _parse_filter_exp_range("5 years") == {"min": 5, "max": 999}

    def test_bare_number(self):
        assert _parse_filter_exp_range("5") == {"min": 5, "max": 999}

    def test_bare_plus(self):
        assert _parse_filter_exp_range("5+") == {"min": 5, "max": 999}

    def test_range(self):
        assert _parse_filter_exp_range("2-5 years") == {"min": 2, "max": 5}

    def test_range_to(self):
        assert _parse_filter_exp_range("2 to 5") == {"min": 2, "max": 5}

    def test_plus_yrs(self):
        assert _parse_filter_exp_range("10+ yrs") == {"min": 10, "max": 999}


# ── _experienceMatchesFilter tests ──


class TestExperienceMatchesFilter:
    def test_no_filter_null_exp(self):
        assert _experience_matches_filter(None, "") is True

    def test_no_filter_known_exp(self):
        assert _experience_matches_filter("5 years", "") is True

    def test_no_filter_null_filter(self):
        assert _experience_matches_filter(None, None) is True

    def test_filter_at_least_pass(self):
        assert _experience_matches_filter("7 years", "5+ years") is True

    def test_filter_at_least_exact(self):
        assert _experience_matches_filter("5 years", "5+ years") is True

    def test_filter_at_least_fail(self):
        assert _experience_matches_filter("3 years", "5+ years") is False

    def test_filter_range_pass(self):
        assert _experience_matches_filter("4 years", "2-5 years") is True

    def test_filter_range_exact(self):
        assert _experience_matches_filter("5 years", "2-5 years") is True

    def test_filter_range_fail(self):
        assert _experience_matches_filter("7 years", "2-5 years") is False

    def test_filter_unknown_hide(self):
        assert _experience_matches_filter(None, "5+ years") is False

    def test_filter_unknown_range_hide(self):
        assert _experience_matches_filter(None, "2-5 years") is False

    def test_filter_unknown_exact_hide(self):
        assert _experience_matches_filter(None, "3 years") is False

    def test_backend_plus_format_pass(self):
        assert _experience_matches_filter("5+ years", "5+ years") is True

    def test_backend_plus_format_large(self):
        assert _experience_matches_filter("10+ years", "5+ years") is True

    def test_backend_plus_format_fail(self):
        # "3+ years" = at least 3, could be 5+, so overlaps with "5+ years"
        assert _experience_matches_filter("3+ years", "5+ years") is True

    def test_backend_range_format_pass(self):
        assert _experience_matches_filter("5-8 years", "5+ years") is True

    def test_backend_range_format_overlap(self):
        assert _experience_matches_filter("5-8 years", "2-5 years") is True

    def test_backend_range_format_fail(self):
        assert _experience_matches_filter("5-8 years", "10+ years") is False

    def test_bare_number_pass(self):
        assert _experience_matches_filter("7 years", "5") is True

    def test_bare_number_exact(self):
        assert _experience_matches_filter("5 years", "5") is True

    def test_bare_number_fail(self):
        assert _experience_matches_filter("3 years", "5") is False

    def test_bare_number_unknown(self):
        assert _experience_matches_filter(None, "5") is False

    def test_bare_plus_pass(self):
        assert _experience_matches_filter("7 years", "5+") is True

    def test_years_as_at_least_pass(self):
        assert _experience_matches_filter("7 years", "5 years") is True

    def test_years_as_at_least_exact(self):
        assert _experience_matches_filter("5 years", "5 years") is True

    def test_years_as_at_least_fail(self):
        assert _experience_matches_filter("3 years", "5 years") is False

    def test_range_to_pass(self):
        assert _experience_matches_filter("4 years", "2 to 5") is True

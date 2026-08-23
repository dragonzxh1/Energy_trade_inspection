"""Persist editor changes as a reproducible diff and quality feedback sample."""

from __future__ import annotations

import difflib
from typing import Iterable


ISSUE_TYPES={"wrong_fact","wrong_number","wrong_causality","weak_relevance","too_generic","too_repetitive",
             "missing_signal","missing_counter_signal","wrong_source","wrong_date","wrong_unit","style_issue"}


def build_feedback_diff(original: str, edited: str, issue_types: Iterable[str]) -> dict:
    issues=sorted(set(issue_types))
    unknown=set(issues)-ISSUE_TYPES
    if unknown: raise ValueError(f"unknown feedback issue types: {sorted(unknown)}")
    lines=list(difflib.unified_diff(original.splitlines(),edited.splitlines(),fromfile="model",tofile="edited",lineterm=""))
    added=sum(line.startswith("+") and not line.startswith("+++") for line in lines)
    deleted=sum(line.startswith("-") and not line.startswith("---") for line in lines)
    return {"unified_diff":"\n".join(lines)+("\n" if lines else ""),"issue_types":issues,"added_lines":added,"deleted_lines":deleted}

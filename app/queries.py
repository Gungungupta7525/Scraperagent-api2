"""Template-based query generation — multiple complementary queries per source."""

from __future__ import annotations

import re
from typing import List

from .heuristics import _extract_roles, _extract_skills, _extract_seniority
from .sources import SOURCE_TEMPLATES, CATEGORY_SOURCES, CATEGORY_KEYWORDS, MAX_SOURCES_PER_REQUEST

_STOPWORDS = {
    "a", "an", "the", "and", "or", "with", "for", "in", "on", "of", "to", "at", "by", "from",
    "is", "are", "be", "as", "you", "your", "will", "we", "our", "this", "that", "what", "who",
    "using", "used", "based", "someone", "somebody",
}


def extract_keywords(text: str) -> list:
    words = re.findall(r"[a-z][a-z0-9+#.-]{1,}", text.lower())
    return list(dict.fromkeys(w for w in words if len(w) > 2 and w not in _STOPWORDS))[:12]


def _query_terms(job_description: str) -> str:
    terms = extract_keywords(job_description)
    if terms:
        return " ".join(terms[:10])
    return re.sub(r"\s+", " ", job_description).strip()[:150]


def _build_multi_queries(job_description: str, source: str) -> list[str]:
    """Build 2-4 complementary queries per source to maximise discovery."""
    template = SOURCE_TEMPLATES.get(source, "site:{source} {{terms}}")
    terms = _query_terms(job_description)
    queries = []

    primary = template.format(terms=terms)
    queries.append(primary)

    roles = _extract_roles(job_description)
    skills = _extract_skills(job_description)
    seniority = _extract_seniority(job_description)

    if roles:
        role_q = template.format(terms=" ".join(roles[:3]))
        if role_q != primary:
            queries.append(role_q)

    if skills:
        skill_terms = " ".join(skills[:4])
        skill_q = template.format(terms=skill_terms)
        if skill_q not in queries:
            queries.append(skill_q)

    if seniority and seniority not in ("mid",) and roles:
        senior_q = template.format(terms=f"{seniority} {' '.join(roles[:2])}")
        if senior_q not in queries:
            queries.append(senior_q)

    return queries


def build_default_queries(job_description: str, sources: list) -> list:
    """Build multiple queries per source for broader discovery."""
    out = []
    for s in sources:
        for q in _build_multi_queries(job_description, s):
            out.append({"source": s, "query": q})
    return out


def _categories_for(job_description: str) -> List[str]:
    text = job_description.lower()
    return [category for category, keywords in CATEGORY_KEYWORDS.items() if any(k in text for k in keywords)]


def resolve_sources(job_description: str, requested: List[str] | None = None) -> List[str]:
    if requested:
        allowed = [s for s in requested if s in SOURCE_TEMPLATES]
        return allowed or ["github", "linkedin", "wellfound"]
    categories = _categories_for(job_description) or ["general"]
    if "general" not in categories:
        categories = ["general"] + categories
    ordered = []
    for category in categories:
        for source in CATEGORY_SOURCES[category]:
            if source not in ordered:
                ordered.append(source)
    return ordered[:MAX_SOURCES_PER_REQUEST]

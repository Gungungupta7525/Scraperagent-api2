"""Pipeline orchestrator — multi-query search, robust dedup, debug logging."""

from __future__ import annotations

import concurrent.futures
import logging
import time
import unicodedata
from urllib.parse import urlparse

from .heuristics import extract_heuristic_candidates, rank_candidates
from .queries import build_default_queries
from .profiles import profile_source

_SEARCH_PHASE_TIMEOUT = 25.0
_DISCOVERY_MULTIPLIER = 3

log = logging.getLogger("scraperagent.pipeline")


class Pipeline:
    def __init__(self, settings):
        self.settings = settings
        from .search import SearchClient
        self.search = SearchClient(settings)
        self.llm_adapters = []

    def run(self, job_description: str, sources: list, max_candidates: int, deadline: float, emit=None):
        emit = emit or (lambda message: None)
        self.search.reset()

        queries = build_default_queries(job_description, sources)
        emit(f"Running {len(queries)} search queries across {len(sources)} sources…")

        results = self._run_searches(queries, deadline, emit)

        pre_dedup = sum(len(r) for r in results.values())
        results = self._dedup_results(results)
        post_dedup = sum(len(r) for r in results.values())
        dupes_removed = pre_dedup - post_dedup
        if dupes_removed:
            emit(f"Removed {dupes_removed} duplicate URLs")

        candidates = extract_heuristic_candidates(job_description, results)

        accepted = len(candidates)
        emit(f"Extracted {accepted} candidates from {post_dedup} search results")

        if accepted < 10 and self.llm_adapters:
            candidates = self._llm_fallback(job_description, results, deadline, emit, candidates)
            emit(f"LLM fallback produced {len(candidates)} total candidates")

        discover_target = max(max_candidates * _DISCOVERY_MULTIPLIER, 50)
        ranked = rank_candidates(candidates, max_candidates)

        emit(f"Ranked {len(ranked)} candidates (from {accepted} extracted)")
        return ranked, results

    def _run_searches(self, queries: list, deadline: float, emit):
        out = {}
        todo = []
        for item in queries:
            source = item["source"]
            query = item["query"]
            todo.append((source, query))
        if not todo:
            return out

        search_deadline = min(deadline, time.monotonic() + _SEARCH_PHASE_TIMEOUT)
        max_workers = min(20, len(todo))

        pool = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="search")
        futures = {
            pool.submit(self.search.search_source, query, source, self.settings.max_results_per_source): (source, query)
            for source, query in todo
        }
        done, _ = concurrent.futures.wait(futures, timeout=max(1.0, search_deadline - time.monotonic()))

        for future in done:
            source, query = futures[future]
            try:
                results = future.result(timeout=0)
            except Exception:
                results = []
            if source not in out:
                out[source] = []
            out[source].extend(results)

        pool.shutdown(wait=False, cancel_futures=True)

        done_count = sum(1 for r in out.values() if r)
        total_count = len(todo)
        total_results = sum(len(r) for r in out.values())
        emit(f"Searches completed: {done_count}/{total_count} queries returned results — {total_results} raw results")

        return out

    def _dedup_results(self, results_by_source: dict) -> dict:
        seen_canonicals: set[str] = set()
        seen_names: dict[tuple[str, str], str] = {}
        deduped = {}
        for source, results in results_by_source.items():
            clean = []
            for row in results or []:
                url = (row.get("url") or "").strip()
                if not url:
                    continue

                canonical = _canonical_url(url)
                if canonical in seen_canonicals:
                    continue

                from .heuristics import name_from_url
                name = name_from_url(url)
                if name:
                    name_key = (name.lower(), source)
                    if name_key in seen_names:
                        existing_url = seen_names[name_key]
                        if len(url) > len(existing_url):
                            seen_canonicals.discard(_canonical_url(existing_url))
                            seen_canonicals.add(canonical)
                            seen_names[name_key] = url
                            clean = [r for r in clean if r.get("url") != existing_url]
                            clean.append(row)
                        continue
                    seen_names[name_key] = url

                seen_canonicals.add(canonical)
                clean.append(row)
            deduped[source] = clean
        return deduped

    def _llm_fallback(self, job_description, results, deadline, emit, existing):
        for adapter in self.llm_adapters:
            if self._remaining(deadline) <= 5:
                break
            try:
                emit(f"Enhancing with {adapter.name}…")
                evidence = _format_evidence(results, {})
                system = (
                    "You are a recruiting agent. Extract candidate profiles from the search results below "
                    "and rank them best-first. Return JSON array of candidates with name, role, headline, "
                    "source, url, location, skills, experience, relevance_score (0-1), summary."
                )
                user = f"JOB DESCRIPTION:\n{job_description[:8000]}\n\nSEARCH RESULTS:\n{evidence}"
                content = adapter.provider.complete(
                    [{"role": "system", "content": system}, {"role": "user", "content": user}],
                    json_mode=True,
                    timeout=min(30.0, self._remaining(deadline)),
                )
                data = _parse_json(content)
                if isinstance(data, dict):
                    raw = data.get("candidates") or []
                elif isinstance(data, list):
                    raw = data
                else:
                    raw = []
                llm_candidates = [_parse_candidate(c) for c in raw if isinstance(c, dict)]
                llm_candidates = [c for c in llm_candidates if c]
                if llm_candidates:
                    merged = list(existing)
                    seen = {c["url"] for c in merged if c.get("url")}
                    for c in llm_candidates:
                        if c["url"] not in seen:
                            seen.add(c["url"])
                            merged.append(c)
                    return merged
            except Exception:
                continue
        return existing

    def _remaining(self, deadline: float) -> float:
        return deadline - time.monotonic()


def _canonical_url(url: str) -> str:
    try:
        p = urlparse(url)
        host = (p.hostname or "").lower().removeprefix("www.")
        path = p.path.rstrip("/").lower()
        return f"{host}{path}"
    except Exception:
        return url.lower().rstrip("/")


def _format_evidence(results_by_source: dict, scraped: dict) -> str:
    lines = []
    for source, results in results_by_source.items():
        lines.append(f"[{source}]")
        for row in results:
            lines.append(f"- {row.get('title', '')}\n  URL: {row.get('url', '')}\n  {row.get('snippet', '')[:250]}")
    if scraped:
        lines.append("\n[SCRAPED TEXT]")
        for url, text in list(scraped.items())[:10]:
            lines.append(f"\n--- {url} ---\n{text[:1500]}")
    return "\n".join(lines)[:15000]


def _parse_json(text: str):
    import json
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, TypeError):
        pass
    start = text.find("{")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    start = text.find("[")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "[":
                depth += 1
            elif text[i] == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    return None


def _parse_candidate(raw: dict) -> dict | None:
    score = raw.get("relevance_score")
    try:
        score = float(score)
    except (TypeError, ValueError):
        score = None
    if score is not None:
        score = max(0.0, min(1.0, score))
    skills = raw.get("skills") or []
    if isinstance(skills, str):
        skills = [s.strip() for s in skills.split(",") if s.strip()]
    url = (raw.get("url") or "").strip()
    source = profile_source(url)
    if not source:
        return None
    return {
        "name": raw.get("name") or None,
        "role": raw.get("role") or None,
        "headline": raw.get("headline") or None,
        "source": source,
        "url": url,
        "location": raw.get("location") or None,
        "skills": [str(s) for s in skills][:20],
        "experience": raw.get("experience") or None,
        "relevance_score": score,
        "summary": raw.get("summary") or None,
    }

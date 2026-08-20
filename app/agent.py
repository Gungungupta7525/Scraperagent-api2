"""Agent orchestrator — thin wrapper around Pipeline."""

from __future__ import annotations

import copy
import json
import logging
import time

from .config import Settings
from .pipeline import Pipeline, SearchCache
from .queries import resolve_sources

log = logging.getLogger("scraperagent.agent")

_cache: SearchCache | None = None


def _init_cache(settings: Settings) -> SearchCache:
    """Create the Redis-backed cache. Called once at startup."""
    global _cache
    if _cache is not None:
        return _cache
    redis_client = None
    if settings.redis_url and settings.redis_token:
        try:
            from upstash_redis import Redis
            redis_client = Redis(url=settings.redis_url, token=settings.redis_token)
            log.info("[REDIS] Connected to Upstash Redis")
        except Exception as exc:
            log.warning("[REDIS] Connection failed: %s — caching disabled", exc)
    _cache = SearchCache(redis_client=redis_client, ttl_seconds=settings.cache_ttl_seconds)
    return _cache


def _get_cache() -> SearchCache:
    """Get the shared cache instance."""
    global _cache
    if _cache is None:
        _cache = SearchCache(redis_client=None)
    return _cache


class UpstreamError(Exception):
    """Raised when no LLM provider could be reached at all (upstream failure -> 503)."""


class LLMAdapter:
    def __init__(self, name: str, provider, tool_capable: bool = False):
        self.name = name
        self.provider = provider
        self.tool_capable = tool_capable


def build_providers(settings: Settings):
    adapters = []
    if settings.groq_api_key:
        from .llm import GeminiProvider, GroqProvider
        primary = GroqProvider(settings.groq_api_key, settings.groq_model)
        adapters.append(LLMAdapter("groq-primary", primary, tool_capable=False))
        if settings.gemini_api_key:
            adapters.append(LLMAdapter("gemini-flash", GeminiProvider(settings.gemini_api_key, settings.gemini_model)))
        adapters.append(LLMAdapter("groq-small", GroqProvider(settings.groq_api_key, settings.groq_fallback_model)))
    elif settings.gemini_api_key:
        from .llm import GeminiProvider
        adapters.append(LLMAdapter("gemini-flash", GeminiProvider(settings.gemini_api_key, settings.gemini_model)))
    return adapters


class ScrapingAgent:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.pipeline = Pipeline(settings)
        self.pipeline.llm_adapters = build_providers(settings)

    def run(self, job_description: str, sources=None, max_candidates: int = 10, on_status=None):
        emit = on_status or (lambda message: None)
        deadline = time.monotonic() + self.settings.request_timeout
        emit("Connected to the backend")
        allowed = resolve_sources(job_description, sources)

        cache = _get_cache()
        cache_key = SearchCache.make_key(job_description, allowed, max_candidates)
        cached = cache.get(cache_key)
        if cached is not None:
            log.info("[CACHE] HIT key=%s", cache_key[:12])
            emit("Returning cached results")
            return cached

        log.info("[CACHE] MISS key=%s", cache_key[:12])
        emit("Analyzing the job description…")

        try:
            candidates, results = self.pipeline.run(job_description, allowed, max_candidates, deadline, emit)
        except Exception as exc:
            raise UpstreamError(f"upstream failure: {exc}") from exc

        if not candidates:
            raise UpstreamError("no candidates found — try rephrasing the job description")

        emit("Ranking best matches…")
        statuses = [
            {"source": s, "status": st["status"], "error": st.get("error"), "candidates_found": st.get("candidates_found", 0)}
            for s, st in self.pipeline.search.status.items()
        ]
        sources_used = [s for s, st in self.pipeline.search.status.items() if st["status"] != "failed"]
        result = {
            "job_description": job_description,
            "candidates": candidates,
            "sources_status": statuses,
            "sources_used": sources_used,
            "partial": time.monotonic() >= deadline,
        }

        cache.put(cache_key, result)
        return result

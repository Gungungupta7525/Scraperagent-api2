"""Tests for backend search cache."""

import time
from unittest.mock import MagicMock, patch

from app.pipeline import SearchCache
from app.config import Settings


# ── Test 1: Key generation ──


class TestCacheKey:
    def test_same_inputs_same_key(self):
        k1 = SearchCache.make_key("Senior Python Dev", ["github", "linkedin"], 20)
        k2 = SearchCache.make_key("Senior Python Dev", ["github", "linkedin"], 20)
        assert k1 == k2

    def test_whitespace_normalized(self):
        k1 = SearchCache.make_key("Senior Python Dev", ["github"], 20)
        k2 = SearchCache.make_key("  Senior   Python   Dev  ", ["github"], 20)
        assert k1 == k2

    def test_case_insensitive(self):
        k1 = SearchCache.make_key("Senior Python Dev", ["github"], 20)
        k2 = SearchCache.make_key("senior python dev", ["github"], 20)
        assert k1 == k2

    def test_different_jd_different_key(self):
        k1 = SearchCache.make_key("Python Dev", ["github"], 20)
        k2 = SearchCache.make_key("Java Dev", ["github"], 20)
        assert k1 != k2

    def test_different_sources_different_key(self):
        k1 = SearchCache.make_key("Python Dev", ["github"], 20)
        k2 = SearchCache.make_key("Python Dev", ["linkedin"], 20)
        assert k1 != k2

    def test_source_order_independent(self):
        k1 = SearchCache.make_key("Python Dev", ["github", "linkedin"], 20)
        k2 = SearchCache.make_key("Python Dev", ["linkedin", "github"], 20)
        assert k1 == k2

    def test_different_max_candidates_different_key(self):
        k1 = SearchCache.make_key("Python Dev", ["github"], 20)
        k2 = SearchCache.make_key("Python Dev", ["github"], 50)
        assert k1 != k2


# ── Test 2: Basic get/put ──


class TestCacheBasic:
    def test_miss_on_empty(self):
        c = SearchCache(ttl_seconds=60, max_entries=10)
        assert c.get("nonexistent") is None

    def test_hit_after_put(self):
        c = SearchCache(ttl_seconds=60, max_entries=10)
        result = {"candidates": [{"name": "Alice"}]}
        c.put("key1", result)
        hit = c.get("key1")
        assert hit is not None
        assert hit["candidates"][0]["name"] == "Alice"

    def test_returns_deep_copy(self):
        c = SearchCache(ttl_seconds=60, max_entries=10)
        result = {"candidates": [{"name": "Alice"}]}
        c.put("key1", result)
        hit = c.get("key1")
        hit["candidates"][0]["name"] = "Bob"
        hit2 = c.get("key1")
        assert hit2["candidates"][0]["name"] == "Alice"


# ── Test 3: TTL expiry ──


class TestCacheExpiry:
    def test_expired_entry_is_miss(self):
        c = SearchCache(ttl_seconds=0.01, max_entries=10)
        c.put("key1", {"data": "test"})
        time.sleep(0.05)
        assert c.get("key1") is None


# ── Test 4: Max entries / LRU eviction ──


class TestCacheEviction:
    def test_evicts_oldest(self):
        c = SearchCache(ttl_seconds=60, max_entries=3)
        c.put("a", {"n": "a"})
        c.put("b", {"n": "b"})
        c.put("c", {"n": "c"})
        c.put("d", {"n": "d"})
        assert c.get("a") is None
        assert c.get("b") is not None
        assert c.get("c") is not None
        assert c.get("d") is not None

    def test_get_refreshes_lru_order(self):
        c = SearchCache(ttl_seconds=60, max_entries=3)
        c.put("a", {"n": "a"})
        c.put("b", {"n": "b"})
        c.put("c", {"n": "c"})
        c.get("a")
        c.put("d", {"n": "d"})
        assert c.get("a") is not None
        assert c.get("b") is None


# ── Test 5: Cache failure resilience ──


class TestCacheFailure:
    def test_put_error_does_not_crash(self):
        c = SearchCache(ttl_seconds=60, max_entries=10)
        with patch.object(c, "_lock") as mock_lock:
            mock_lock.__enter__ = MagicMock(side_effect=Exception("lock broken"))
            mock_lock.__exit__ = MagicMock(return_value=False)
            c.put("key1", {"data": "test"})
        assert c.get("key1") is None

    def test_get_error_does_not_crash(self):
        c = SearchCache(ttl_seconds=60, max_entries=10)
        c.put("key1", {"data": "test"})
        with patch.object(c, "_lock") as mock_lock:
            mock_lock.__enter__ = MagicMock(side_effect=Exception("lock broken"))
            mock_lock.__exit__ = MagicMock(return_value=False)
            result = c.get("key1")
        assert result is None


# ── Test 6: Pipeline integration ──


class TestCacheIntegration:
    def _make_agent(self, ttl=60, max_entries=50):
        settings = Settings(env={
            "GROQ_API_KEY": "",
            "GEMINI_API_KEY": "",
            "TAVILY_API_KEY": "fake",
            "CACHE_TTL_SECONDS": str(ttl),
            "CACHE_MAX_ENTRIES": str(max_entries),
        })
        from app.agent import ScrapingAgent
        return ScrapingAgent(settings)

    @patch("app.agent.Pipeline")
    def test_first_search_stores_in_cache(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent()
        agent.pipeline = mock_pipeline
        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert len(result["candidates"]) == 1
        assert mock_pipeline.run.call_count == 1

    @patch("app.agent.Pipeline")
    def test_identical_search_returns_cached(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent()
        agent.pipeline = mock_pipeline
        r1 = agent.run("Python developer", sources=["github"], max_candidates=10)
        r2 = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert mock_pipeline.run.call_count == 1
        assert r1["candidates"][0]["name"] == r2["candidates"][0]["name"]

    @patch("app.agent.Pipeline")
    def test_different_jd_calls_pipeline(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent()
        agent.pipeline = mock_pipeline
        agent.run("Python developer", sources=["github"], max_candidates=10)
        agent.run("Java developer", sources=["github"], max_candidates=10)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_max_candidates_difference_separate_entries(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent()
        agent.pipeline = mock_pipeline
        agent.run("Python developer", sources=["github"], max_candidates=20)
        agent.run("Python developer", sources=["github"], max_candidates=50)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_expiry_causes_new_search(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent(ttl=0.01)
        agent.pipeline = mock_pipeline
        agent.run("Python developer", sources=["github"], max_candidates=10)
        time.sleep(0.05)
        agent.run("Python developer", sources=["github"], max_candidates=10)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_cache_hit_skips_pipeline(self, MockPipeline):
        mock_pipeline = MagicMock()
        MockPipeline.return_value = mock_pipeline
        mock_pipeline.llm_adapters = []
        mock_pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        mock_pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}

        agent = self._make_agent()
        agent.pipeline = mock_pipeline
        agent.run("Python developer", sources=["github"], max_candidates=10)
        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        mock_pipeline.run.assert_called_once()
        assert result["candidates"][0]["name"] == "Alice"

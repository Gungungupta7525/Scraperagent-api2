"""Tests for backend search cache (Redis-backed)."""

import json
import time
from unittest.mock import MagicMock, patch

from app.pipeline import SearchCache
from app.config import Settings


def _mock_redis(store=None):
    """Create a mock Redis client backed by a plain dict."""
    store = store if store is not None else {}

    def _get(key):
        return store.get(key)

    def _set(key, value, ex=None):
        store[key] = value

    client = MagicMock()
    client.get.side_effect = _get
    client.set.side_effect = _set
    return client, store


def _reset_cache():
    """Reset the module-level _cache singleton in agent.py."""
    import app.agent as agent_mod
    agent_mod._cache = None


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


# ── Test 2: Basic get/put with Redis ──


class TestCacheBasic:
    def test_miss_on_empty(self):
        client, _ = _mock_redis()
        c = SearchCache(redis_client=client, ttl_seconds=60)
        assert c.get("nonexistent") is None

    def test_hit_after_put(self):
        client, _ = _mock_redis()
        c = SearchCache(redis_client=client, ttl_seconds=60)
        result = {"candidates": [{"name": "Alice"}]}
        c.put("key1", result)
        hit = c.get("key1")
        assert hit is not None
        assert hit["candidates"][0]["name"] == "Alice"

    def test_stores_json(self):
        client, store = _mock_redis()
        c = SearchCache(redis_client=client, ttl_seconds=60)
        c.put("key1", {"data": "test"})
        raw = store["scraperagent:cache:key1"]
        assert isinstance(raw, str)
        assert json.loads(raw) == {"data": "test"}


# ── Test 3: Disabled cache (no Redis) ──


class TestCacheDisabled:
    def test_disabled_returns_none(self):
        c = SearchCache(redis_client=None, ttl_seconds=60)
        assert c.get("key1") is None

    def test_disabled_put_does_nothing(self):
        c = SearchCache(redis_client=None, ttl_seconds=60)
        c.put("key1", {"data": "test"})
        assert c.get("key1") is None


# ── Test 4: Redis failure resilience ──


class TestCacheFailure:
    def test_get_error_returns_none(self):
        client = MagicMock()
        client.get.side_effect = Exception("connection lost")
        c = SearchCache(redis_client=client, ttl_seconds=60)
        assert c.get("key1") is None

    def test_put_error_does_not_crash(self):
        client = MagicMock()
        client.set.side_effect = Exception("connection lost")
        c = SearchCache(redis_client=client, ttl_seconds=60)
        c.put("key1", {"data": "test"})
        assert c.get("key1") is None


# ── Test 5: TTL ──


class TestCacheTTL:
    def test_uses_redis_ex_parameter(self):
        client, store = _mock_redis()
        c = SearchCache(redis_client=client, ttl_seconds=300)
        c.put("key1", {"data": "test"})
        client.set.assert_called_once_with(
            "scraperagent:cache:key1",
            json.dumps({"data": "test"}),
            ex=300,
        )


# ── Test 6: Cross-instance sharing ──


class TestCacheSharing:
    def test_separate_instances_share_redis(self):
        store = {}
        client1, _ = _mock_redis(store)
        client2, _ = _mock_redis(store)

        c1 = SearchCache(redis_client=client1, ttl_seconds=60)
        c2 = SearchCache(redis_client=client2, ttl_seconds=60)

        c1.put("key1", {"candidates": [{"name": "Alice"}]})
        hit = c2.get("key1")
        assert hit is not None
        assert hit["candidates"][0]["name"] == "Alice"


# ── Test 7: ScrapingAgent integration ──


class TestCacheIntegration:
    def _make_settings(self, ttl=60):
        return Settings(env={
            "GROQ_API_KEY": "",
            "GEMINI_API_KEY": "",
            "TAVILY_API_KEY": "fake",
            "CACHE_TTL_SECONDS": str(ttl),
        })

    def _setup_agent_with_mock(self, settings, mock_pipeline, store=None):
        """Create a ScrapingAgent with a mocked pipeline and Redis cache."""
        _reset_cache()
        store = store if store is not None else {}
        client, store_ref = _mock_redis(store)
        import app.agent as agent_mod
        agent_mod._cache = SearchCache(redis_client=client, ttl_seconds=settings.cache_ttl_seconds)

        from app.agent import ScrapingAgent
        agent = ScrapingAgent(settings)
        agent.pipeline = mock_pipeline
        return agent, store_ref

    def _mock_pipeline(self):
        pipeline = MagicMock()
        pipeline.llm_adapters = []
        pipeline.run.return_value = (
            [{"name": "Alice", "url": "https://github.com/alice", "relevance_score": 0.9}],
            {},
        )
        pipeline.search.status = {"github": {"status": "ok", "candidates_found": 1}}
        return pipeline

    @patch("app.agent.Pipeline")
    def test_first_search_stores_in_cache(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert len(result["candidates"]) == 1
        assert mock_pipeline.run.call_count == 1
        assert len(store) == 1

    @patch("app.agent.Pipeline")
    def test_identical_search_returns_cached(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        r1 = agent.run("Python developer", sources=["github"], max_candidates=10)
        r2 = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert mock_pipeline.run.call_count == 1
        assert r1["candidates"][0]["name"] == r2["candidates"][0]["name"]

    @patch("app.agent.Pipeline")
    def test_different_jd_calls_pipeline(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        agent.run("Python developer", sources=["github"], max_candidates=10)
        agent.run("Java developer", sources=["github"], max_candidates=10)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_max_candidates_difference_separate_entries(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        agent.run("Python developer", sources=["github"], max_candidates=20)
        agent.run("Python developer", sources=["github"], max_candidates=50)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_different_sources_separate_entries(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        agent.run("Python developer", sources=["github"], max_candidates=10)
        agent.run("Python developer", sources=["linkedin"], max_candidates=10)
        assert mock_pipeline.run.call_count == 2

    @patch("app.agent.Pipeline")
    def test_separate_agent_instances_share_cache(self, MockPipeline):
        """CRITICAL: proves the per-instance bug is fixed.

        Request 1: Agent A → MISS → Tavily → STORE
        Request 2: Agent B → HIT → Tavily NOT called
        """
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        store = {}

        # Request 1: Agent A
        agent1, _ = self._setup_agent_with_mock(settings, mock_pipeline, store)
        agent1.run("Python developer", sources=["github"], max_candidates=10)

        # Request 2: Agent B (simulates get_agent() — completely new instance)
        _reset_cache()
        client2, _ = _mock_redis(store)
        import app.agent as agent_mod
        agent_mod._cache = SearchCache(redis_client=client2, ttl_seconds=settings.cache_ttl_seconds)

        from app.agent import ScrapingAgent
        agent2 = ScrapingAgent(settings)
        agent2.pipeline = mock_pipeline
        agent2.run("Python developer", sources=["github"], max_candidates=10)

        # Pipeline called only ONCE — Agent B got cache HIT from shared Redis
        assert mock_pipeline.run.call_count == 1

    @patch("app.agent.Pipeline")
    def test_redis_failure_still_searches(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()

        _reset_cache()
        client = MagicMock()
        client.get.side_effect = Exception("Redis down")
        client.set.side_effect = Exception("Redis down")
        import app.agent as agent_mod
        agent_mod._cache = SearchCache(redis_client=client, ttl_seconds=settings.cache_ttl_seconds)

        from app.agent import ScrapingAgent
        agent = ScrapingAgent(settings)
        agent.pipeline = mock_pipeline

        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert len(result["candidates"]) == 1
        assert mock_pipeline.run.call_count == 1

    @patch("app.agent.Pipeline")
    def test_redis_not_configured_still_searches(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()

        _reset_cache()
        import app.agent as agent_mod
        agent_mod._cache = SearchCache(redis_client=None, ttl_seconds=settings.cache_ttl_seconds)

        from app.agent import ScrapingAgent
        agent = ScrapingAgent(settings)
        agent.pipeline = mock_pipeline

        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert len(result["candidates"]) == 1
        assert mock_pipeline.run.call_count == 1

    @patch("app.agent.Pipeline")
    def test_shortlist_not_in_cache(self, MockPipeline):
        """Cache stores only search result data, no shortlist state."""
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()
        agent, store = self._setup_agent_with_mock(settings, mock_pipeline)

        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        cached_json = list(store.values())[0]
        cached = json.loads(cached_json)
        assert "shortlist" not in cached
        assert "shortlisted" not in cached
        assert "candidates" in cached

    @patch("app.agent.Pipeline")
    def test_cache_store_failure_still_returns_result(self, MockPipeline):
        mock_pipeline = self._mock_pipeline()
        MockPipeline.return_value = mock_pipeline
        settings = self._make_settings()

        _reset_cache()
        client = MagicMock()
        client.get.return_value = None
        client.set.side_effect = Exception("Redis write failed")
        import app.agent as agent_mod
        agent_mod._cache = SearchCache(redis_client=client, ttl_seconds=settings.cache_ttl_seconds)

        from app.agent import ScrapingAgent
        agent = ScrapingAgent(settings)
        agent.pipeline = mock_pipeline

        result = agent.run("Python developer", sources=["github"], max_candidates=10)
        assert len(result["candidates"]) == 1
        assert mock_pipeline.run.call_count == 1

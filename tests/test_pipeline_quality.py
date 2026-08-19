"""Tests for Stage 2: candidate quality and quantity improvements."""

from app.heuristics import (
    score_candidate,
    rank_candidates,
    extract_heuristic_candidates,
    _extract_skills,
    _extract_roles,
    _extract_location,
    _extract_experience_from_text,
    _is_search_or_listing_page,
    name_from_url,
)
from app.queries import build_default_queries, extract_keywords, _build_multi_queries
from app.pipeline import _canonical_url


# ── Scenario 1: Multi-query generation ──


class TestMultiQueryGeneration:
    def test_multiple_queries_per_source(self):
        jd = "Senior Python backend engineer with Django and AWS experience in Bangalore"
        queries = build_default_queries(jd, ["github", "linkedin"])
        source_counts = {}
        for q in queries:
            source_counts[q["source"]] = source_counts.get(q["source"], 0) + 1
        assert source_counts["github"] >= 2
        assert source_counts["linkedin"] >= 2

    def test_queries_contain_different_keyword_subsets(self):
        jd = "Full stack developer with React, Node.js, TypeScript, and PostgreSQL"
        queries = build_default_queries(jd, ["github"])
        query_strings = [q["query"] for q in queries]
        unique = set(query_strings)
        assert len(unique) >= 2

    def test_role_focused_query_included(self):
        jd = "Senior DevOps engineer with Kubernetes and Terraform"
        queries = build_default_queries(jd, ["github"])
        query_strings = [q["query"].lower() for q in queries]
        has_devops = any("devops" in q for q in query_strings)
        assert has_devops

    def test_skill_focused_query_included(self):
        jd = "Python Django developer with Redis and PostgreSQL"
        queries = build_default_queries(jd, ["github"])
        query_strings = [q["query"].lower() for q in queries]
        has_django = any("django" in q for q in query_strings)
        assert has_django

    def test_seniority_query_included(self):
        jd = "Principal software engineer with 15 years experience"
        queries = build_default_queries(jd, ["github"])
        query_strings = [q["query"].lower() for q in queries]
        has_principal = any("principal" in q for q in query_strings)
        assert has_principal


# ── Scenario 2: Scoring preserves valid candidates, rejects noise ──


class TestScoringPreservesValidCandidates:
    def test_high_skill_match_scores_high(self):
        jd = "Python Django backend developer"
        score = score_candidate(jd, "Python Django Backend Developer", "Built Django REST APIs with Python")
        assert score >= 0.50

    def test_zero_skill_match_low_score(self):
        jd = "Python Django backend developer"
        score = score_candidate(jd, "Marketing Manager", "Campaign strategy and brand management")
        assert score < 0.15

    def test_role_match_boosts_score(self):
        jd = "Python Django backend developer"
        score_role = score_candidate(jd, "Backend Engineer at Google", "Python developer building APIs")
        score_no_role = score_candidate(jd, "Data Analyst at Google", "Python developer building dashboards")
        assert score_role >= score_no_role

    def test_score_never_exceeds_ceiling(self):
        jd = "Python Django React TypeScript AWS Docker Kubernetes"
        score = score_candidate(jd, "Senior Full Stack Python Django React Developer", "Expert in Python Django React TypeScript AWS Docker Kubernetes with 10 years")
        assert score <= 0.95

    def test_score_never_below_floor(self):
        jd = "Python developer"
        score = score_candidate(jd, "Random unrelated title", "No matching skills here at all")
        assert score >= 0.05


# ── Scenario 3: URL validation accepts valid profiles, rejects search pages ──


class TestURLValidation:
    def test_github_profile_accepted(self):
        assert _is_search_or_listing_page(
            "https://github.com/johndoe", ""
        ) is False

    def test_github_topics_rejected(self):
        assert _is_search_or_listing_page(
            "https://github.com/topics/python", "Python Topics"
        ) is True

    def test_github_repos_page_rejected(self):
        assert _is_search_or_listing_page(
            "https://github.com/johndoe?tab=repositories", "Repositories"
        ) is True

    def test_linkedin_search_rejected(self):
        assert _is_search_or_listing_page(
            "https://www.linkedin.com/search/results/people/?keywords=python",
            "Search results | LinkedIn"
        ) is True

    def test_linkedin_jobs_rejected(self):
        assert _is_search_or_listing_page(
            "https://www.linkedin.com/jobs/search/?keywords=python",
            "Python Jobs | LinkedIn"
        ) is True

    def test_stackoverflow_question_not_profile(self):
        assert name_from_url(
            "https://stackoverflow.com/questions/12345/how-to-use-python"
        ) is None

    def test_name_from_github_profile(self):
        name = name_from_url("https://github.com/jane-smith")
        assert name == "Jane Smith"

    def test_name_from_linkedin_profile(self):
        name = name_from_url("https://www.linkedin.com/in/john-doe/")
        assert name == "John Doe"


# ── Scenario 4: Robust deduplication ──


class TestRobustDedup:
    def test_canonical_url_strips_www(self):
        assert _canonical_url("https://www.github.com/user") == _canonical_url("https://github.com/user")

    def test_canonical_url_strips_trailing_slash(self):
        assert _canonical_url("https://github.com/user/") == _canonical_url("https://github.com/user")

    def test_canonical_url_normalizes_case(self):
        assert _canonical_url("https://GitHub.com/User") == _canonical_url("https://github.com/user")

    def test_canonical_url_preserves_path(self):
        c1 = _canonical_url("https://github.com/user1")
        c2 = _canonical_url("https://github.com/user2")
        assert c1 != c2


# ── Scenario 5: Ranking uses multi-signal scoring ──


class TestMultiSignalRanking:
    def test_ranked_candidates_have_rank_field(self):
        candidates = [
            {"relevance_score": 0.8, "skills": ["python", "django"], "role": "Backend Engineer", "experience": "5 years", "location": "Bangalore"},
            {"relevance_score": 0.6, "skills": ["python"], "role": "Developer", "experience": "2 years", "location": "Remote"},
        ]
        ranked = rank_candidates(candidates, 10)
        assert len(ranked) == 2
        for c in ranked:
            assert "rank" in c

    def test_higher_relevance_gets_higher_rank(self):
        c1 = {"relevance_score": 0.9, "skills": ["python"], "role": "Engineer", "experience": None, "location": None}
        c2 = {"relevance_score": 0.3, "skills": ["python"], "role": "Engineer", "experience": None, "location": None}
        ranked = rank_candidates([c2, c1], 10)
        assert ranked[0]["relevance_score"] == 0.9

    def test_more_skills_boosts_rank(self):
        c1 = {"relevance_score": 0.7, "skills": ["python", "django", "aws", "docker", "kubernetes"], "role": "Engineer", "experience": None, "location": None}
        c2 = {"relevance_score": 0.7, "skills": ["python"], "role": "Engineer", "experience": None, "location": None}
        ranked = rank_candidates([c1, c2], 10)
        assert len(ranked[0]["skills"]) >= len(ranked[1]["skills"])

    def test_experience_boosts_rank(self):
        c1 = {"relevance_score": 0.7, "skills": ["python"], "role": "Engineer", "experience": "8 years", "location": None}
        c2 = {"relevance_score": 0.7, "skills": ["python"], "role": "Engineer", "experience": "1 years", "location": None}
        ranked = rank_candidates([c2, c1], 10)
        assert ranked[0]["experience"] == "8 years"

    def test_location_bonus_applied(self):
        c1 = {"relevance_score": 0.7, "skills": ["python"], "role": "Engineer", "experience": None, "location": "Bangalore"}
        c2 = {"relevance_score": 0.7, "skills": ["python"], "role": "Engineer", "experience": None, "location": None}
        ranked = rank_candidates([c2, c1], 10)
        assert ranked[0]["location"] == "Bangalore"

    def test_max_candidates_respected(self):
        candidates = [{"relevance_score": 0.5 + i * 0.05, "skills": [], "role": None, "experience": None, "location": None} for i in range(20)]
        ranked = rank_candidates(candidates, 5)
        assert len(ranked) <= 5


# ── Scenario 6: Extraction accepts valid profiles, rejects search/listing pages ──


class TestExtractionAcceptsRejects:
    def _make_row(self, url, title, snippet):
        return {"url": url, "title": title, "snippet": snippet}

    def test_github_profile_accepted(self):
        results = {
            "github": [self._make_row(
                "https://github.com/jane-smith",
                "jane-smith - Python Developer",
                "Python developer with Django experience"
            )]
        }
        candidates = extract_heuristic_candidates("Python Django developer", results)
        assert len(candidates) >= 1

    def test_github_topics_rejected(self):
        results = {
            "github": [self._make_row(
                "https://github.com/topics/python",
                "Python Topics · GitHub",
                "Browse Python topics on GitHub"
            )]
        }
        candidates = extract_heuristic_candidates("Python developer", results)
        assert len(candidates) == 0

    def test_linkedin_search_rejected(self):
        results = {
            "linkedin": [self._make_row(
                "https://www.linkedin.com/search/results/people/?keywords=python",
                "Python developers | LinkedIn",
                "Find Python developers on LinkedIn"
            )]
        }
        candidates = extract_heuristic_candidates("Python developer", results)
        assert len(candidates) == 0

    def test_low_score_rejected(self):
        results = {
            "github": [self._make_row(
                "https://github.com/jane-smith",
                "jane-smith - Marketing Specialist",
                "Marketing campaigns and brand strategy"
            )]
        }
        candidates = extract_heuristic_candidates("Python Django backend developer", results)
        assert len(candidates) == 0


# ── Scenario 7: Full pipeline produces more candidates than before ──


class TestFullPipelineDiscovery:
    def test_multi_query_increases_result_count(self):
        jd = "Senior Python backend engineer with Django, AWS, PostgreSQL in Bangalore"
        queries = build_default_queries(jd, ["github", "linkedin", "stackoverflow"])
        assert len(queries) >= 6, "Should produce at least 6 queries across 3 sources"

    def test_location_extraction_works(self):
        loc = _extract_location("Based in Bangalore, India. Python developer")
        assert loc is not None
        assert "Bengaluru" in loc

    def test_experience_extraction_range(self):
        exp = _extract_experience_from_text("5-8 years of experience")
        assert exp == "5-8 years"

    def test_experience_extraction_plus(self):
        exp = _extract_experience_from_text("10+ years in software engineering")
        assert exp == "10+ years"

    def test_experience_over_years(self):
        exp = _extract_experience_from_text("over 10 years of experience in ML")
        assert exp == "10+ years"

    def test_experience_more_than_years(self):
        exp = _extract_experience_from_text("more than 6 years working as a software engineer")
        assert exp == "6+ years"

    def test_experience_years_of_experience(self):
        exp = _extract_experience_from_text("7 years of experience in machine learning")
        assert exp == "7 years"

    def test_experience_years_experience(self):
        exp = _extract_experience_from_text("5 years experience building APIs")
        assert exp == "5 years"

    def test_experience_yrs(self):
        exp = _extract_experience_from_text("3 yrs experience with React")
        assert exp == "3 years"

    def test_experience_plus_format(self):
        exp = _extract_experience_from_text("5+years")
        assert exp == "5+ years"

    def test_experience_trailing_plus(self):
        exp = _extract_experience_from_text("8 years+ of development")
        assert exp == "8+ years"

    def test_experience_range_dash(self):
        exp = _extract_experience_from_text("5-8 years of experience")
        assert exp == "5-8 years"

    def test_experience_range_en_dash(self):
        exp = _extract_experience_from_text("3–7 years in software")
        assert exp == "3-7 years"

    def test_experience_range_to(self):
        exp = _extract_experience_from_text("10 to 15 years of leadership")
        assert exp == "10-15 years"

    def test_experience_fresher(self):
        exp = _extract_experience_from_text("fresher looking for opportunities")
        assert exp == "0 years"

    def test_experience_entry_level(self):
        exp = _extract_experience_from_text("entry level developer")
        assert exp == "0 years"

    def test_experience_junior(self):
        exp = _extract_experience_from_text("junior software engineer")
        assert exp == "0 years"

    def test_experience_no_match_python3(self):
        exp = _extract_experience_from_text("Python 3 developer")
        assert exp is None

    def test_experience_no_match_aws2024(self):
        exp = _extract_experience_from_text("AWS 2024 certified")
        assert exp is None

    def test_experience_no_match_projects(self):
        exp = _extract_experience_from_text("Built 5 projects using React")
        assert exp is None

    def test_experience_no_match_kubernetes(self):
        exp = _extract_experience_from_text("Kubernetes 1.29 and Docker")
        assert exp is None

    def test_experience_no_match_empty(self):
        exp = _extract_experience_from_text("")
        assert exp is None

    def test_experience_no_match_plain_title(self):
        exp = _extract_experience_from_text("Senior Machine Learning Engineer | Python | PyTorch | Azure")
        assert exp is None

    def test_experience_mixed_case(self):
        exp = _extract_experience_from_text("Over 12 Years of Experience in Data Science")
        assert exp == "12+ years"

    def test_experience_from_long_text(self):
        long_text = (
            "John Doe - Senior Software Engineer at TechCorp. "
            "Building scalable distributed systems with Python and Go. "
            "Machine Learning Engineer with 7 years of experience in NLP "
            "and computer vision. Published 3 papers in top-tier conferences. "
            "Previously at Google and Meta working on large-scale data pipelines."
        )
        exp = _extract_experience_from_text(long_text)
        assert exp == "7 years"

    def test_skills_extraction(self):
        skills = _extract_skills("Python Django AWS Docker Kubernetes PostgreSQL")
        assert "python" in skills
        assert "django" in skills
        assert "aws" in skills

    def test_roles_extraction(self):
        roles = _extract_roles("Senior backend engineer and tech lead")
        assert "backend" in roles
        assert "tech lead" in roles

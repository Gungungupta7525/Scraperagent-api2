"""Heuristic scoring, name extraction, and candidate building."""

from __future__ import annotations

import re

from .profiles import profile_source

_ROLE_TERMS = [
    "backend", "back-end", "back end",
    "frontend", "front-end", "front end",
    "fullstack", "full-stack", "full stack",
    "devops", "data engineer", "data scientist", "data analyst",
    "machine learning engineer", "ml engineer", "ai engineer",
    "software engineer", "software developer",
    "architect", "sre", "platform engineer",
    "product manager", "product designer", "ux designer", "ui designer",
    "mobile developer", "ios developer", "android developer",
    "security engineer", "cloud engineer",
    "consultant", "tech lead", "engineering manager",
    "qa engineer", "test engineer", "developer",
]

_TECH_SKILLS = [
    "python", "javascript", "typescript", "java", "go", "golang", "rust", "c++", "c#",
    "ruby", "php", "swift", "kotlin", "scala", "perl",
    "fastapi", "django", "flask", "spring", "spring boot", "rails", "laravel", "express",
    "react", "vue", "vuejs", "angular", "svelte", "nextjs", "next.js", "nuxt",
    "node", "nodejs", "node.js",
    "aws", "gcp", "google cloud", "azure", "docker", "kubernetes", "k8s",
    "terraform", "ansible", "jenkins", "ci/cd", "github actions",
    "nginx", "apache", "linux",
    "sql", "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch",
    "kafka", "spark", "hadoop", "airflow", "dbt", "snowflake", "bigquery",
    "tableau", "power bi",
    "machine learning", "deep learning", "nlp", "natural language processing",
    "tensorflow", "pytorch", "keras", "scikit-learn", "sklearn", "pandas", "numpy",
    "llm", "large language model", "transformer", "bert", "gpt", "rag",
    "computer vision", "opencv",
    "sap", "abap", "hana", "s/4hana", "fiori", "bapi", "idoc",
    "odata", "rap", "cds view", "cds views",
    "graphql", "rest api", "rest", "microservices", "agile", "scrum",
    "git", "github", "gitlab", "bitbucket",
    "css", "html", "sass", "tailwind",
    "xcode", "swiftui", "jetpack compose",
    "c", "elixir", "erlang", "haskell", "clojure",
]

_EXPERIENCE_SIGNALS = [
    "years", "yrs", "experience", "senior", "sr.", "lead", "principal", "staff",
    "architect", "manager", "director", "vp", "head of",
]


def name_from_url(url: str) -> str | None:
    if "scholar.google.com/" in url.lower():
        return None
    match = re.search(
        r"(?:github|gitlab|bitbucket|stackoverflow|leetcode|hackerrank|codepen|dev|hashnode|kaggle|researchgate|"
        r"huggingface|linkedin|wellfound|cutshort|behance|dribbble|artstation|orcid|producthunt|indiehackers)"
        r"\.(?:com|io|to|co|org|net)/",
        url.lower(),
    )
    if not match:
        return None
    slug = url[match.end():].split("?", 1)[0].rstrip("/")
    parts = [p for p in slug.split("/") if p]
    if parts and parts[0] in ("in", "profile", "users", "artists"):
        parts = parts[1:]
    if parts and parts[0].isdigit() and len(parts) > 1:
        parts = parts[1:]
    if not parts:
        return None
    non_profile_segments = {"questions", "answers", "q", "a", "problems", "contests", "tags",
                            "posts", "articles", "topics", "feeds", "search", "jobs",
                            "collections", "reviews", "products", "docs"}
    if parts[0].lower() in non_profile_segments:
        return None
    name_part = parts[0].lstrip("@")
    if not re.search(r"[a-z0-9]", name_part):
        return None
    if re.fullmatch(r"[0-9X][0-9X-]*", name_part):
        return None
    return re.sub(r"[-_+]+", " ", name_part).title()


def _skill_in_text(skill: str, text: str) -> bool:
    if re.search(r"[^a-z0-9]", skill):
        pat = r"(?<![a-z0-9])" + re.escape(skill) + r"(?![a-z0-9])"
    else:
        pat = r"\b" + re.escape(skill) + r"\b"
    return bool(re.search(pat, text))


def _extract_skills(text: str) -> list[str]:
    text_lower = text.lower()
    return [s for s in _TECH_SKILLS if _skill_in_text(s, text_lower)]


def _extract_roles(text: str) -> list[str]:
    text_lower = text.lower()
    return [r for r in _ROLE_TERMS if _skill_in_text(r, text_lower)]


def _extract_seniority(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(principal|staff|distinguished|fellow)\b", t):
        return "principal"
    if re.search(r"\b(senior|sr\.?|lead)\b", t):
        return "senior"
    if re.search(r"\b(junior|jr\.?|entry|associate|intern)\b", t):
        return "junior"
    return "mid"


def _extract_years(text: str) -> int | None:
    m = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", text.lower())
    return int(m.group(1)) if m else None


_LOCATION_PATTERNS = [
    re.compile(r"\b(bangalore|bengaluru|bengalore)\b", re.I),
    re.compile(r"\b(mumbai|bombay)\b", re.I),
    re.compile(r"\b(chennai|madras)\b", re.I),
    re.compile(r"\b(kolkata|calcutta)\b", re.I),
    re.compile(r"\b(delhi|new\s+delhi|noida|gurgaon|gurugram|faridabad|ghaziabad)\b", re.I),
    re.compile(r"\b(hyderabad|secunderabad)\b", re.I),
    re.compile(r"\b(pune|poona)\b", re.I),
    re.compile(r"\b(jaipur)\b", re.I),
    re.compile(r"\b(ahmedabad|ahmadabad)\b", re.I),
    re.compile(r"\b(indore)\b", re.I),
    re.compile(r"\b(chandigarh)\b", re.I),
    re.compile(r"\b(lucknow)\b", re.I),
    re.compile(r"\b(coimbatore)\b", re.I),
    re.compile(r"\b(kochi|cochin)\b", re.I),
    re.compile(r"\b(agra)\b", re.I),
    re.compile(r"\b(patna)\b", re.I),
    re.compile(r"\b(bhopal)\b", re.I),
    re.compile(r"\b(visakhapatnam|vizag)\b", re.I),
    re.compile(r"\b(india)\b", re.I),
    re.compile(r"\b(usa|united\s+states|us)\b", re.I),
    re.compile(r"\b(uk|united\s+kingdom|great\s+britain|england)\b", re.I),
    re.compile(r"\b(canada)\b", re.I),
    re.compile(r"\b(germany)\b", re.I),
    re.compile(r"\b(france)\b", re.I),
    re.compile(r"\b(australia)\b", re.I),
    re.compile(r"\b(singapore)\b", re.I),
    re.compile(r"\b(dubai|uae|abu\s+dhabi)\b", re.I),
    re.compile(r"\b(berlin|munich|frankfurt|hamburg)\b", re.I),
    re.compile(r"\b(san\s+francisco|sf|new\s+york|nyc|seattle|austin|boston|chicago|los\s+angeles|la)\b", re.I),
    re.compile(r"\b(remote)\b", re.I),
]


def _extract_location(text: str) -> str | None:
    t = text.lower()
    matches = []
    for pat in _LOCATION_PATTERNS:
        m = pat.search(t)
        if m:
            matches.append(m.group(1).strip())
    if not matches:
        return None
    canonical = _canonicalize_location(matches)
    return canonical


_CITY_ALIASES = {
    "bangalore": "Bengaluru, India",
    "bengaluru": "Bengaluru, India",
    "bengalore": "Bengaluru, India",
    "mumbai": "Mumbai, India",
    "bombay": "Mumbai, India",
    "chennai": "Chennai, India",
    "madras": "Chennai, India",
    "kolkata": "Kolkata, India",
    "calcutta": "Kolkata, India",
    "delhi": "Delhi, India",
    "new delhi": "Delhi, India",
    "noida": "Noida, India",
    "gurgaon": "Gurugram, India",
    "gurugram": "Gurugram, India",
    "faridabad": "Faridabad, India",
    "ghaziabad": "Ghaziabad, India",
    "hyderabad": "Hyderabad, India",
    "secunderabad": "Hyderabad, India",
    "pune": "Pune, India",
    "poona": "Pune, India",
    "jaipur": "Jaipur, India",
    "ahmedabad": "Ahmedabad, India",
    "ahmadabad": "Ahmedabad, India",
    "indore": "Indore, India",
    "chandigarh": "Chandigarh, India",
    "lucknow": "Lucknow, India",
    "coimbatore": "Coimbatore, India",
    "kochi": "Kochi, India",
    "cochin": "Kochi, India",
    "agra": "Agra, India",
    "patna": "Patna, India",
    "bhopal": "Bhopal, India",
    "visakhapatnam": "Visakhapatnam, India",
    "vizag": "Visakhapatnam, India",
    "usa": "USA",
    "united states": "USA",
    "us": "USA",
    "uk": "UK",
    "united kingdom": "UK",
    "great britain": "UK",
    "england": "UK",
    "canada": "Canada",
    "germany": "Germany",
    "france": "France",
    "australia": "Australia",
    "singapore": "Singapore",
    "dubai": "Dubai, UAE",
    "uae": "Dubai, UAE",
    "abu dhabi": "Abu Dhabi, UAE",
    "berlin": "Berlin, Germany",
    "munich": "Munich, Germany",
    "frankfurt": "Frankfurt, Germany",
    "hamburg": "Hamburg, Germany",
    "san francisco": "San Francisco, USA",
    "sf": "San Francisco, USA",
    "new york": "New York, USA",
    "nyc": "New York, USA",
    "seattle": "Seattle, USA",
    "austin": "Austin, USA",
    "boston": "Boston, USA",
    "chicago": "Chicago, USA",
    "los angeles": "Los Angeles, USA",
    "la": "Los Angeles, USA",
    "remote": "Remote",
    "india": "India",
}


def _canonicalize_location(raw_matches: list[str]) -> str:
    for m in raw_matches:
        low = m.lower().strip()
        if low in _CITY_ALIASES:
            return _CITY_ALIASES[low]
    return raw_matches[0].strip().title() if raw_matches else None


def _extract_experience_from_text(text: str) -> str | None:
    t = text.lower()
    m = re.search(r"(\d+)\s*[-–]\s*(\d+)\s*(?:years?|yrs?)", t)
    if m:
        return f"{m.group(1)}-{m.group(2)} years"
    m = re.search(r"(\d+)\+?\s*(?:years?|yrs?)", t)
    if m:
        yrs = int(m.group(1))
        return f"{yrs}+ years" if "+" in m.group(0) else f"{m.group(1)} years"
    if re.search(r"\b(fresher|entry\s*level|junior|0\s*(?:years?|yrs?))\b", t):
        return "0 years"
    return None


def _build_role(seniority: str, role_terms: list[str], skills: list[str]) -> str:
    parts = []
    if seniority and seniority not in ("mid",):
        parts.append(seniority.capitalize())
    if role_terms:
        parts.append(role_terms[0].title())
    elif skills:
        parts.append(skills[0].title())
    return " ".join(parts) if parts else None


def score_candidate(job_description: str, title: str, snippet: str) -> float:
    jd_skills = _extract_skills(job_description)
    jd_roles = _extract_roles(job_description)

    if not jd_skills and not jd_roles:
        from .queries import extract_keywords
        keywords = extract_keywords(job_description)
        if not keywords:
            return 0.5
        haystack = f"{title} {snippet}".lower()
        hits = sum(1 for kw in keywords if kw in haystack)
        return round(min(0.95, 0.2 + 0.6 * (hits / len(keywords))), 2)

    haystack = f"{title} {snippet}".lower()
    title_lower = title.lower()
    snippet_lower = snippet.lower()

    skill_hits = sum(1 for s in jd_skills if _skill_in_text(s, haystack))
    skill_ratio = skill_hits / max(len(jd_skills), 1)

    role_hits = sum(1 for r in jd_roles if _skill_in_text(r, title_lower))
    skill_title_hits = sum(1 for s in jd_skills if _skill_in_text(s, title_lower))
    total_title_hits = role_hits + skill_title_hits
    role_ratio = min(1.0, total_title_hits / max(min(len(jd_roles) + len(jd_skills), 3), 1))

    seniority = 0.0
    jd_senior = _extract_seniority(job_description)
    title_senior = _extract_seniority(title)
    if jd_senior == title_senior:
        seniority = 1.0
    elif jd_senior == "mid":
        seniority = 0.5

    snippet_hits = sum(1 for s in jd_skills if _skill_in_text(s, snippet_lower))
    density = snippet_hits / max(len(jd_skills), 1)

    raw = skill_ratio * 0.40 + role_ratio * 0.25 + seniority * 0.10 + density * 0.15

    if skill_hits == 0 and total_title_hits == 0:
        raw = min(raw, 0.08)
    elif skill_hits == 0 and total_title_hits >= 1:
        raw = max(raw, 0.18)
    elif skill_hits == 1 and len(jd_skills) > 3:
        raw = max(raw, 0.25)
    elif skill_hits == 1:
        raw = max(raw, 0.30)

    if skill_hits >= 3:
        raw += 0.08
    if skill_hits >= 5:
        raw += 0.05
    if total_title_hits >= 2:
        raw += 0.06
    if density >= 0.5:
        raw += 0.04

    return round(min(0.95, max(0.05, raw)), 2)


_BOILERPLATE = re.compile(
    r"(?:Skip to content|Log in|Create account|Sign up|Sign in|Log\s+in\s+or\s+sign\s+up|"
    r"Log\s+in\s+Create\s+account|DEV Community|Hashnode|"
    r"profile picture|profile photo|avatar|"
    r"Website|Menu|Search|Home|About|Contact|Privacy|Terms|"
    r"©\s*\d{4}|All rights reserved|"
    r"Loading\.\.\.|Please wait|"
    r"View profile|View website|"
    r"Posted|Shared|Reposted|"
    r"Show more|Show less|Read more|"
    r"Back to top|Scroll to|"
    r"\d+\s+(?:followers|connections|endorsements|recommendations))",
    re.IGNORECASE,
)

_HEADING_RE = re.compile(r"^#+\s+", re.MULTILINE)

_SEARCH_PAGE_PATTERNS = re.compile(
    r"(?:"
    r"/search[/?]|/jobs[/?]|/listings[/?]|/browse[/?]|/explore[/?]|/topics\b|/tags\b|"
    r"all repositories|repositories\b.*\bpage|members\b.*\bpage|"
    r"/companies\b|/organizations\b|/categories\b|/collections\b|"
    r"/resume[s]?\b|/job[s]?\b|/career[s]?\b|/hiring\b|/apply\b|"
    r"sign\s*up|register|create\s+account|pricing|features\b|"
    r"/trending|/popular|/featured|/directory\b|"
    r"tab=repositories|tab=projects"
    r")",
    re.I,
)


def _is_search_or_listing_page(url: str, title: str) -> bool:
    url_lower = url.lower()
    title_lower = title.lower()
    if _SEARCH_PAGE_PATTERNS.search(url_lower):
        return True
    if _SEARCH_PAGE_PATTERNS.search(title_lower):
        return True
    if re.search(r"/repos(?:itories)?(?:\?|/page)", url_lower):
        return True
    return False


def _clean_snippet(snippet: str) -> str:
    if not snippet:
        return ""
    cleaned = _BOILERPLATE.sub("", snippet)
    cleaned = _HEADING_RE.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[|\u2013\u2014:;,.\s]+", "", cleaned)
    cleaned = re.sub(r"[|\u2013\u2014:;,.\s]+$", "", cleaned)
    return cleaned[:200]


def _extract_candidate_skills(snippet: str, jd_skills: list[str]) -> list[str]:
    snippet_lower = snippet.lower()
    return [s for s in jd_skills if _skill_in_text(s, snippet_lower)][:10]


def extract_heuristic_candidates(job_description: str, results_by_source: dict) -> list:
    jd_skills = _extract_skills(job_description)
    candidates = []
    seen = set()
    rejected_search_page = 0
    rejected_low_score = 0
    for source, results in results_by_source.items():
        for row in results or []:
            url = (row.get("url") or "").strip()
            if url in seen:
                continue
            src = profile_source(url)
            if not src:
                continue
            seen.add(url)
            title = (row.get("title") or "").strip()
            raw_snippet = (row.get("snippet") or "").strip()
            snippet = _clean_snippet(raw_snippet)

            if _is_search_or_listing_page(url, title):
                rejected_search_page += 1
                continue

            evidence = f"{title} {snippet}"

            name = name_from_url(url) or re.sub(r"\s*[|–—]\s*.*$", "", title).strip() or None
            headline = re.sub(r"\s*[|–—]\s*(?:LinkedIn|GitHub|DEV|Hashnode|Wellfound|Indeed|Kaggle).*$", "", title, flags=re.IGNORECASE).strip() or None
            score = score_candidate(job_description, title, snippet)

            if score < 0.10:
                rejected_low_score += 1
                continue

            skills = _extract_candidate_skills(snippet, jd_skills)
            role_terms = _extract_roles(evidence)
            seniority = _extract_seniority(evidence)
            role = _build_role(seniority, role_terms, skills)
            experience = _extract_experience_from_text(evidence)
            location = _extract_location(evidence)

            candidates.append(
                {
                    "name": name,
                    "role": role or headline,
                    "headline": headline,
                    "source": src,
                    "url": url,
                    "location": location,
                    "skills": skills,
                    "experience": experience,
                    "relevance_score": score,
                    "summary": snippet[:200] or None,
                }
            )
    return candidates


def _parse_experience_years(experience: str | None) -> int | None:
    if not experience:
        return None
    m = re.search(r"(\d+)", experience)
    return int(m.group(1)) if m else None


def rank_candidates(candidates: list, max_candidates: int) -> list:
    if not candidates:
        return []

    scored = []
    for c in candidates:
        relevance = c.get("relevance_score") or 0.0
        skills = c.get("skills") or []
        skill_depth = min(1.0, len(skills) / 5.0) * 0.20

        role_match = 0.0
        if c.get("role"):
            role_match = min(1.0, len(c["role"].split()) / 2.0) * 0.15

        exp_years = _parse_experience_years(c.get("experience"))
        exp_score = 0.0
        if exp_years is not None:
            if exp_years <= 2:
                exp_score = 0.05
            elif exp_years <= 5:
                exp_score = 0.10
            elif exp_years <= 10:
                exp_score = 0.15
            else:
                exp_score = 0.12

        location_bonus = 0.05 if c.get("location") else 0.0

        combined = relevance + skill_depth + role_match + exp_score + location_bonus
        scored.append((combined, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    ranked = [c for _, c in scored[:max_candidates]]
    for i, c in enumerate(ranked, start=1):
        c["rank"] = i
    return ranked

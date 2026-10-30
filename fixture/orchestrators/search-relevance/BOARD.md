# Search relevance endpoints
Updated: 2026-09-15 14:31

## Tasks
- [x] Read the search relevance design and split the work per repo
- [x] catalog-api: search endpoint behind a feature flag (@search-relevance-catalog-api)
- [ ] recommendation-service: expose relevance score (@search-re-recommendation-service)
- [ ] Both: run the test suites and report the diffs

## Blockers
- recommendation-service worker is waiting for approval to run the test suite

## Questions
- Which service in recommendation-service: recommendation-api or ranking-worker? (@search-re-recommendation-service)

## Next
- Watch the deploy of #412 to prod (30 min)
- QA review of all worktrees

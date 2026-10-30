---
status: open
repo: recommendation-service
env: prod
title: 5xx 4.1% since deploy 14:02 (was 0.2%)
link: https://grafana.example.com/d/recs/recommendation-service?from=now-1h
opened: 2026-09-15T14:06:00Z
from: search-relevance-ops
---
5xx on POST /relevance went from 0.2% in the hour before the deploy to 4.1%
on the last two checks. Loki: "TypeError: score is undefined" repeating since
14:03. Deploy run #4812, commit 3f1c2ab.

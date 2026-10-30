# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately
through [GitHub's private vulnerability reporting](https://github.com/erikedling/herdquarters/security/advisories/new)
instead.

Include what you found, how to reproduce it, and what an attacker could do with
it. You'll get a reply within a week. Fixes go into the latest version on
`main`; older versions aren't patched.

## Scope

Herdquarters runs coding agents on your machine and gives them access to your
repos and terminals. Reports are especially welcome for anything that lets
untrusted input (a repo, a Slack message, a PR, a web page) run commands or read
files it shouldn't.

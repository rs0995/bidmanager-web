# Client-facing language

This is a client-facing app. Avoid technical/internal terms in any UI text, toasts, or messages shown to users — e.g. say "update" instead of "scrape"/"scraping"/"scraped", and prefer plain business language generally. Internal code (function/variable names, comments, API fields) can keep technical terms; only user-visible strings need to be generic.

@AGENTS.md

## Server API changes
Before working on checklist file sharing, accounts/organisations or tab visibility, read `../Server UI/server/API_CHANGES.md` (this app's to-do is "BM Pro" in section 4). Don't edit `Server UI/server/` from here; ask the server session for any API change.

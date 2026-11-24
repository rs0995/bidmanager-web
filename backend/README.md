# Legacy backend (disabled)

This directory is retained temporarily only to avoid deleting uncommitted historical work.
It is not a supported runtime or deployment source.

The single backend source of truth is `Server UI/server/`. Build, test, package, and deploy
that directory. The legacy Dockerfile intentionally fails so an old backend cannot be
deployed accidentally.

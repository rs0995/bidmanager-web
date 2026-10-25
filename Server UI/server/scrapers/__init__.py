"""Portal-specific scrapers for tender sites whose architecture differs from NIC/GePNIC.

NIC portals (MahaTenders, ETenders, Eprocure) are handled by app_core.ScraperBackend.
Each module here serves one other portal type (websites.portal_type) and is reached
through the portal guards at the top of the ScraperBackend entry points.
"""

import React, { useLayoutEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar.jsx';

// React Router never resets scroll on navigation by itself (unlike a
// traditional multi-page site) — without this, a screen pushed from a
// scrolled list (e.g. tapping a tender near the bottom of Bookmarks) opens
// still scrolled to that position instead of the top. Using a layout effect
// (not a plain effect) makes the reset happen before the browser paints the
// new page, instead of one tick later — a plain effect let the old scroll
// position flash on screen for a frame before jumping to the top.
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function AppShell() {
  return (
    <div className="min-h-[100dvh]" style={{ background: 'var(--bg)' }}>
      <ScrollToTop />
      <main style={{ paddingBottom: 'calc(62px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}

import React from 'react';
import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar.jsx';

export function AppShell() {
  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: 'var(--bg)' }}>
      <main className="flex-1 min-h-0" style={{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }}>
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}

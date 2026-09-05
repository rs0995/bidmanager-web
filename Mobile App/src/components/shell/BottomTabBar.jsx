import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Globe, FolderOpen, Bell, Menu } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { useAlerts } from '../../lib/alerts.js';

const TABS = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/tenders', label: 'Tenders', icon: Globe },
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/more', label: 'More', icon: Menu },
];

export function BottomTabBar() {
  const alerts = useAlerts();
  const unread = alerts.filter((a) => !a.read).length;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex pb-safe"
      style={{ background: 'var(--surface-0)', borderTop: '1px solid var(--border)' }}
    >
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn(
            'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px]',
            isActive ? 'font-semibold' : '',
          )}
          style={({ isActive }) => ({ color: isActive ? 'var(--accent)' : 'var(--text-muted)' })}
        >
          <span className="relative">
            <Icon size={20} />
            {to === '/alerts' && unread > 0 && (
              <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
            )}
          </span>
          <span className="text-[11px]">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

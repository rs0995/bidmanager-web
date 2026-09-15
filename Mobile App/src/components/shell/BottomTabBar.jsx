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
    <nav className="tabbar pb-safe">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn('tab', isActive && 'on')}
        >
          <span className="relative">
            <span className="ti"><Icon size={20} /></span>
            {to === '/alerts' && unread > 0 && (
              <span
                className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                style={{ background: 'var(--danger)' }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

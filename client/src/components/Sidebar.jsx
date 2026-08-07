import React from 'react';
import { NavLink } from 'react-router-dom';
import { Users, UserCog, KeyRound } from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { hasSection } from '../api/auth';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Management sections live in the side panel (moved out of the top menu).
const ITEMS = [
  { to: '/customers', label: 'Customers', icon: Users, section: 'customers' },
  { to: '/users', label: 'Users', icon: UserCog, section: 'users' },
  { to: '/roles', label: 'Roles', icon: KeyRound, section: 'roles' },
];

export default function Sidebar() {
  const items = ITEMS.filter((i) => hasSection(i.section));
  if (items.length === 0) return null; // nothing to manage → no panel

  return (
    <aside className="w-16 md:w-56 shrink-0 border-r border-white/5 bg-black/20 p-2 md:p-4">
      <div className="hidden md:block text-[10px] uppercase tracking-widest text-white/30 px-3 pb-2">Management</div>
      <nav className="space-y-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) => cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition justify-center md:justify-start',
              isActive ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted hover:text-white hover:bg-white/5'
            )}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

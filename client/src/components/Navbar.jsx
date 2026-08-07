import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Activity, Shield, LogOut, RadioTower, Globe } from 'lucide-react';
import api from '../api/client';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getAuth, hasSection, clearAuth } from '../api/auth';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Top-menu items (operational sections). Management sections (Customers, Users,
// Roles) live in the side panel instead.
const NAV_ITEMS = [
  { to: '/vpn', label: 'VPN Base', icon: Shield, section: 'vpn' },
  { to: '/olt', label: 'OLT Matrix', icon: Activity, section: 'olt' },
  { to: '/proxy', label: 'Web Tunnel', icon: Globe, section: 'proxy' },
];

export default function Navbar() {
  const navigate = useNavigate();
  const [vpnStatus, setVpnStatus] = useState({ connected: false });
  const auth = getAuth();
  const items = NAV_ITEMS.filter((i) => hasSection(i.section));

  const fetchStatus = async () => {
    try {
      const res = await api.get('/vpn/status');
      setVpnStatus(res.data);
    } catch (e) {
      // ignore (user may not have VPN access, or it's simply unreachable)
    }
  };

  useEffect(() => {
    // Only poll VPN status for users who can see VPN/Tunnel sections.
    if (!hasSection('vpn') && !hasSection('proxy')) return undefined;
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  return (
    <nav className="glass sticky top-0 z-50 border-b border-white/10 px-4 py-3 md:px-6 md:py-4 flex flex-wrap items-center justify-between gap-y-4">
      {/* Brand - Left */}
      <div className="flex items-center space-x-3 text-primary font-bold text-xl tracking-wide">
        <RadioTower className="w-6 h-6 animate-pulse" />
        <span>Mr.Fiber</span>
      </div>

      {/* Profile & Tunnel Pill - Right on Mobile */}
      <div className="flex items-center space-x-3 md:order-last">
        {(hasSection('vpn') || hasSection('proxy')) && (
          <div className="flex items-center space-x-2 bg-black/30 px-3 py-1.5 rounded-full border border-white/5">
            <div className={cn('w-2.5 h-2.5 rounded-full animate-pulse shrink-0', vpnStatus.connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500')} />
            <span className="text-xs font-semibold text-white/80 hidden sm:inline">{vpnStatus.connected ? 'Secure Tunnel' : 'Disconnected'}</span>
          </div>
        )}

        <div className="hidden sm:flex flex-col items-end leading-tight">
          <span className="text-sm font-semibold text-white/90">{auth.username || 'user'}</span>
          {auth.role && <span className="text-[10px] uppercase tracking-wider text-primary">{auth.role}</span>}
        </div>

        <button
          onClick={handleLogout}
          className="text-muted hover:text-red-400 transition-colors p-2 rounded-full hover:bg-red-400/10 shrink-0"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* App Links - Bottom on Mobile, Middle on Desktop */}
      <div className="flex space-x-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 justify-start md:justify-center border-t border-white/5 pt-3 md:border-0 md:pt-0">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => cn(
              'px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 whitespace-nowrap',
              isActive ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted hover:text-white hover:bg-white/5'
            )}
          >
            <div className="flex items-center space-x-2">
              <Icon className="w-4 h-4 shrink-0" />
              <span>{label}</span>
            </div>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

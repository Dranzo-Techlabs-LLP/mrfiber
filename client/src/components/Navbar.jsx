import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Activity, Shield, LogOut, RadioTower, Globe } from 'lucide-react';
import api from '../api/client';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function Navbar() {
  const navigate = useNavigate();
  const [vpnStatus, setVpnStatus] = useState({ connected: false });

  const fetchStatus = async () => {
    try {
      const res = await api.get('/vpn/status');
      setVpnStatus(res.data);
    } catch(e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Poll every 10s globally
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
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
      <div className="flex items-center space-x-4 md:order-last">
        <div className="flex items-center space-x-2 bg-black/30 px-3 py-1.5 rounded-full border border-white/5">
          <div className={cn("w-2.5 h-2.5 rounded-full animate-pulse shrink-0", vpnStatus.connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500")} />
          <span className="text-xs font-semibold text-white/80 hidden sm:inline">{vpnStatus.connected ? 'Secure Tunnel' : 'Disconnected'}</span>
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
          <NavLink
            to="/vpn"
            className={({ isActive }) => cn(
              "px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 whitespace-nowrap",
              isActive ? "bg-primary/20 text-primary shadow-sm" : "text-muted hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 shrink-0" />
              <span>VPN Base</span>
            </div>
          </NavLink>
          <NavLink
            to="/olt"
            className={({ isActive }) => cn(
              "px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 whitespace-nowrap",
              isActive ? "bg-primary/20 text-primary shadow-sm" : "text-muted hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 shrink-0" />
              <span>OLT Matrix</span>
            </div>
          </NavLink>
          <NavLink
            to="/proxy"
            className={({ isActive }) => cn(
              "px-3 md:px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 whitespace-nowrap",
              isActive ? "bg-primary/20 text-primary shadow-sm" : "text-muted hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center space-x-2">
              <Globe className="w-4 h-4 shrink-0" />
              <span>Web Tunnel</span>
            </div>
          </NavLink>
      </div>
    </nav>
  );
}

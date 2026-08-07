import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import VpnManager from './pages/VpnManager';
import OltMonitor from './pages/OltMonitor';
import WebProxy from './pages/WebProxy';
import Customers from './pages/Customers';
import Users from './pages/Users';
import Roles from './pages/Roles';
import { isAuthenticated, hasSection, firstAccessibleRoute } from './api/auth';

// Auth guard + section-level privilege guard. Redirects to login when logged
// out, or to the user's first accessible section when they lack this one.
const Guard = ({ section, children }) => {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (section && !hasSection(section)) return <Navigate to={firstAccessibleRoute()} replace />;
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-grow p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/vpn" element={<Guard section="vpn"><VpnManager /></Guard>} />
        <Route path="/olt" element={<Guard section="olt"><OltMonitor /></Guard>} />
        <Route path="/proxy" element={<Guard section="proxy"><WebProxy /></Guard>} />
        <Route path="/customers" element={<Guard section="customers"><Customers /></Guard>} />
        <Route path="/users" element={<Guard section="users"><Users /></Guard>} />
        <Route path="/roles" element={<Guard section="roles"><Roles /></Guard>} />
        <Route path="*" element={<Navigate to={isAuthenticated() ? firstAccessibleRoute() : '/login'} replace />} />
      </Routes>
    </Router>
  );
}

export default App;

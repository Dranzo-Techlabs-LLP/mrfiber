import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import VpnManager from './pages/VpnManager';
import OltMonitor from './pages/OltMonitor';
import WebProxy from './pages/WebProxy';

// Auth Guard Context
const PrivateRoute = ({ children }) => {
  const isAuth = !!localStorage.getItem('token');
  return isAuth ? (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow p-6">
        {children}
      </main>
    </div>
  ) : <Navigate to="/login" />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/vpn" 
          element={<PrivateRoute><VpnManager /></PrivateRoute>} 
        />
        <Route 
          path="/olt" 
          element={<PrivateRoute><OltMonitor /></PrivateRoute>} 
        />
        <Route 
          path="/proxy" 
          element={<PrivateRoute><WebProxy /></PrivateRoute>} 
        />
        <Route path="*" element={<Navigate to="/vpn" />} />
      </Routes>
    </Router>
  );
}

export default App;

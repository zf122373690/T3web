import {Navigate, Route, Routes} from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Scan from './pages/Scan';
import Serial from './pages/Serial';
import Messages from './pages/Messages';

function Protected({children}: {children: React.ReactNode}) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="serial" element={<Serial />} />
        <Route path="messages" element={<Messages />} />
        <Route path="devices" element={<Devices />} />
        <Route path="scan" element={<Scan />} />
      </Route>
    </Routes>
  );
}

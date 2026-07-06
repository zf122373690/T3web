import {Navigate, Route, Routes} from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Devices from './pages/Devices';
import Scan from './pages/Scan';
import Serial from './pages/Serial';
import ModeSelect from './pages/ModeSelect';
import Messages from './pages/Messages';
import Calls from './pages/Calls';

function Protected({children}: {children: React.ReactNode}) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function ModeGuard({mode, children}: {mode: 'serial' | 'lan'; children: React.ReactNode}) {
  const selected = localStorage.getItem('t3-work-mode');
  if (selected !== mode) return <Navigate to="/" replace />;
  return children;
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
        <Route index element={<ModeSelect />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="serial" element={<ModeGuard mode="serial"><Serial /></ModeGuard>} />
        <Route path="messages" element={<ModeGuard mode="lan"><Messages /></ModeGuard>} />
        <Route path="devices" element={<ModeGuard mode="lan"><Devices /></ModeGuard>} />
        <Route path="scan" element={<ModeGuard mode="lan"><Scan /></ModeGuard>} />
        <Route path="calls" element={<ModeGuard mode="lan"><Calls /></ModeGuard>} />
      </Route>
    </Routes>
  );
}

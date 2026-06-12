import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, useAuthState, useAuth } from './hooks/useAuth';
import { Layout } from './components/Layout';
import { HealthChatBubble } from './components/HealthChatBubble';
import { SyncProvider } from './context/SyncContext';
import { InsightProvider } from './context/InsightContext';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Records } from './pages/Records';
import { History } from './pages/History';
import { Appointments } from './pages/Appointments';
import { HealthIntelligence } from './pages/HealthIntelligence';
import { SharedView } from './pages/SharedView';
import { ProviderDirectory } from './pages/ProviderDirectory';
import { Toaster } from './components/ui/toaster';

function ProtectedLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400 text-lg">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Layout />
      <HealthChatBubble />
    </>
  );
}

export default function App() {
  const authState = useAuthState();

  return (
    <AuthContext.Provider value={authState}>
      <SyncProvider>
      <InsightProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/share/:token" element={<SharedView />} />

        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/records" element={<Records />} />
          <Route path="/history" element={<History />} />
          <Route path="/medications" element={<Navigate to="/history?tab=medications" replace />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/labs" element={<Navigate to="/history?tab=test-results" replace />} />
          <Route path="/insights" element={<HealthIntelligence />} />
          <Route path="/providers" element={<ProviderDirectory />} />
          <Route path="/share" element={<Navigate to="/records" replace />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
      </InsightProvider>
      </SyncProvider>
    </AuthContext.Provider>
  );
}

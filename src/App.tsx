import { AuthProvider } from './lib/auth';
import { RouterProvider, useRouter } from './lib/router';
import { HomePage } from './pages/HomePage';
import { AuthPage } from './pages/AuthPage';
import { QueuePage } from './pages/QueuePage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';

function Routes() {
  const { route } = useRouter();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'login':
      return <AuthPage />;
    case 'queue':
      return <QueuePage clinicSlug={route.clinicSlug} doctorId={route.doctorId} />;
    case 'dashboard':
      return <DashboardPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}

export default App;

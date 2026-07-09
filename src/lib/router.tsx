import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'settings' }
  | { name: 'queue'; clinicSlug: string; doctorId: string };

function parsePath(): Route {
  const path = window.location.pathname.replace(/^\//, '') || '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'dashboard') return { name: 'dashboard' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'queue' && parts[1] && parts[2]) {
    return { name: 'queue', clinicSlug: decodeURIComponent(parts[1]), doctorId: parts[2] };
  }
  return { name: 'home' };
}

type RouterContextValue = { route: Route; navigate: (path: string) => void };
const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parsePath);

  useEffect(() => {
    const onChange = () => setRoute(parsePath());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.startsWith('#') ? path.slice(1) : path;
    const normalized = clean.startsWith('/') ? clean : `/${clean}`;
    window.history.pushState({}, '', normalized);
    setRoute(parsePath());
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
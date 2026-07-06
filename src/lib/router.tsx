import { useEffect, useState, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'login' }
  | { name: 'dashboard' }
  | { name: 'settings' }
  | { name: 'queue'; clinicSlug: string; doctorId: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'dashboard') return { name: 'dashboard' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'queue' && parts[1] && parts[2]) {
    return { name: 'queue', clinicSlug: decodeURIComponent(parts[1]), doctorId: parts[2] };
  }
  return { name: 'home' };
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.startsWith('#') ? path : `#${path}`;
    window.location.hash = clean;
  }, []);

  return { route, navigate };
}

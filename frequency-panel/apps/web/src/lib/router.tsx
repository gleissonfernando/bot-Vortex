import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type RouterState = {
  pathname: string;
  params: Record<string, string>;
  push: (href: string) => void;
  replace: (href: string) => void;
};

const RouterContext = createContext<RouterState | null>(null);

function currentPathname() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

function memberParams(pathname: string): Record<string, string> {
  const match = pathname.match(/^\/dashboard\/members\/([^/?#]+)$/);
  return match ? { id: decodeURIComponent(match[1]) } : {};
}

function navigate(href: string, replace = false) {
  if (!href.startsWith('/')) {
    window.location.href = href;
    return;
  }

  if (replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  window.dispatchEvent(new Event('vortex:navigate'));
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [pathname, setPathname] = useState(currentPathname);

  useEffect(() => {
    const update = () => setPathname(currentPathname());
    window.addEventListener('popstate', update);
    window.addEventListener('vortex:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('vortex:navigate', update);
    };
  }, []);

  const value = useMemo<RouterState>(() => ({
    pathname,
    params: memberParams(pathname),
    push: (href) => navigate(href, false),
    replace: (href) => navigate(href, true)
  }), [pathname]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function usePathname() {
  return useContext(RouterContext)?.pathname || currentPathname();
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return (useContext(RouterContext)?.params || {}) as T;
}

export function useRouter() {
  const router = useContext(RouterContext);
  return useMemo(() => ({
    push: router?.push || ((href: string) => navigate(href, false)),
    replace: router?.replace || ((href: string) => navigate(href, true)),
    refresh: () => window.dispatchEvent(new Event('vortex:navigate'))
  }), [router]);
}

export function Link({
  href,
  onClick,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented
          || event.button !== 0
          || event.metaKey
          || event.ctrlKey
          || event.shiftKey
          || event.altKey
          || props.target
          || !href.startsWith('/')
        ) {
          return;
        }
        event.preventDefault();
        navigate(href, false);
      }}
    >
      {children}
    </a>
  );
}

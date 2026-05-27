'use client';

import { useEffect } from 'react';

const APP_SHELL_VERSION = '2026-05-27-vortex-brand';
const STORAGE_KEY = 'vortex_frequency_shell_version';

export function AppVersionGuard() {
  useEffect(() => {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current && current !== APP_SHELL_VERSION) {
      localStorage.setItem(STORAGE_KEY, APP_SHELL_VERSION);
      window.location.reload();
      return;
    }

    localStorage.setItem(STORAGE_KEY, APP_SHELL_VERSION);
  }, []);

  return null;
}

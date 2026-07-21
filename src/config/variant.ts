export const SITE_VARIANT: string = (() => {
  const env = import.meta.env.VITE_VARIANT || 'full';
  // Web deployments: build-time variant (non-full) takes priority — each deployment is variant-specific.
  if (env !== 'full') return env;
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (stored === 'tech' || stored === 'full' || stored === 'finance' || stored === 'happy') return stored;
  }
  return env;
})();

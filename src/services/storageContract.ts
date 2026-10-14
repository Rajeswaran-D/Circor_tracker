export type StorageProvider = 'local' | 'organization-api';

export interface StorageConfig {
  provider: StorageProvider;
  apiBaseUrl: string;
  organizationId: string;
}

export const STORAGE_KEYS = [
  'cft_pos',
  'cft_products',
  'cft_templates',
  'cft_rectifications',
  'cft_audit',
  'cft_config',
  'cft_subdivisions',
  'cft_slot_assignments'
] as const;

export type StorageKey = (typeof STORAGE_KEYS)[number];

export function getStorageConfig(): StorageConfig {
  let apiBaseUrl = '';

  if (typeof window !== 'undefined') {
    // 1. Check URL parameters for explicit backend override (e.g. ?backend=https://circor-tracker-api.onrender.com)
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const queryBackend = searchParams.get('backend') || searchParams.get('api') || searchParams.get('apiUrl');
      if (queryBackend && queryBackend.trim()) {
        const cleanUrl = queryBackend.trim().replace(/\/$/, '');
        localStorage.setItem('cft_backend_api_url', cleanUrl);
        apiBaseUrl = cleanUrl;
      }
    } catch {}

    // 2. Check localStorage override (allows runtime switching without rebuilding Vercel)
    if (!apiBaseUrl) {
      try {
        const savedUrl = localStorage.getItem('cft_backend_api_url');
        if (savedUrl && savedUrl.trim()) {
          apiBaseUrl = savedUrl.trim().replace(/\/$/, '');
        }
      } catch {}
    }

    // 3. Check window-level injected config
    if (!apiBaseUrl) {
      const win = window as any;
      const windowEnv = win.__CFT_BACKEND_URL__ || win.ENV?.VITE_STORAGE_API_BASE_URL;
      if (typeof windowEnv === 'string' && windowEnv.trim()) {
        apiBaseUrl = windowEnv.trim().replace(/\/$/, '');
      }
    }
  }

  // 4. Check Vite build-time environment variable
  if (!apiBaseUrl && import.meta.env.VITE_STORAGE_API_BASE_URL) {
    apiBaseUrl = String(import.meta.env.VITE_STORAGE_API_BASE_URL).trim().replace(/\/$/, '');
  }

  // 5. Default to relative /api (which proxies to Render via vercel.json rewrites or Vite dev proxy)
  if (!apiBaseUrl) {
    apiBaseUrl = '/api';
  }

  const organizationId = import.meta.env.VITE_ORGANIZATION_ID || 'circor-flow-technologies';

  return {
    provider: 'organization-api',
    apiBaseUrl,
    organizationId
  };
}

export function setCustomBackendUrl(url: string): void {
  if (typeof window !== 'undefined') {
    const clean = (url || '').trim().replace(/\/$/, '');
    if (clean) {
      localStorage.setItem('cft_backend_api_url', clean);
    } else {
      localStorage.removeItem('cft_backend_api_url');
    }
  }
}

export function getSharedStateEndpoint(config = getStorageConfig()): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/shared-state`;
}

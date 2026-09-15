export const DEFAULT_SERVER_URL = String(
  import.meta.env.VITE_API_BASE_URL || 'https://api.example.com',
).trim().replace(/\/+$/, '');

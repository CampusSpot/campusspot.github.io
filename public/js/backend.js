// Connection to the backend (Supabase): database functions, sign-in, and photo storage.
// Live site: your Supabase project from config.js. Local mode (npm start on your computer):
// the local server answers the same requests with a test database.
const config = window.POLYSPOT_CONFIG || {};
const local = window.POLYSPOT_LOCAL;

/** 'live' (Supabase), 'local' (npm start, test database) or 'unconfigured' (published without Supabase yet) */
export const mode = config.supabaseUrl ? 'live' : local?.local ? 'local' : 'unconfigured';
export const siteConfig = config;
export const localInfo = local;

export const sb = mode === 'unconfigured' ? null : window.supabase.createClient(
  mode === 'live' ? config.supabaseUrl : location.origin,
  mode === 'live' ? config.supabaseAnonKey : 'local-mode',
  {
    auth: { flowType: 'pkce', detectSessionInUrl: mode === 'live', persistSession: true, autoRefreshToken: true, storageKey: 'polyspot-auth' },
  },
);

export class ApiError extends Error {
  constructor(err) {
    super(err?.message || 'Something went wrong');
    this.code = err?.code;
    this.hint = err?.hint;
  }
}

/** Calls a database function; returns its result or throws ApiError. */
export async function rpc(fn, args = {}) {
  if (!sb) throw new ApiError({ message: 'This site isn’t connected to its database yet.' });
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new ApiError(error);
  return data;
}

export const photoUrl = path => (sb ? sb.storage.from('photos').getPublicUrl(path).data.publicUrl : '');

export async function uploadPhoto(path, bytes, contentType) {
  const { error } = await sb.storage.from('photos').upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
  if (error) throw new ApiError(error);
}

export async function deletePhoto(path) {
  const { error } = await sb.storage.from('photos').remove([path]);
  if (error) throw new ApiError(error);
}

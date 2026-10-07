// Remembers who last signed in so offline reads can use that user's cache after the session expires.
const KEY = 'usmle:lastUserId';
export const getLastUserId = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setLastUserId = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* best-effort */ } };
export const clearLastUserId = () => { try { localStorage.removeItem(KEY); } catch { /* best-effort */ } };

// Set by the sign-out button so AuthGate can tell it apart from an expiry/other-tab SIGNED_OUT.
let explicit = false;
export const markExplicitSignOut = (v = true) => { explicit = v; };
export const takeExplicitSignOut = () => { const v = explicit; explicit = false; return v; };

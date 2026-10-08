import { useEffect, useState } from 'react';
import { supabase } from '../../db/client';
import { Icon } from '../../ui/Icon';
import { LangSwitch, useT, type Tr } from '../../ui/lang';

// Fixed app root (no query, no hash route) so it matches the Supabase redirect allow-list.
const appUrl = () => window.location.origin + import.meta.env.BASE_URL;

const ERROR_PARAMS = ['error', 'error_code', 'error_description'];

const signupBlocked = (message?: string | null, code?: string | null) =>
  code === 'signup_disabled' || code === 'otp_disabled' || /signups? not allowed/i.test(message ?? '');
const notRegistered = (what: string, tr: Tr) => tr("This {what} isn't registered. Ask James to add you.", { what: tr(what) });

// Supabase sends OAuth failures back in the query string or the hash.
function redirectError(tr: Tr): string {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (k: string) => query.get(k) ?? hash.get(k);
  const description = get('error_description');
  const code = get('error_code');
  if (!description && !code && !get('error')) return '';
  return signupBlocked(description, code) ? notRegistered('Google account', tr) : description || tr('Sign-in failed.');
}

// Drop the error params once shown so a reload or a later sign-out doesn't resurrect them.
function clearRedirectError() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (!ERROR_PARAMS.some((k) => url.searchParams.has(k) || hash.has(k))) return;
  ERROR_PARAMS.forEach((k) => { url.searchParams.delete(k); hash.delete(k); });
  const rest = hash.toString();
  window.history.replaceState(null, '', url.pathname + url.search + (rest ? `#${rest}` : ''));
}

export function Login() {
  const [email, setEmail] = useState('');
  const tr = useT();
  const [msg, setMsg] = useState(() => redirectError(tr));

  useEffect(clearRedirectError, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl() } });
    setMsg(!error ? tr('Check your email for the sign-in link.')
      : signupBlocked(error.message, (error as { code?: string }).code) ? notRegistered('email', tr) : error.message);
  }

  async function google() {
    setMsg('');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) setMsg(error.message);
  }

  return (
    <main className="login">
      <div className="login-lang"><LangSwitch /></div>
      <div className="login-box">
        <div className="brand"><span className="brand-mark"><Icon name="logo" size={19} /></span></div>
        <h1>USMLE Prep</h1>
        <p className="sub">{tr('Step 1 study plan, questions and flashcards.')}</p>
        <div className="card">
          <button type="button" className="primary" onClick={google}>{tr('Continue with Google')}</button>
        </div>
        <form onSubmit={submit} className="card">
          <label>{tr('Email')} <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button type="submit">{tr('Email me a sign-in link')}</button>
          {msg && <p role="status" style={{ marginTop: 12 }}>{msg}</p>}
        </form>
      </div>
    </main>
  );
}

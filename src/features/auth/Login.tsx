import { useState } from 'react';
import { supabase } from '../../db/client';

const appUrl = () => window.location.href.split('#')[0].split('?')[0];

// Supabase sends OAuth failures back in the query string or the hash.
function redirectError(): string {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (k: string) => query.get(k) ?? hash.get(k);
  const description = get('error_description');
  const code = get('error_code');
  if (!description && !code) return '';
  return code === 'signup_disabled' || /signups? not allowed/i.test(description ?? '')
    ? "This Google account isn't registered. Ask James to add you."
    : description ?? 'Sign-in failed.';
}

export function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(redirectError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl() } });
    setMsg(!error ? 'Check your email for the sign-in link.'
      : /signups? not allowed/i.test(error.message) || (error as { code?: string }).code === 'otp_disabled'
        ? "This email isn't registered. Ask James to add you." : error.message);
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) setMsg(error.message);
  }

  return (
    <main>
      <h1>USMLE Prep</h1>
      <div className="card">
        <button type="button" onClick={google}>Continue with Google</button>
        {msg && <p role="status">{msg}</p>}
      </div>
      <form onSubmit={submit} className="card">
        <label>Email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>{' '}
        <button type="submit">Email me a sign-in link</button>
      </form>
    </main>
  );
}

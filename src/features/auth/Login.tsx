import { useState } from 'react';
import { supabase } from '../../db/client';

export function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split('#')[0] } });
    setMsg(!error ? 'Check your email for the sign-in link.'
      : /signups? not allowed/i.test(error.message) || (error as { code?: string }).code === 'otp_disabled'
        ? "This email isn't registered. Ask James to add you." : error.message);
  }

  return (
    <main>
      <h1>USMLE Prep</h1>
      <form onSubmit={submit} className="card">
        <label>Email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>{' '}
        <button type="submit">Email me a sign-in link</button>
        {msg && <p>{msg}</p>}
      </form>
    </main>
  );
}

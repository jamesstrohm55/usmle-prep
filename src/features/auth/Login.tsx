import { useState } from 'react';
import { supabase } from '../../db/client';

export function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0] } });
    setMsg(error ? error.message : 'Check your email for the sign-in link.');
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

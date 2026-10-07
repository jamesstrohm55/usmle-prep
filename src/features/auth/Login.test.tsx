import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithOtp = vi.fn();
const signInWithOAuth = vi.fn();
vi.mock('../../db/client', () => ({
  supabase: { auth: { signInWithOtp: (a: unknown) => signInWithOtp(a), signInWithOAuth: (a: unknown) => signInWithOAuth(a) } },
}));
import { Login } from './Login';

async function submit() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /sign-in link/i }));
}

beforeEach(() => {
  signInWithOtp.mockReset();
  signInWithOAuth.mockReset();
  window.history.replaceState(null, '', '/');
});

test('does not create users and shows the sent message', async () => {
  signInWithOtp.mockResolvedValue({ error: null });
  await submit();
  expect(await screen.findByText(/check your email/i)).toBeTruthy();
  expect(signInWithOtp.mock.calls[0][0].options.shouldCreateUser).toBe(false);
});

test.each([
  [{ message: 'Signups not allowed for otp', code: 'otp_disabled' }],
  [{ message: 'Signups not allowed for otp' }],
])('friendly message when the email is not registered: %j', async (error) => {
  signInWithOtp.mockResolvedValue({ error });
  await submit();
  await waitFor(() => expect(screen.getByText("This email isn't registered. Ask James to add you.")).toBeTruthy());
});

test('other errors show their message', async () => {
  signInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
  await submit();
  expect(await screen.findByText('rate limited')).toBeTruthy();
});

test('Continue with Google starts OAuth with the app URL as redirect', async () => {
  signInWithOAuth.mockResolvedValue({ error: null });
  render(<Login />);
  fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
  expect(signInWithOAuth.mock.calls[0][0]).toEqual({
    provider: 'google',
    options: { redirectTo: window.location.href.split('#')[0] },
  });
});

test('a failed Google start shows the error', async () => {
  signInWithOAuth.mockResolvedValue({ error: { message: 'provider is not enabled' } });
  render(<Login />);
  fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
  expect(await screen.findByText('provider is not enabled')).toBeTruthy();
});

test('coming back from Google with an unregistered account shows the friendly message', async () => {
  window.history.replaceState(null, '', '/?error=server_error&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance');
  render(<Login />);
  expect(await screen.findByText("This Google account isn't registered. Ask James to add you.")).toBeTruthy();
});

test('other OAuth redirect errors show their description', async () => {
  window.history.replaceState(null, '', '/#error=access_denied&error_description=Access+denied');
  render(<Login />);
  expect(await screen.findByText('Access denied')).toBeTruthy();
});

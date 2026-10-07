import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithOtp = vi.fn();
vi.mock('../../db/client', () => ({ supabase: { auth: { signInWithOtp: (a: unknown) => signInWithOtp(a) } } }));
import { Login } from './Login';

async function submit() {
  render(<Login />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /sign-in link/i }));
}

beforeEach(() => signInWithOtp.mockReset());

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

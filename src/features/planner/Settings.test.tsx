import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings';
import type { Settings as StudySettings } from '../../db/queries';

const value: StudySettings = { target_date: '2027-03-01', minutes_by_weekday: [10, 20, 30, 40, 50, 60, 70] };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const input = (re: RegExp) => screen.getByLabelText(re) as HTMLInputElement;
const saved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0][0] as StudySettings;

test('shows the target date and seven weekday inputs from value', () => {
  render(<Settings value={value} onSave={async () => {}} />);
  expect(input(/target exam date/i).value).toBe('2027-03-01');
  DAYS.forEach((d, i) => expect(input(new RegExp(d)).value).toBe(String(value.minutes_by_weekday[i])));
});

test('typing 90 into Monday and saving calls onSave with it', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<Settings value={value} onSave={onSave} />);
  fireEvent.change(input(/Monday/), { target: { value: '90' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(saved(onSave).minutes_by_weekday[0]).toBe(90);
});

test('an empty date saves null', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<Settings value={value} onSave={onSave} />);
  fireEvent.change(input(/target exam date/i), { target: { value: '' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(saved(onSave).target_date).toBeNull();
});

test('minutes are clamped to 0..600 and non-numeric becomes 0', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<Settings value={value} onSave={onSave} />);
  fireEvent.change(input(/Monday/), { target: { value: '9999' } });
  fireEvent.change(input(/Tuesday/), { target: { value: '-5' } });
  fireEvent.change(input(/Wednesday/), { target: { value: '' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(saved(onSave).minutes_by_weekday.slice(0, 3)).toEqual([600, 0, 0]);
});

test('a rejected save shows an error and re-enables the button', async () => {
  render(<Settings value={value} onSave={async () => { throw new Error('offline'); }} />);
  fireEvent.click(screen.getByText('Save'));
  expect((await screen.findByRole('alert')).textContent).toMatch(/offline/);
  expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(false);
});

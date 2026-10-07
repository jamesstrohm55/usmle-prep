import { render, screen, fireEvent } from '@testing-library/react';
import { ItemImage, IMAGE_ALT } from './ItemImage';

const base = import.meta.env.BASE_URL;

test('relative src gets BASE_URL prefix', () => {
  render(<ItemImage src="images/ecg/afib.jpg" credit="x" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(`${base}images/ecg/afib.jpg`);
});
test('https src passes through', () => {
  render(<ItemImage src="https://example.com/a.jpg" credit="x" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/a.jpg');
});
test('generic alt, lazy loading, credit as text', () => {
  render(<ItemImage src="images/a.jpg" credit="Jane, CC BY 4.0, https://x.org/a" />);
  const img = screen.getByRole('img');
  expect(img.getAttribute('alt')).toBe(IMAGE_ALT);
  expect(img.getAttribute('loading')).toBe('lazy');
  expect(screen.getByText('Jane, CC BY 4.0, https://x.org/a')).toBeTruthy();
  expect(document.querySelector('a')).toBeNull();
});
test('onError shows fallback and keeps credit', () => {
  render(<ItemImage src="images/a.jpg" credit="Jane, CC0" />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('Image unavailable')).toBeTruthy();
  expect(screen.getByText('Jane, CC0')).toBeTruthy();
});
test('missing credit does not crash', () => {
  render(<ItemImage src="images/a.jpg" />);
  expect(screen.getByRole('img')).toBeTruthy();
});
test('missing or empty src renders nothing', () => {
  const { container, rerender } = render(<ItemImage src={null} credit="x" />);
  expect(container.innerHTML).toBe('');
  rerender(<ItemImage src="" credit="x" />);
  expect(container.innerHTML).toBe('');
});
// http:// is not absolute (schema allows https only); it is treated as a relative path and will not load.
test('http src is treated as relative, not passed through', () => {
  render(<ItemImage src="http://example.com/a.jpg" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe(`${base}http://example.com/a.jpg`);
});
test('credit is collapsed by default so a file name cannot reveal the answer', () => {
  render(<ItemImage src="images/a.jpg" credit="Jane, CC0, https://x.org/Lobar_pneumonia.jpg" />);
  const d = document.querySelector('details') as HTMLDetailsElement;
  expect(d).toBeTruthy();
  expect(d.open).toBe(false);
});
test('renders no stray source text next to the credit', () => {
  const { container } = render(<ItemImage src="images/a.jpg" credit="Jane, CC0" />);
  expect(container.textContent).toBe('Image creditJane, CC0');
});

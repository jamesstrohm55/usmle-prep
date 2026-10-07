import { render, screen, fireEvent } from '@testing-library/react';
import { ItemImage } from './ItemImage';

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
  expect(img.getAttribute('alt')).toBe('Clinical image (see the question)');
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

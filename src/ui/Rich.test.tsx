import { render } from '@testing-library/react';
import { Rich } from './Rich';

test('**bold** renders strong', () => {
  const { container } = render(<p><Rich text="a **b** c" /></p>);
  expect(container.querySelector('strong')?.textContent).toBe('b');
});
test('*italic* renders em', () => {
  const { container } = render(<p><Rich text="a *b* c" /></p>);
  expect(container.querySelector('em')?.textContent).toBe('b');
});
test('HTML is rendered as text, not injected', () => {
  const { container } = render(<p><Rich text="<script>x()</script><b>hi</b>" /></p>);
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  expect(container.textContent).toBe('<script>x()</script><b>hi</b>');
});
test('plain text unchanged', () => {
  const { container } = render(<p><Rich text="just text" /></p>);
  expect(container.textContent).toBe('just text');
  expect(container.querySelector('strong,em')).toBeNull();
});

test.each(['** foo', '*5 mg', '**', '*', 'a * b'])('unbalanced %j keeps every character', (t) => {
  const { container } = render(<p><Rich text={t} /></p>);
  expect(container.textContent).toBe(t);
  expect(container.querySelector('strong,em')).toBeNull();
});

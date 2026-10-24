import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { chat: { history: jest.fn(), send: jest.fn() } },
}));

const { API } = require('./api');
const { ChatDrawer } = require('./App');

beforeEach(() => {
  jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
});

const history = [
  { id: '1', session_id: 'a', role: 'user', content: 'first question', created_at: '2026-10-01T10:00:00' },
  { id: '2', session_id: 'a', role: 'assistant', content: 'first answer', created_at: '2026-10-01T10:00:05' },
  { id: '3', session_id: 'b', role: 'user', content: 'second question', created_at: '2026-10-02T10:00:00' },
];

test('the welcome message is a complete sentence', async () => {
  API.chat.history.mockResolvedValue([]);

  render(<ChatDrawer token="tok" onClose={jest.fn()} />);

  expect(await screen.findByText(/What's on your mind today/)).toBeInTheDocument();
  expect(screen.queryByText(/help you understand\s*$/m)).not.toBeInTheDocument();
});

test('there is no fake "Online" status, and the AI-not-a-doctor notice is always visible', async () => {
  API.chat.history.mockResolvedValue([]);

  render(<ChatDrawer token="tok" onClose={jest.fn()} />);

  await screen.findByText(/What's on your mind today/);
  expect(screen.queryByText('Online')).not.toBeInTheDocument();
  expect(screen.getByText(/AI companion, not a doctor/i)).toBeInTheDocument();
});

test('the input placeholder is short enough not to be clipped', async () => {
  API.chat.history.mockResolvedValue([]);

  render(<ChatDrawer token="tok" onClose={jest.fn()} />);

  const box = await screen.findByPlaceholderText(/Ask Luna/i);
  expect(box.getAttribute('placeholder').length).toBeLessThanOrEqual(32);
});

test('phone users can open and close the conversation history', async () => {
  API.chat.history.mockResolvedValue(history);

  render(<ChatDrawer token="tok" onClose={jest.fn()} />);

  const toggle = await screen.findByRole('button', { name: /history/i });
  const panel = document.querySelector('.chat-hist-panel');
  expect(panel).not.toHaveClass('open');

  userEvent.click(toggle);
  expect(panel).toHaveClass('open');

  userEvent.click(toggle);
  expect(panel).not.toHaveClass('open');
});

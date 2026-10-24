import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { consents: { get: jest.fn(), set: jest.fn() } },
}));

const { API } = require('./api');
const useConsents = require('./useConsents').default;
const RequiredConsentScreen = require('./RequiredConsentScreen').default;
const AiConsentModal = require('./AiConsentModal').default;

beforeEach(() => jest.clearAllMocks());

function Probe({ token }) {
  const { consents, error, setConsent } = useConsents(token);
  return (
    <div>
      <div data-testid="state">{error ? `error:${error}` : consents ? JSON.stringify(consents) : 'loading'}</div>
      <button onClick={() => setConsent('ai_processing', true)}>grant</button>
    </div>
  );
}

describe('useConsents', () => {
  test('loads the consents for the token', async () => {
    API.consents.get.mockResolvedValue({ terms_privacy: true, ai_processing: false });

    render(<Probe token="tok" />);

    expect(screen.getByTestId('state')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('"terms_privacy":true'));
    expect(API.consents.get).toHaveBeenCalledWith('tok');
  });

  test('reports a load failure instead of staying on loading', async () => {
    API.consents.get.mockRejectedValue(new Error('Network down'));

    render(<Probe token="tok" />);

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error:Network down'));
  });

  test('setConsent posts the change and adopts the server answer', async () => {
    API.consents.get.mockResolvedValue({ ai_processing: false });
    API.consents.set.mockResolvedValue({ ai_processing: true });
    render(<Probe token="tok" />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('"ai_processing":false'));

    userEvent.click(screen.getByText('grant'));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('"ai_processing":true'));
    expect(API.consents.set).toHaveBeenCalledWith('ai_processing', true, 'tok');
  });
});

describe('RequiredConsentScreen', () => {
  test('cannot continue until both boxes are ticked', () => {
    render(<RequiredConsentScreen onSubmit={jest.fn()} onLogout={jest.fn()} />);
    const go = screen.getByRole('button', { name: /continue/i });

    expect(go).toBeDisabled();
    userEvent.click(screen.getByLabelText(/18 years/i));
    expect(go).toBeDisabled();
    userEvent.click(screen.getByLabelText(/agree to the/i));
    expect(go).toBeEnabled();
  });

  test('submits once ticked and shows a server error without losing the form', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Server unavailable'));
    render(<RequiredConsentScreen onSubmit={onSubmit} onLogout={jest.fn()} />);
    userEvent.click(screen.getByLabelText(/18 years/i));
    userEvent.click(screen.getByLabelText(/agree to the/i));

    userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/Server unavailable/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  test('offers sign out', () => {
    const onLogout = jest.fn();
    render(<RequiredConsentScreen onSubmit={jest.fn()} onLogout={onLogout} />);

    userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(onLogout).toHaveBeenCalled();
  });
});

describe('AiConsentModal', () => {
  test('explains the third-party processing', () => {
    render(<AiConsentModal onGrant={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByText(/Groq/)).toBeInTheDocument();
    expect(screen.getByText(/Hugging Face/)).toBeInTheDocument();
    expect(screen.getByText(/outside India/i)).toBeInTheDocument();
  });

  test('allowing calls onGrant, blocks "Not now" while saving, then declining closes', async () => {
    let finish;
    const onGrant = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const onClose = jest.fn();
    render(<AiConsentModal onGrant={onGrant} onClose={onClose} />);

    userEvent.click(screen.getByRole('button', { name: /allow ai features/i }));
    await waitFor(() => expect(onGrant).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /not now/i })).toBeDisabled();

    await act(async () => { finish(); });
    await waitFor(() => expect(screen.getByRole('button', { name: /not now/i })).toBeEnabled());
    userEvent.click(screen.getByRole('button', { name: /not now/i }));
    expect(onClose).toHaveBeenCalled();
  });

  test('shows the error when granting fails and stays open', async () => {
    const onGrant = jest.fn().mockRejectedValue(new Error('Could not save'));
    render(<AiConsentModal onGrant={onGrant} onClose={jest.fn()} />);

    userEvent.click(screen.getByRole('button', { name: /allow ai features/i }));

    expect(await screen.findByText(/Could not save/)).toBeInTheDocument();
  });
});

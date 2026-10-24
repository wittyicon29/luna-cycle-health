import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  API: { verify: { verify: jest.fn() } },
}));

const { API, ApiError } = require('./api');
const EmailVerification = require('./EmailVerification').default;

function renderPage(url, strict = true) {
  const page = (
    <MemoryRouter initialEntries={[url]}>
      <EmailVerification />
    </MemoryRouter>
  );
  return render(strict ? <React.StrictMode>{page}</React.StrictMode> : page);
}

beforeEach(() => jest.clearAllMocks());

test('the single-use token is sent exactly once, even under StrictMode', async () => {
  API.verify.verify.mockResolvedValue({ message: 'Email verified successfully!' });

  renderPage('/verify-email?token=tok-1');

  expect(await screen.findByText('Email Verified!')).toBeInTheDocument();
  expect(API.verify.verify).toHaveBeenCalledTimes(1);
  expect(API.verify.verify).toHaveBeenCalledWith('tok-1');
});

test('an invalid token shows the failure screen', async () => {
  API.verify.verify.mockRejectedValue(new ApiError('Invalid or expired verification token', { status: 400 }));

  renderPage('/verify-email?token=bad');

  expect(await screen.findByText('Verification Failed')).toBeInTheDocument();
  expect(screen.getByText('Invalid or expired verification token')).toBeInTheDocument();
});

test('a link without a token never calls the server', async () => {
  renderPage('/verify-email');

  expect(await screen.findByText('Verification Failed')).toBeInTheDocument();
  expect(API.verify.verify).not.toHaveBeenCalled();
});

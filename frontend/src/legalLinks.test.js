import React from 'react';
import { render, screen } from '@testing-library/react';

import ConsentCheckboxes from './ConsentCheckboxes';

test('the sign-up policy links use the readable legal-link style', () => {
  render(<ConsentCheckboxes adult={false} accepted={false} onAdultChange={() => {}} onAcceptedChange={() => {}} />);

  expect(screen.getByRole('link', { name: 'Terms' })).toHaveClass('legal-link');
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveClass('legal-link');
});

test('the legal-link style is defined with a readable colour', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, 'App.js'), 'utf8');

  expect(app).toMatch(/\.legal-link\{[^}]*color:#E8A09A/);
});

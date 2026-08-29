import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VersionBadge from './VersionBadge';

// `define` in vite.config.ts is shared with vitest, so the globals are real strings here.
describe('build-time version globals', () => {
  it('are all defined as strings', () => {
    expect(typeof __APP_VERSION__).toBe('string');
    expect(typeof __GIT_SHA__).toBe('string');
    expect(typeof __GIT_REF__).toBe('string');
    expect(typeof __BUILD_ENV__).toBe('string');
    expect(__APP_VERSION__.length).toBeGreaterThan(0);
  });
});

describe('VersionBadge', () => {
  it('renders the version prefixed with v', () => {
    render(<VersionBadge />);
    expect(screen.getByText(new RegExp(`^v${__APP_VERSION__}`))).toBeInTheDocument();
  });
});

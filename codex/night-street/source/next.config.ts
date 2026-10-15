import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* The capture harness attaches over the loopback address rather than the
   * `localhost` hostname, and Next 16's dev server refuses to serve its own
   * chunks to an origin it was not told about — it answers 403 and the page
   * boots into a blank canvas with no error that points at the cause. */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  ...(process.env.NIGHT_STREET_PAGES === '1' ? {
    output: 'export' as const,
    basePath: '/GoodCase.xAI/codex/night-street',
    trailingSlash: true,
    images: { unoptimized: true },
  } : {}),
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const workspacePackages = [
  '@ops/core',
  '@ops/chains',
  '@ops/contracts',
  '@ops/strategy-engine',
  '@ops/permit2',
  '@ops/eip712',
  '@ops/audit',
  '@ops/approvals',
  '@ops/telemetry',
  '@ops/ui',
  '@ops/service-api',
  '@ops/service-telegram-approvals',
  '@ops/service-scanner',
  '@ops/service-relayer',
  '@ops/service-indexer',
  '@ops/service-worker',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship raw TypeScript sources with ESM-style .js imports.
  transpilePackages: workspacePackages,
  webpack(config) {
    // Resolve "./foo.js" to "./foo.ts" / "./foo.tsx" for workspace sources.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;

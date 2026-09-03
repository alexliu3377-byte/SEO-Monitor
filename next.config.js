/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  serverExternalPackages: ['cheerio', 'xml2js'],
  async headers() {
    const isProduction = process.env.NODE_ENV === 'production'
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"} https://challenges.cloudflare.com`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://images.unsplash.com",
          "font-src 'self' data:",
          `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com${isProduction ? '' : ' ws://localhost:* ws://127.0.0.1:*'}`,
          "frame-src https://challenges.cloudflare.com",
          "worker-src 'self' blob:",
          isProduction ? "upgrade-insecure-requests" : '',
        ].filter(Boolean).join('; '),
      },
    ]
    if (isProduction) {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      })
    }
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  async redirects() {
    return [
      { source: '/rules', destination: '/research', permanent: true },
    ]
  },
}

module.exports = nextConfig

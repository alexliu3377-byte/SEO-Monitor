/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['cheerio', 'xml2js'],
  },
  async redirects() {
    return [
      { source: '/rules', destination: '/research', permanent: true },
    ]
  },
}

module.exports = nextConfig

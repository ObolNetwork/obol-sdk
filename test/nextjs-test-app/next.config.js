/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // Provide minimal process shim for browser
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.stdout.isTTY': 'false',
          'process.stderr.isTTY': 'false',
        })
      );
    }
    return config;
  },
}

module.exports = nextConfig



/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // Browser: Define process
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.stdout.isTTY': 'false',
          'process.stderr.isTTY': 'false',
        })
      );
    } else {
      // Server: Externalize packages with native dependencies
      config.externals = config.externals || [];
      config.externals.push({
        '@chainsafe/bls': 'commonjs @chainsafe/bls',
        '@chainsafe/blst': 'commonjs @chainsafe/blst',
        'bcrypto': 'commonjs bcrypto',
      });
    }
    
    // Ignore .node files
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /\.node$/,
      })
    );
    
    return config;
  },
}

module.exports = nextConfig



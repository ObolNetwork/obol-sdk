/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    esmExternals: 'loose'
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // Client-side: disable Node.js modules
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        os: false,
        stream: false,
        util: false,
        buffer: false,
        process: false,
      };
      
      // Define process for browser to avoid isTTY errors
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.stdout': JSON.stringify({ isTTY: false }),
          'process.stderr': JSON.stringify({ isTTY: false }),
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        })
      );
    } else {
      // Server-side: use commonjs externals
      config.externals = config.externals || [];
      config.externals.push({
        '@chainsafe/bls': 'commonjs @chainsafe/bls',
        '@chainsafe/blst': 'commonjs @chainsafe/blst',
        'bcrypto': 'commonjs bcrypto',
      });
    }

    // Ignore .node files in both client and server
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /\.node$/,
      })
    );

    return config;
  },
}

module.exports = nextConfig



module.exports = {
    // This will lint and format TypeScript
    '**/*.(ts|tsx)': filenames => [
      `npx eslint --fix ${filenames.join(' ')}`,
      `npx prettier --write ${filenames.join(' ')}`,
    ],
  }

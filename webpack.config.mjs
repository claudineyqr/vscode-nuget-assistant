//@ts-check

'use strict';

import { dirname, resolve as _resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('webpack').Configuration} */
const config = {
  target: 'node',
  entry: './src/extension/extension.ts',
  output: {
    path: _resolve(__dirname, 'dist', 'src', 'extension'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /\.spec\.ts$/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: _resolve(__dirname, 'tsconfig.ext.json'),
              compilerOptions: {
                module: 'es6',
              },
            },
          },
        ],
      },
    ],
  },
};

export default config;

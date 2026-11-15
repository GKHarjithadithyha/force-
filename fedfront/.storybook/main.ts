import type { StorybookConfig } from '@storybook/react-vite';
import path from 'node:path';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: { name: '@storybook/react-vite', options: {} },
  async viteFinal(viteConfig) {
    return { ...viteConfig, resolve: { ...viteConfig.resolve, alias: { ...viteConfig.resolve?.alias, '@': path.resolve(__dirname, '..') } } };
  },
  docs: { autodocs: 'tag' },
};
export default config;

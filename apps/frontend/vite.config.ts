import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
	plugins: [
		tailwindcss(),
		nodePolyfills({
			exclude: ['module'],
			globals: { Buffer: true, global: true, process: true }
		}),
		sveltekit({
			adapter: adapter({
				fallback: '200.html'
			})
		})
	],
	server: {
		https: fs.existsSync('.dev-cert.pem')
			? { key: fs.readFileSync('.dev-key.pem'), cert: fs.readFileSync('.dev-cert.pem') }
			: undefined
	}
});

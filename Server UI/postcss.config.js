import tailwindcss from '../frontend/node_modules/tailwindcss/lib/index.js';
import autoprefixer from '../frontend/node_modules/autoprefixer/lib/autoprefixer.js';
import tailwindConfig from './tailwind.config.js';

export default {
  plugins: [tailwindcss(tailwindConfig), autoprefixer()],
};

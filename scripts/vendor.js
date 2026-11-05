// Copies the browser build of supabase-js from node_modules into public/vendor (after npm install / update).
import fs from 'node:fs';
const from = new URL('../node_modules/@supabase/supabase-js/', import.meta.url);
const to = new URL('../public/vendor/', import.meta.url);
const js = fs.readFileSync(new URL('dist/umd/supabase.js', from), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/m, '');
fs.writeFileSync(new URL('supabase.js', to), js);
fs.copyFileSync(new URL('LICENSE', from), new URL('supabase.LICENSE', to));
console.log(`Copied supabase-js ${JSON.parse(fs.readFileSync(new URL('package.json', from))).version} to public/vendor/`);

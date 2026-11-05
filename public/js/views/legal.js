// About & credits, Privacy Policy, Terms of Use.
// Plain-language policies for a small, free, non-commercial student project. Not legal advice;
// review before making changes to what data is collected.
import { siteConfig } from '../backend.js';
import { pageHeader } from '../components.js';
import { h } from '../ui.js';
import { footer } from './home.js';

const UPDATED = 'November 5, 2026';
const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const contact = () => siteConfig.contactEmail
  ? h('a', { href: `mailto:${siteConfig.contactEmail}` }, siteConfig.contactEmail)
  : 'the contact address listed on this page once it’s published';
const section = (title, ...body) => h('section', { class: 'card prose' }, h('h2', {}, title), ...body);
const ul = (...items) => h('ul', {}, items.map(i => h('li', {}, i)));

export function about(root) {
  const esri = !!siteConfig.esriApiKey;
  root.append(
    pageHeader('About & credits', { back: '#/' }),
    section('PolySpot',
      h('p', {}, 'A daily photo game for Cal Poly Pomona: look at a photo taken somewhere on campus, then guess where the photographer stood and which way the camera faced.'),
      h('p', { class: 'muted' }, 'An independent student project. Not affiliated with, sponsored by, or endorsed by California State Polytechnic University, Pomona, the California State University, or GeoGuessr. No university logos or marks are used.'),
      h('p', {}, 'PolySpot’s code is open source under the ', link('LICENSE.txt', 'MIT License'), '. Full notices: ', link('THIRD_PARTY_NOTICES.txt', 'third-party notices'), '.')),
    section('Map imagery & data',
      h('ul', {},
        h('li', {}, 'Satellite (USGS): imagery from USDA and ', link('https://www.usgs.gov/programs/national-geospatial-program/national-map', 'USGS The National Map'), '.'),
        esri ? h('li', {}, 'Satellite (Esri): Powered by ', link('https://www.esri.com', 'Esri'), '. Esri, Maxar, Earthstar Geographics, and the GIS User Community.') : null,
        h('li', {}, 'Street map: © ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), '.'),
        h('li', {}, 'Building names: © ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), ', available under the ', link('https://opendatacommons.org/licenses/odbl/', 'Open Database License'), '.'))),
    section('Software',
      h('ul', {},
        h('li', {}, link('https://leafletjs.com', 'Leaflet'), ' 1.9.4: © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade. ', link('vendor/leaflet/LICENSE', 'BSD 2-Clause License'), '.'),
        h('li', {}, link('https://github.com/supabase/supabase-js', 'supabase-js'), ': © 2020 Supabase. ', link('vendor/supabase.LICENSE', 'MIT License'), '.'),
        h('li', {}, link('https://github.com/kazuhikoarase/qrcode-generator', 'qrcode-generator'), ': © 2009 Kazuhiko Arase. ', link('vendor/qrcode-generator.LICENSE', 'MIT License'), '. “QR Code” is a registered trademark of DENSO WAVE INCORPORATED.'))),
    section('Hosting', h('p', {}, 'The site is hosted on GitHub Pages; accounts, scores and photos are stored with Supabase.')),
    footer(),
  );
}

export function privacy(root) {
  root.append(
    pageHeader('Privacy policy', { back: '#/', sub: `Last updated ${UPDATED}` }),
    section('The short version',
      ul('We use Google sign-in only to know it’s you. Other players see the name you choose, never your email.',
        'We store your email, account ID, chosen name and guesses. That’s it: no ads, no analytics, no tracking cookies.',
        'We don’t sell or share your personal information.',
        'You can delete your account and all your scores at any time from the “You” page.')),
    section('Who runs PolySpot',
      h('p', {}, 'PolySpot is a free, non-commercial student project. It is not run by Cal Poly Pomona. Questions or requests: ', contact(), '.')),
    section('What we collect',
      ul(
        [h('strong', {}, 'From Google, when you sign in: '), 'your email address and a unique account ID. Google also sends your name and profile picture; our sign-in provider stores them with your account, but PolySpot doesn’t display or use them.'],
        [h('strong', {}, 'Your leaderboard name: '), 'the name you choose. It’s public.'],
        [h('strong', {}, 'Your guesses: '), 'where you guessed, which way, your score and when. Your score, distance and angle on a day’s round are shown on the public leaderboard next to your chosen name.'],
        [h('strong', {}, 'In your browser: '), 'we keep your sign-in session and a few display preferences in your browser’s local storage. We don’t use advertising or tracking cookies, and we don’t run analytics.'],
        [h('strong', {}, 'Normal web traffic: '), 'like any website, the services that deliver this site (GitHub Pages), its data (Supabase) and its maps (USGS, OpenStreetMap, and Esri if enabled) receive your IP address and browser details when your browser contacts them. Their own privacy policies apply to that.'])),
    section('How we use it',
      ul('To run the game: sign you in, score your guesses, keep one try per daily round, and show leaderboards.',
        'To keep it fair and friendly: spot cheating and remove offensive names.',
        'We don’t use your information for advertising, and we don’t sell or share it.')),
    section('Who processes it for us',
      ul(['Supabase (database and sign-in): ', link('https://supabase.com/privacy', 'privacy policy')],
        ['Google (sign-in): ', link('https://policies.google.com/privacy', 'privacy policy'), '. PolySpot’s use of information received from Google follows the ', link('https://developers.google.com/terms/api-services-user-data-policy', 'Google API Services User Data Policy'), ', including its Limited Use requirements.'],
        ['GitHub Pages (website hosting): ', link('https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement', 'privacy statement')])),
    section('How long we keep it',
      h('p', {}, 'Until you delete your account. Deleting it (on the “You” page) immediately removes your name, guesses and sign-in record from our database. Copies in our providers’ backups, if any, expire on their schedule.')),
    section('Your choices and rights',
      ul('Change your leaderboard name or delete your account at any time in the app.',
        ['To ask what we hold about you, or to correct or delete it, contact ', contact(), '.'],
        'California residents have rights under the CCPA/CPRA, including to know, delete and correct personal information, and to not be discriminated against for using them. We do not sell or share personal information as those laws define it.')),
    section('Photos',
      h('p', {}, 'Round photos are taken by the PolySpot admins in places on and around campus. We avoid photographing people. If you appear in a photo and want it removed, contact ', contact(), ' and we’ll take it down.')),
    section('Children',
      h('p', {}, 'PolySpot is meant for college students and isn’t directed to children under 13. Please don’t create an account if you’re under 13. If we learn we have data from a child under 13, we’ll delete it.')),
    section('Changes',
      h('p', {}, 'If we change this policy we’ll update the date at the top. Significant changes will be announced on the home page.')),
    footer(),
  );
}

export function terms(root) {
  root.append(
    pageHeader('Terms of use', { back: '#/', sub: `Last updated ${UPDATED}` }),
    section('The deal',
      h('p', {}, 'PolySpot is a free game made by students for fun. By using it you agree to these terms and the ', h('a', { href: '#/privacy' }, 'privacy policy'), '. If you don’t agree, please don’t use it.')),
    section('Who can play',
      ul('You must be at least 13.', 'One account per person, using your own Google account.', 'Follow Cal Poly Pomona’s rules and the law when you’re on campus. Never trespass, go into closed areas, or put yourself in danger to find a spot.')),
    section('Names',
      h('p', {}, 'Your leaderboard name is public. Don’t use names that are offensive, hateful, sexual, that impersonate someone, or that include personal information. Admins may hide any name, and may remove accounts that break these rules.')),
    section('Fair play',
      ul('Don’t share the answer to the day’s round before the day ends.', 'Don’t use scripts or bots, or try to get around the one-try rule.', 'Don’t try to break, overload, or get into parts of the site you aren’t meant to. If you find a bug, please tell us.'),
      h('p', {}, 'We may remove scores or accounts that we believe were gained unfairly.')),
    section('Content and credits',
      h('p', {}, 'Round photos belong to their photographers (the PolySpot admins); please don’t reuse them elsewhere without asking. Map imagery and data belong to their providers and are credited on the map and on the ', h('a', { href: '#/about' }, 'About & credits'), ' page. PolySpot’s source code is available under the MIT License.')),
    section('No guarantees',
      h('p', {}, 'PolySpot is provided “as is”, without warranties of any kind. It may be unavailable, change, lose data, or end at any time. To the extent the law allows, the people who run PolySpot aren’t liable for any damages from using it.'),
      h('p', {}, 'PolySpot is not affiliated with, sponsored by, or endorsed by Cal Poly Pomona, the California State University, or GeoGuessr.')),
    section('Changes and contact',
      h('p', {}, 'We may update these terms; the date at the top shows the latest version. Questions: ', contact(), '.')),
    footer(),
  );
}

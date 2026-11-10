// About & credits, Privacy Policy, Terms of Use.
// Review the policies before changing what data the site collects or how it is used.
import { siteConfig } from '../backend.js';
import { pageHeader } from '../components.js';
import { h } from '../ui.js';
import { footer } from './home.js';

const EFFECTIVE = 'November 10, 2026';
const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const contact = () => siteConfig.contactEmail
  ? h('a', { href: `mailto:${siteConfig.contactEmail}` }, siteConfig.contactEmail)
  : 'the contact address published on this site';
const section = (title, ...body) => h('section', { class: 'card prose' }, h('h2', {}, title), ...body);
const ul = (...items) => h('ul', {}, items.map(i => h('li', {}, i)));
const p = (...kids) => h('p', {}, ...kids);
const term = (t, ...rest) => [h('strong', {}, t), ' ', ...rest];

export function about(root) {
  const esri = !!siteConfig.esriApiKey;
  root.append(
    pageHeader('About & credits', { back: '#/' }),
    section('CampusSpot',
      h('p', {}, 'A daily photo game for California college campuses: pick your campus, look at a photo taken somewhere on it, then guess where the photographer stood and which way the camera faced.'),
      h('p', { class: 'muted' }, 'An independent student project. Not affiliated with, sponsored by, or endorsed by any college or university, the University of California, the California State University, the California Community Colleges, or GeoGuessr. School names are used only to say where photos were taken; no school logos or marks are used.'),
      h('p', {}, 'The list of campuses and their locations comes from U.S. Department of Education data (IPEDS and the College Scorecard), which is in the public domain.'),
      h('p', {}, 'CampusSpot’s code is open source under the ', link('LICENSE.txt', 'MIT License'), '. Full notices: ', link('THIRD_PARTY_NOTICES.txt', 'third-party notices'), '.')),
    section('Map imagery & data',
      h('ul', {},
        h('li', {}, 'Satellite (USGS): imagery from USDA and ', link('https://www.usgs.gov/programs/national-geospatial-program/national-map', 'USGS The National Map'), '.'),
        esri ? h('li', {}, 'Satellite (Esri): Powered by ', link('https://www.esri.com', 'Esri'), '. Esri, Maxar, Earthstar Geographics, and the GIS User Community.') : null,
        h('li', {}, 'Street map: © ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), '.'),
        h('li', {}, 'Building names: © ', link('https://www.openstreetmap.org/copyright', 'OpenStreetMap contributors'), ', available under the ', link('https://opendatacommons.org/licenses/odbl/', 'Open Database License'), '.'))),
    section('Software',
      h('ul', {},
        h('li', {}, link('https://leafletjs.com', 'Leaflet'), ' 1.9.4: © 2010–2023 Volodymyr Agafonkin, © 2010–2011 CloudMade. ', link('vendor/leaflet/LICENSE', 'BSD 2-Clause License'), '.'),
        h('li', {}, link('https://github.com/supabase/supabase-js', 'supabase-js'), ': © 2020 Supabase. ', link('vendor/supabase.LICENSE', 'MIT License'), '.'))),
    section('Hosting', h('p', {}, 'The site is hosted on GitHub Pages; accounts, scores and photos are stored with Supabase.')),
    footer(),
  );
}

export function privacy(root) {
  root.append(
    pageHeader('Privacy Policy', { back: '#/', sub: `Effective ${EFFECTIVE}` }),
    section('1. Introduction',
      p('This Privacy Policy describes how CampusSpot (“CampusSpot”, “we”, “us” or “our”) collects, uses, discloses and protects information in connection with the CampusSpot website and game (the “Service”). By using the Service, you acknowledge that you have read and understood this Privacy Policy.'),
      p('CampusSpot is an independent, non-commercial project. It is not operated by, affiliated with, or endorsed by any college or university.')),
    section('2. Information We Collect',
      p('We collect the following categories of information:'),
      ul(
        term('Account information.', 'If you sign in with Google, we receive your email address and a unique account identifier from Google. Google may also provide your name and profile picture, which our authentication provider stores with your account; the Service does not display or otherwise use them.'),
        term('Display name.', 'The leaderboard name you choose. Your display name is public.'),
        term('Campus and graduation year.', 'The campus you join, and, if you choose to add it, your graduation year. Both are shown publicly with your display name on that campus’s leaderboards. If you play without signing in, the campus you pick is kept only in your browser.'),
        term('Contributor information.', 'If you ask to become a contributor: your request note, the photographs you submit, where and in which direction you say each was taken, and the review decisions on them. Administrators see your email address alongside your requests and submissions.'),
        term('Gameplay information.', 'For signed-in players: the location and direction of each guess, the resulting score, and the time it was made. Scores, distances and angles for the daily round are shown publicly on the leaderboard alongside your display name. Guesses made without signing in are scored but not stored.'),
        term('Technical information.', 'When your browser loads the Service, the providers that host the website, database and maps (listed in Section 5) receive standard technical information, such as your IP address, browser type and the time of the request, as part of ordinary web traffic.'),
        term('Local storage.', 'We store your sign-in session and a small number of display preferences in your browser’s local storage. We do not use advertising or tracking cookies, and we do not use analytics services.'))),
    section('3. How We Use Information',
      p('We use the information described above solely to:'),
      ul('provide and operate the Service, including authenticating users, scoring guesses and displaying leaderboards;',
        'enforce the one-ranked-attempt-per-day rule and otherwise maintain fair play;',
        'moderate display names and enforce our Terms of Use;',
        'respond to your inquiries and requests; and',
        'maintain the security and integrity of the Service.'),
      p('We do not use your information for advertising, and we do not sell your information.')),
    section('4. Google User Data',
      p('The Service’s use and transfer of information received from Google APIs adheres to the ', link('https://developers.google.com/terms/api-services-user-data-policy', 'Google API Services User Data Policy'), ', including the Limited Use requirements. We request only the basic profile scopes (email, profile and OpenID) and use the resulting information only to sign you in and identify your account.')),
    section('5. Service Providers and Disclosure',
      p('We share information only with service providers that process it on our behalf to operate the Service:'),
      ul(['Supabase, Inc. (database, authentication and photo storage): ', link('https://supabase.com/privacy', 'Privacy Policy')],
        ['Google LLC (sign-in): ', link('https://policies.google.com/privacy', 'Privacy Policy')],
        ['GitHub, Inc. (website hosting): ', link('https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement', 'Privacy Statement')],
        'Map imagery and data providers (U.S. Geological Survey, Esri and the OpenStreetMap Foundation), which receive standard technical information when your browser requests map images.'),
      p('We may also disclose information if required to do so by law, or where we believe in good faith that disclosure is necessary to protect the rights, property or safety of CampusSpot, its users or others.')),
    section('6. Data Retention and Deletion',
      p('We retain account and gameplay information for as long as your account exists. You may delete your account at any time from the “You” page. Deletion immediately and permanently removes your display name, guesses, scores and sign-in record from our database. Residual copies in our providers’ backups, if any, are removed according to those providers’ retention schedules.')),
    section('7. Your Rights',
      p('You may change your display name or delete your account at any time within the Service. You may also contact us to request access to, correction of, or deletion of your personal information.'),
      p('If you are a California resident, you may have rights under the California Consumer Privacy Act, as amended by the California Privacy Rights Act, including the right to know, delete and correct personal information, and the right not to be discriminated against for exercising these rights. We do not sell or share personal information as those terms are defined under California law.')),
    section('8. Children’s Privacy',
      p('The Service is not directed to children under the age of 13, and we do not knowingly collect personal information from children under 13. If we learn that we have collected such information, we will delete it promptly.')),
    section('9. Photographs',
      p('Round photographs are taken by CampusSpot administrators and by approved contributors in publicly accessible locations. Every contributed photograph is reviewed by an administrator before it is published, and we take care to avoid publishing photographs of identifiable individuals. If you believe a photograph depicts you or your property and would like it removed, please contact us and we will review and act on your request promptly.')),
    section('10. Security',
      p('We use reasonable technical and organizational measures to protect information, including access controls that limit what each user can read or change. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.')),
    section('11. Changes to This Policy',
      p('We may update this Privacy Policy from time to time. The effective date above indicates when it was last revised. Material changes will be announced on the Service.')),
    section('12. Contact',
      p('Questions or requests regarding this Privacy Policy may be sent to ', contact(), '.')),
    footer(),
  );
}

export function terms(root) {
  root.append(
    pageHeader('Terms of Use', { back: '#/', sub: `Effective ${EFFECTIVE}` }),
    section('1. Acceptance of Terms',
      p('These Terms of Use (the “Terms”) govern your access to and use of the CampusSpot website and game (the “Service”). By accessing or using the Service, you agree to be bound by these Terms and by our ', h('a', { href: '#/privacy' }, 'Privacy Policy'), '. If you do not agree, you may not use the Service.')),
    section('2. Eligibility',
      p('You must be at least 13 years of age to use the Service. By creating an account, you represent that you meet this requirement and that you will use only your own Google account.')),
    section('3. Accounts and Display Names',
      p('You are responsible for activity that occurs under your account. Display names must not be offensive, hateful, harassing, sexually explicit, misleading, or impersonate any person or organization, and must not contain personal information. CampusSpot may hide or remove any display name, and may suspend or terminate any account, at its sole discretion.')),
    section('4. Acceptable Use',
      p('You agree not to:'),
      ul('share or publish the answer to the daily round before that round has ended;',
        'use scripts, bots or other automated means to access or play the Service;',
        'circumvent the one-ranked-attempt-per-day rule or otherwise manipulate scores or leaderboards;',
        'attempt to gain unauthorized access to the Service, its data or its systems, or interfere with its operation; or',
        'trespass, enter restricted areas, or endanger yourself or others in connection with the Service.'),
      p('CampusSpot may remove scores or accounts that it reasonably believes were obtained in violation of these Terms.')),
    section('5. Campus Conduct',
      p('When on any campus, you remain subject to that institution’s policies and to all applicable laws. Nothing in the Service grants permission to access any area of a campus.')),
    section('6. Contributed Photographs',
      p('If you submit a photograph, you represent that you took it yourself, that it was taken from a publicly accessible location, and that it does not show identifiable people, license plates, identification documents, room numbers or other personal information. You keep ownership of your photographs, and you grant CampusSpot a worldwide, royalty-free, non-exclusive license to host, display and use them, and the answers you provide, to operate the Service. You may ask us to remove a photograph you submitted at any time. Administrators may decline, schedule, edit the details of, or remove any submission, and may revoke contributor access, at their discretion.')),
    section('7. Intellectual Property',
      p('Round photographs are owned by their photographers and may not be reproduced or redistributed without permission. College and university names belong to their respective institutions and are used only to identify where photographs were taken. Map imagery and data are the property of their respective providers and are credited on the map and on the ', h('a', { href: '#/about' }, 'About & credits'), ' page. The Service’s source code is made available under the MIT License.')),
    section('8. Disclaimer of Warranties',
      p('THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE OR NON-INFRINGEMENT. CAMPUSSPOT DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE OR SECURE, OR THAT ANY DATA WILL BE PRESERVED.')),
    section('9. Limitation of Liability',
      p('TO THE FULLEST EXTENT PERMITTED BY LAW, CAMPUSSPOT AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, ARISING OUT OF OR RELATING TO YOUR USE OF, OR INABILITY TO USE, THE SERVICE.')),
    section('10. Changes to the Service and These Terms',
      p('CampusSpot may modify, suspend or discontinue the Service, in whole or in part, at any time without notice. We may revise these Terms from time to time; the effective date above indicates the latest version. Your continued use of the Service after a revision constitutes acceptance of the revised Terms.')),
    section('11. Disclaimer of Affiliation',
      p('CampusSpot is an independent project and is not affiliated with, sponsored by, or endorsed by any college or university, the University of California, the California State University, the California Community Colleges, or GeoGuessr AB.')),
    section('12. Governing Law',
      p('These Terms are governed by the laws of the State of California, without regard to its conflict-of-laws principles.')),
    section('13. Contact',
      p('Questions about these Terms may be sent to ', contact(), '.')),
    footer(),
  );
}

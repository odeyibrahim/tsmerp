// Shared app state (set by app.js at boot). Pages import this instead of passing context around.
export const state = {
    db: null,          // client from sb.js
    user: null,
    company: null,
    role: null,
    companies: [],     // [{ company, role }]
    rerender: () => {},
    navigate: (path) => { location.hash = '#' + path; }
};
export const BRAND = 'NaijaHaul';   // working name — change here (and in the HTML <title>/manifest) to rebrand

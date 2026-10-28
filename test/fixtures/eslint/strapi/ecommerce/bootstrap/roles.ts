declare const strapi: { db: { query: (uid: string) => unknown } };

// LOUD: the preset layout of a sanctioned file (presets/ecommerce/bootstrap/roles.ts).
export const roles = strapi.db.query('admin::role');

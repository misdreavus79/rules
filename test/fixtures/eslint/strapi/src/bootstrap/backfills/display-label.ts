declare const strapi: { db: { query: (uid: string) => unknown } };

// LOUD: a both-rows write through the db layer (the sanctioned exception).
export const rows = strapi.db.query('api::product.product');

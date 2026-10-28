declare const strapi: { db: { query: (uid: string) => unknown } };

export const fake = strapi.db.query('api::product.product');

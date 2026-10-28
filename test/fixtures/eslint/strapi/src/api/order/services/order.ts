declare const strapi: {
  db: { query: (uid: string) => unknown };
  entityService: { findMany: (uid: string) => unknown };
  documents: (uid: string) => unknown;
};

export function readOrders(): unknown[] {
  return [
    strapi.db.query('api::order.order'),
    strapi.entityService.findMany('api::order.order'),
    strapi.documents('api::order.order'),
  ];
}

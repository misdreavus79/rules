declare const strapi: Record<string, Record<string, (uid: string) => unknown>>;

export function readOrders(): unknown[] {
  return [
    strapi.db.query('api::order.order'),
    strapi.entityService.findMany('api::order.order'),
    strapi.documents.findMany('api::order.order'),
  ];
}

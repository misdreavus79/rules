import { hasSuperAdminRole } from '@strapi/admin/dist/server/src/domain/user';
import { factories } from '@strapi/strapi';

export const deep = [hasSuperAdminRole, factories];

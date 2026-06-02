import { buildManifest, entity, field, auth } from '@pylonsync/sdk';

const User = entity('User', {
  email: field.string().unique(),
  name: field.string().optional(),
  passwordHash: field.string().serverOnly(),
  isAdmin: field.bool().default(false)
});

const AuditEvent = entity('AuditEvent', {
  eventType: field.string(),
  details: field.string().optional(),
  ipAddress: field.string().optional()
});

export default buildManifest({
  name: 'smolvm-manager',
  version: '0.0.1',
  entities: [User, AuditEvent],
  routes: [],
  queries: [],
  actions: [],
  policies: [],
  auth: auth({
    user: {
      entity: 'User',
      expose: ['id', 'email', 'name', 'isAdmin'],
      hide: ['passwordHash'],
      adminField: 'isAdmin'
    },
    session: {
      expiresIn: 60 * 60 * 24 // 24 hours
    },
    trustedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000']
  })
});

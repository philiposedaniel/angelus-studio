import * as migration_20261015_184125_initial from './20261015_184125_initial';
import * as migration_20261015_191623_client_galleries from './20261015_191623_client_galleries';

export const migrations = [
  {
    up: migration_20261015_184125_initial.up,
    down: migration_20261015_184125_initial.down,
    name: '20261015_184125_initial',
  },
  {
    up: migration_20261015_191623_client_galleries.up,
    down: migration_20261015_191623_client_galleries.down,
    name: '20261015_191623_client_galleries'
  },
];

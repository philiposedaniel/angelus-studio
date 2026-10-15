import * as migration_20261015_184125_initial from './20261015_184125_initial';

export const migrations = [
  {
    up: migration_20261015_184125_initial.up,
    down: migration_20261015_184125_initial.down,
    name: '20261015_184125_initial'
  },
];

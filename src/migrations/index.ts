import * as migration_20261015_184125_initial from './20261015_184125_initial';
import * as migration_20261015_191623_client_galleries from './20261015_191623_client_galleries';
import * as migration_20261015_193142_gallery_downloads from './20261015_193142_gallery_downloads';
import * as migration_20261015_194709_shared_albums from './20261015_194709_shared_albums';

export const migrations = [
  {
    up: migration_20261015_184125_initial.up,
    down: migration_20261015_184125_initial.down,
    name: '20261015_184125_initial',
  },
  {
    up: migration_20261015_191623_client_galleries.up,
    down: migration_20261015_191623_client_galleries.down,
    name: '20261015_191623_client_galleries',
  },
  {
    up: migration_20261015_193142_gallery_downloads.up,
    down: migration_20261015_193142_gallery_downloads.down,
    name: '20261015_193142_gallery_downloads',
  },
  {
    up: migration_20261015_194709_shared_albums.up,
    down: migration_20261015_194709_shared_albums.down,
    name: '20261015_194709_shared_albums'
  },
];

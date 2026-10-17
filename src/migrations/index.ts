import * as migration_20261016_000713_gallery_watermark from './20261016_000713_gallery_watermark';
import * as migration_20261015_184125_initial from './20261015_184125_initial';
import * as migration_20261015_191623_client_galleries from './20261015_191623_client_galleries';
import * as migration_20261015_193142_gallery_downloads from './20261015_193142_gallery_downloads';
import * as migration_20261015_194709_shared_albums from './20261015_194709_shared_albums';
import * as migration_20261015_201137_website_pages from './20261015_201137_website_pages';
import * as migration_20261015_213640_inquiries from './20261015_213640_inquiries';
import * as migration_20261015_235501_quotes_and_payments from './20261015_235501_quotes_and_payments';
import * as migration_20261016_002313_events_guest_albums from './20261016_002313_events_guest_albums';
import * as migration_20261016_004415_event_guests_rsvp from './20261016_004415_event_guests_rsvp';
import * as migration_20261016_013642_projects_crew_tasks from './20261016_013642_projects_crew_tasks';
import * as migration_20261016_064009_call_sheets from './20261016_064009_call_sheets';
import * as migration_20261016_070048_guest_check_in from './20261016_070048_guest_check_in';
import * as migration_20261016_070433_vendors from './20261016_070433_vendors';

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
    name: '20261015_194709_shared_albums',
  },
  {
    up: migration_20261015_201137_website_pages.up,
    down: migration_20261015_201137_website_pages.down,
    name: '20261015_201137_website_pages',
  },
  {
    up: migration_20261015_213640_inquiries.up,
    down: migration_20261015_213640_inquiries.down,
    name: '20261015_213640_inquiries',
  },
  {
    up: migration_20261015_235501_quotes_and_payments.up,
    down: migration_20261015_235501_quotes_and_payments.down,
    name: '20261015_235501_quotes_and_payments',
  },
  {
    up: migration_20261016_002313_events_guest_albums.up,
    down: migration_20261016_002313_events_guest_albums.down,
    name: '20261016_002313_events_guest_albums',
  },
  {
    up: migration_20261016_004415_event_guests_rsvp.up,
    down: migration_20261016_004415_event_guests_rsvp.down,
    name: '20261016_004415_event_guests_rsvp',
  },
  {
    up: migration_20261016_013642_projects_crew_tasks.up,
    down: migration_20261016_013642_projects_crew_tasks.down,
    name: '20261016_013642_projects_crew_tasks',
  },
  {
    up: migration_20261016_064009_call_sheets.up,
    down: migration_20261016_064009_call_sheets.down,
    name: '20261016_064009_call_sheets',
  },
  {
    up: migration_20261016_000713_gallery_watermark.up,
    down: migration_20261016_000713_gallery_watermark.down,
    name: '20261016_000713_gallery_watermark',
  },
  {
    up: migration_20261016_070048_guest_check_in.up,
    down: migration_20261016_070048_guest_check_in.down,
    name: '20261016_070048_guest_check_in',
  },
  {
    up: migration_20261016_070433_vendors.up,
    down: migration_20261016_070433_vendors.down,
    name: '20261016_070433_vendors'
  },
];

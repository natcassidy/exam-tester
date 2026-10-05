import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: {
    id: 'vpc-studio',
    name: 'studio',
    cidr: '10.0.0.0/16',
    azs: [
      { id: 'us-east-1a', name: 'us-east-1a' },
      { id: 'us-east-1b', name: 'us-east-1b' },
    ],
    routeTables: [{ id: 'rtb-private', name: 'rtb-private', routes: [] }],
    subnets: [
      { id: 'data-a', name: 'data-a', cidr: '10.0.20.0/24', az: 'us-east-1a', tier: 'data', routeTableId: 'rtb-private' },
      { id: 'data-b', name: 'data-b', cidr: '10.0.21.0/24', az: 'us-east-1b', tier: 'data', routeTableId: 'rtb-private' },
    ],
  },
  onprem: { name: 'Studio server room', cidr: '192.168.0.0/16', internetMbps: 100 },
};

function targets(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('s3', 'us-east-1', { name: 'footage' })
    .place('rds', 'data-a', { name: 'asset-db' })
    .config('asset-db', { engine: 'postgres', port: 5432, multiAz: true, storageEncrypted: true, backupRetentionDays: 7 });
}

const vpn = (b: BoardBuilder) =>
  b
    .place('vgw', 'vpc-studio', { name: 'studio-vgw' })
    .place('cgw', '', { name: 'studio-router' })
    .place('vpn', '', { name: 'studio-vpn' })
    .config('studio-vpn', { cgwId: 'studio-router', attachTo: 'studio-vgw' })
    .route('rtb-private', '192.168.0.0/16', { vgwName: 'studio-vgw' });
const dms = (b: BoardBuilder, mode: 'full-load' | 'full-load-and-cdc' = 'full-load-and-cdc') => b.place('dms', 'us-east-1', { name: 'db-migration' }).config('db-migration', { targetId: 'asset-db', mode });
const datasync = (b: BoardBuilder) => b.place('datasync', '', { name: 'nas-sync' }).config('nas-sync', { destId: 'footage', schedule: 'daily' });
const snow = (b: BoardBuilder) => b.place('snow', '', { name: 'bulk-snowball' }).config('bulk-snowball', { devices: 1, destId: 'footage' });

const reference = () => dms(datasync(snow(vpn(targets()))));

export const migration80: Mission = {
  id: 'migration80',
  stage: 3,
  mode: 'build',
  title: '80 TB by the end of the lease',
  client: 'Northlight Pictures, an animation studio',
  users: '80 TB of footage on a NAS, a 500 GB Postgres asset database, a 100 Mbps internet line',
  brief:
    "The lease on our server room ends in ten days. We have 80 TB of footage on the NAS and the artists keep working until the last minute, changing about 200 GB a day. Our asset-tracking Postgres database is 500 GB and production can't stop for more than 15 minutes to switch it over. Our internet connection is 100 Mbps and the landlord won't let us pull new fibre. The move plus the first month in AWS has to stay under $3,000.",
  requirements: [
    { id: 'r1', text: 'All 80 TB of footage in S3 within 10 days' },
    { id: 'r2', text: 'Files changed during the move (≈200 GB/day) are not lost' },
    { id: 'r3', text: 'The database moves with ≤ 15 minutes of downtime' },
    { id: 'r4', text: 'Bill for the move and the first month under $3,000', target: { budget: 3000 } },
  ],
  budget: 3000,
  usage: { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 80000, s3GetRequests: 0, s3PutRequests: 2_000_000, flows: [], rdsStorageGb: 500, migrationTb: 80, migrationChangeGb: 2000 },
  defaults: 'helpful',
  layout,
  palette: ['s3', 'rds', 'snow', 'datasync', 'dms', 'vgw', 'cgw', 'vpn', 'dx'],
  events: [
    { id: 'bulk', name: 'The bulk copy', desc: '80 TB of footage, ten days, a 100 Mbps line.', domain: 'performant', concepts: ['snow-family', 'data-migration'], kind: 'migration', params: { scope: 'files', tb: 80, deadlineDays: 10 }, requirementIds: ['r1'] },
    { id: 'delta', name: 'Artists keep working', desc: 'About 200 GB of files change every day until cut-over.', domain: 'resilient', concepts: ['datasync', 'data-migration'], kind: 'migration', params: { scope: 'delta', tb: 80, changeGbPerDay: 200, deadlineDays: 10 }, requirementIds: ['r2'] },
    { id: 'database', name: 'Database cut-over', desc: '500 GB of Postgres that takes writes all day. Production can stop for at most 15 minutes.', domain: 'resilient', concepts: ['dms', 'site-to-site-vpn'], kind: 'migration', params: { scope: 'database', dbGb: 500, maxDowntimeMin: 15, deadlineDays: 10 }, requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: 'The Snowball job, DataSync, DMS and the VPN, plus 80 TB in S3.', domain: 'cost', concepts: ['data-migration', 's3-storage-classes'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  questions: ['q-mg-1', 'q-mg-2', 'q-mg-3', 'q-mg-4', 'q-mg-5'],
  concepts: ['snow-family', 'datasync', 'dms', 'data-migration', 'site-to-site-vpn', 'direct-connect'],
  reference: reference().done(),
  mistakes: [
    { name: 'DataSync over the internet for everything', board: dms(datasync(vpn(targets()))).done(), expectFail: ['bulk', 'bill'] },
    {
      name: 'Order a Direct Connect for the bulk copy',
      board: dms(datasync(vpn(targets())))
        .place('dx', '', { name: 'studio-dx' })
        .config('studio-dx', { speedGbps: 10, attachTo: 'studio-vgw', encryption: 'none' })
        .done(),
      expectFail: ['bulk', 'bill'],
    },
    { name: 'Snowball only, no sync of later changes', board: dms(snow(vpn(targets()))).done(), expectFail: ['delta'] },
    { name: 'DMS full load only', board: dms(datasync(snow(vpn(targets()))), 'full-load').done(), expectFail: ['database'] },
    { name: 'No VPN for DMS to reach the database', board: dms(datasync(snow(targets()))).done(), expectFail: ['database'] },
  ],
  keywords: ['tens of TB, limited bandwidth, deadline → Snowball Edge', 'ongoing sync / incremental transfer → DataSync', 'migrate database with minimal downtime → DMS with CDC', 'Direct Connect takes weeks'],
  hints: ['Do the arithmetic: 80 TB at 100 Mbps', 'A Snowball job for the bulk copy', 'A scheduled DataSync task for the changes', 'DMS with ongoing replication over a VPN'],
};

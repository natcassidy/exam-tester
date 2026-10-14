// Section 15 (CloudFront and Global Accelerator) and section 16 (AWS storage extras).

import type { VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { inRegion, lab, regionOnly, threeTierVpc, usage0 } from './helpers';

// =====================================================================================
// 15a. CloudFront in front of a public bucket (fix): Origin Access Control and a private bucket.
// =====================================================================================

function gallery(): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('s3', '', { name: 'gallery-assets' })
    .place('cloudfront', '', { name: 'gallery-cdn' })
    .config('gallery-cdn', { originId: 'gallery-assets', viewerProtocol: 'redirect-to-https' });
}
const oacRef = () => gallery().config('gallery-cdn', { oac: true }).config('gallery-assets', { policy: 'cloudfront-oac', policyDistributionId: 'gallery-cdn' });
const publicOrigin = () => gallery().config('gallery-cdn', { oac: false }).config('gallery-assets', { blockPublicAccess: false, policy: 'public-read' });

export const oacLab = lab({
  id: 'c-cf-oac',
  course: { section: 15, kind: 'fix', lectures: ['CloudFront Overview', 'CloudFront with S3 - Hands On', 'CloudFront - ALB as an Origin', 'CloudFront - Price Classes'] },
  title: 'The CDN with a back door',
  client: 'Fernhill Gallery, an online art shop',
  users: 'Collectors browsing high-resolution artwork images',
  brief:
    "We put CloudFront in front of our image bucket to speed things up, but the bucket is still public, and scrapers download full-resolution images straight from the S3 URL, skipping the CDN, our logs and our bill caps. Images must load through CloudFront only. The bucket must be locked down, and visitors must always use HTTPS.",
  requirements: [
    { id: 'r1', text: 'Visitors load images through CloudFront' },
    { id: 'r2', text: 'Nobody can download from the bucket URL directly' },
    { id: 'r3', text: 'Block Public Access on, only CloudFront can read, HTTPS only' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['s3', 'cloudfront', 'route53', 'waf'],
  start: { board: publicOrigin().done(), fails: ['direct', 'audit'] },
  events: [
    { id: 'load', name: 'A collector opens a painting', desc: 'A visitor loads an image through the distribution.', domain: 'performant', concepts: ['cloudfront-oac', 'cloudfront-edge'], kind: 'reachability', params: { from: 'internet', to: 'cloudfront', port: 443, expect: 'allow', label: { to: 'the CloudFront distribution' } }, requirementIds: ['r1'] },
    { id: 'direct', name: 'A scraper hits the bucket URL', desc: 'A bot requests https://gallery-assets.s3.amazonaws.com/... directly.', domain: 'secure', concepts: ['s3-block-public-access', 'cloudfront-oac'], kind: 'reachability', params: { from: 'internet', to: 's3', port: 443, expect: 'deny', label: { to: 'the image bucket' } }, requirementIds: ['r2'] },
    { id: 'audit', name: 'Security review', desc: 'Bucket exposure, origin access and HTTPS.', domain: 'secure', concepts: ['s3-block-public-access', 'cloudfront-oac'], kind: 'audit', params: { rules: ['s3BlockPublicAccess', 's3OriginAccessControl', 'httpsOnly'] }, requirementIds: ['r3'] },
  ],
  concepts: ['cloudfront-oac', 's3-block-public-access', 's3-bucket-policy', 'cloudfront-edge'],
  reference: oacRef().done(),
  mistakes: [
    { name: 'Bucket locked, but CloudFront has no OAC', board: gallery().config('gallery-cdn', { oac: false }).done(), expectFail: ['load', 'audit'] },
    { name: 'OAC on, the old public-read policy left in place', board: gallery().config('gallery-cdn', { oac: true }).config('gallery-assets', { blockPublicAccess: false, policy: 'public-read' }).done(), expectFail: ['direct', 'audit'] },
    { name: 'Plain HTTP allowed', board: oacRef().config('gallery-cdn', { viewerProtocol: 'allow-all' }).done(), expectFail: ['audit'] },
  ],
  keywords: ['restrict S3 to CloudFront only → Origin Access Control (OAC, replaces OAI)', 'bucket policy allows the cloudfront.amazonaws.com service principal for one distribution', 'Block Public Access stays on', 'viewer protocol policy: redirect HTTP to HTTPS'],
  hints: ['CloudFront has to sign its requests to S3', 'Then the bucket policy only needs to trust that distribution', 'And the bucket no longer needs to be public'],
  distractors: ['lambda', 'dynamodb', 'apigw'],
  whyNot: {
    route53: 'A custom domain is a nice touch, but the distribution\'s own domain already serves the images.',
    waf: 'WAF can rate-limit scrapers at the edge, but it does nothing about the open bucket URL behind CloudFront.',
  },
  decisions: [
    {
      title: 'Origin Access Control on the distribution',
      choice: 'gallery-cdn signs origin requests with OAC and redirects HTTP to HTTPS.',
      why: 'OAC makes CloudFront sign each request to S3 with SigV4, so the bucket can trust CloudFront specifically. Without it CloudFront fetches anonymously, which only works against a public bucket. OAC replaces the older Origin Access Identity (OAI) and also supports SSE-KMS.',
      events: ['load', 'audit'],
      components: ['gallery-cdn'],
      manual: ['cloudfront-oac'],
    },
    {
      title: 'A private bucket that trusts one distribution',
      choice: 'gallery-assets keeps Block Public Access on, with a bucket policy allowing s3:GetObject to cloudfront.amazonaws.com when AWS:SourceArn is gallery-cdn.',
      why: 'The bucket policy names the CloudFront service principal and the distribution\'s ARN, so no one else, not even another distribution, can read it. The public-read policy has to go, or the back door stays open.',
      events: ['direct', 'load', 'audit'],
      components: ['gallery-assets'],
      manual: ['s3-block-public-access', 's3-bucket-policy'],
    },
  ],
});

// =====================================================================================
// 15b. Sluggish in Sydney (finish): CloudFront in front of an ALB origin.
// =====================================================================================

const shopLayout = inRegion(threeTierVpc('vpc-shop', 90, ['app']));

function shop(): BoardBuilder {
  return new BoardBuilder(shopLayout, 'helpful')
    .place('alb', 'public-a', { name: 'shop-alb' })
    .place('asg', 'app-a', { name: 'shop-asg' })
    .config('shop-asg', { min: 2, desired: 2, max: 6, healthCheckType: 'ELB', policy: { kind: 'targetTracking', targetCpu: 50 } })
    .place('route53', '', { name: 'shop-dns' })
    .config('shop-dns', { recordName: 'www.koalaknits.com', aliasTargetId: 'shop-alb' });
}
const cdnShop = (viewerProtocol: 'redirect-to-https' | 'allow-all' = 'redirect-to-https', dnsToCdn = true) => {
  const b = shop().place('cloudfront', '', { name: 'shop-cdn' }).config('shop-cdn', { originId: 'shop-alb', viewerProtocol, cacheHitRatio: 0.85 });
  return dnsToCdn ? b.config('shop-dns', { aliasTargetId: 'shop-cdn' }) : b;
};

const fromCity = (city: string | undefined, maxMs?: number) => ({ from: 'internet', to: 'route53', port: 443, expect: 'allow', ...(city ? { clientCity: city } : {}), ...(maxMs ? { maxLatencyMs: maxMs } : {}), label: { to: 'www.koalaknits.com' } });

export const cdnAlbLab = lab({
  id: 'c-cf-alb',
  course: { section: 15, kind: 'finish', lectures: ['CloudFront - ALB as an Origin', 'CloudFront - Geo Restriction', 'CloudFront - Cache Invalidations', 'AWS Global Accelerator'] },
  title: 'Sluggish in Sydney',
  client: 'Koala Knits, a wool shop in Virginia with fans down under',
  users: 'Half the customers are in Australia; product pages are mostly images and cacheable HTML',
  brief:
    "Our shop runs in us-east-1 behind a load balancer. Americans love it; Australians say every page takes forever. Moving the whole app to Sydney isn't an option. Make it fast for both, keep every connection on HTTPS, and keep the site where it is.",
  requirements: [
    { id: 'r1', text: 'Customers reach www.koalaknits.com' },
    { id: 'r2', text: 'Pages load in under 100 ms from Sydney', target: { p95Ms: 100 } },
    { id: 'r3', text: 'HTTPS only' },
  ],
  budget: 0,
  usage: usage0,
  layout: shopLayout,
  palette: ['cloudfront', 'route53', 'alb', 'asg', 's3'],
  start: { board: shop().done(), fails: ['sydney'] },
  events: [
    { id: 'load', name: 'A customer in Virginia', desc: 'A shopper in Virginia opens https://www.koalaknits.com.', domain: 'performant', concepts: ['route53-alias', 'cloudfront-edge'], kind: 'reachability', params: fromCity(undefined), requirementIds: ['r1'] },
    { id: 'sydney', name: 'A customer in Sydney', desc: 'A shopper in Sydney opens the same page.', domain: 'performant', concepts: ['cloudfront-edge'], kind: 'reachability', params: fromCity('sydney', 100), requirementIds: ['r2'] },
    { id: 'audit', name: 'HTTPS check', desc: 'Every public entry point redirects or refuses plain HTTP.', domain: 'secure', concepts: ['cloudfront-edge'], kind: 'audit', params: { rules: ['httpsOnly'] }, requirementIds: ['r3'] },
  ],
  concepts: ['cloudfront-edge', 'route53-alias', 'nlb-global-accelerator'],
  reference: cdnShop().done(),
  mistakes: [
    { name: 'CloudFront added, DNS still points at the ALB', board: cdnShop('redirect-to-https', false).done(), expectFail: ['sydney'] },
    { name: 'CloudFront allows plain HTTP', board: cdnShop('allow-all').done(), expectFail: ['audit'] },
  ],
  keywords: ['global users, cacheable content → CloudFront with an ALB (custom) origin', 'non-HTTP or no caching, static IPs → Global Accelerator', 'the ALB must be public for CloudFront to reach it', 'Route 53 alias to the distribution'],
  hints: ['Put the content close to Sydney without moving the app', 'The load balancer can be a CloudFront origin', 'Point the DNS record at the new entry point'],
  distractors: ['rds', 'nat', 'sqs'],
  whyNot: { s3: 'The pages are generated by the app servers. Copying them to a bucket would mean rebuilding the shop as a static site.' },
  decisions: [
    {
      title: 'CloudFront with the ALB as origin',
      choice: 'shop-cdn uses shop-alb as a custom origin and redirects HTTP to HTTPS.',
      why: 'Edge locations near Sydney answer cache hits locally and carry misses over the AWS backbone, so most requests never cross the Pacific. Global Accelerator also uses the backbone, but caches nothing: it suits TCP/UDP apps and static IPs, not cacheable web pages.',
      events: ['sydney', 'audit'],
      components: ['shop-cdn'],
      manual: ['cloudfront-edge', 'nlb-global-accelerator'],
    },
    {
      title: 'DNS points at the distribution',
      choice: 'www.koalaknits.com is an alias record for shop-cdn.',
      why: 'Until the record changes, every customer still goes straight to the load balancer in Virginia. An alias record can point at the distribution even at the zone apex, at no query charge.',
      events: ['load', 'sydney'],
      components: ['shop-dns'],
      manual: ['route53-alias'],
    },
  ],
});

// =====================================================================================
// 16a. Out of the basement (build): Snowball for the bulk, DataSync for the changes.
// =====================================================================================

const studioLayout: VpcLayout = { ...regionOnly(), onprem: { name: 'Office NAS', cidr: '192.168.0.0/16', internetMbps: 50 } };

function archive(): BoardBuilder {
  return new BoardBuilder(studioLayout, 'helpful').place('s3', 'us-east-1', { name: 'survey-archive' });
}
const snowball = (b: BoardBuilder) => b.place('snow', '', { name: 'archive-snowball' }).config('archive-snowball', { devices: 1, destId: 'survey-archive' });
const sync = (b: BoardBuilder) => b.place('datasync', '', { name: 'nas-sync' }).config('nas-sync', { destId: 'survey-archive', schedule: 'daily' });

export const snowLab = lab({
  id: 'c-store-move',
  course: { section: 16, kind: 'build', lectures: ['AWS Snow Family Overview', 'AWS DataSync', 'AWS Storage Gateway', 'All AWS Storage Options Compared'] },
  title: 'Out of the basement',
  client: 'Contour Surveys, a land surveying firm',
  users: '40 TB of survey scans on an office NAS, a 50 Mbps internet line',
  brief:
    "We're closing the office and moving our 40 TB survey archive into S3. We have three weeks. The internet line is 50 Mbps and shared with everyone. Surveyors keep adding about 30 GB of scans a day until the last day, and none of that can be lost.",
  requirements: [
    { id: 'r1', text: 'All 40 TB in S3 within 21 days' },
    { id: 'r2', text: 'Scans added during the move (≈30 GB/day) arrive too' },
  ],
  budget: 0,
  usage: usage0,
  layout: studioLayout,
  palette: ['s3', 'snow', 'datasync', 'vpn', 'dx'],
  events: [
    { id: 'bulk', name: 'The bulk copy', desc: '40 TB, three weeks, a 50 Mbps line.', domain: 'performant', concepts: ['snow-family', 'data-migration'], kind: 'migration', params: { scope: 'files', tb: 40, deadlineDays: 21 }, requirementIds: ['r1'] },
    { id: 'delta', name: 'Surveyors keep scanning', desc: 'About 30 GB of new scans a day until cut-over.', domain: 'resilient', concepts: ['datasync', 'data-migration'], kind: 'migration', params: { scope: 'delta', tb: 40, changeGbPerDay: 30, deadlineDays: 21 }, requirementIds: ['r2'] },
  ],
  concepts: ['snow-family', 'datasync', 'data-migration', 'block-file-storage'],
  reference: sync(snowball(archive())).done(),
  mistakes: [
    { name: 'DataSync over the internet for everything', board: sync(archive()).done(), expectFail: ['bulk'] },
    { name: 'Snowball only', board: snowball(archive()).done(), expectFail: ['delta'] },
  ],
  keywords: ['tens of TB, slow link, a deadline → Snowball Edge', '40 TB at 50 Mbps ≈ 75 days', 'incremental, scheduled transfer of files → DataSync', 'hybrid access to cloud storage → Storage Gateway'],
  hints: ['Do the arithmetic: 40 TB over 50 Mbps', 'Ship the bulk on a device', 'Then sync what changed since the device left'],
  distractors: ['dms', 'backup', 'kinesis'],
  whyNot: {
    vpn: 'A VPN encrypts traffic over the same 50 Mbps line; it makes nothing faster.',
    dx: 'Direct Connect takes weeks to months to provision. It would arrive after the office closes.',
    dms: 'DMS migrates databases. These are files on a NAS.',
  },
  decisions: [
    {
      title: 'Snowball for the bulk',
      choice: 'One Snowball Edge Storage Optimized device ships the 40 TB to survey-archive.',
      why: '40 TB over 50 Mbps is about 75 days of a saturated line. A Snowball is shipped, loaded locally at LAN speed and imported in under a week. The rule of thumb: if the network would take more than a week, ship a device.',
      events: ['bulk'],
      components: ['archive-snowball'],
      manual: ['snow-family'],
    },
    {
      title: 'DataSync for what changes',
      choice: 'A daily DataSync task copies new and changed scans from the NAS to survey-archive.',
      why: 'The device is a snapshot. DataSync copies only what changed, verifies it and runs on a schedule; 30 GB a day fits the line easily.',
      events: ['delta'],
      components: ['nas-sync'],
      manual: ['datasync'],
    },
    {
      title: 'One bucket as the destination',
      choice: 'survey-archive in us-east-1 receives both the import and the sync.',
      why: 'Both tools write into the same bucket, so the archive ends up complete in one place.',
      events: ['bulk', 'delta'],
      components: ['survey-archive'],
      manual: ['data-migration'],
    },
  ],
});

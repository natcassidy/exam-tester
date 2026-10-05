import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };

function reference(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('s3', '', { name: 'site-bucket' })
    .place('cloudfront', '', { name: 'site-cdn' })
    .place('route53', '', { name: 'www', config: { recordName: 'www.mayachen.design' } as any })
    .config('site-cdn', { originId: 'site-bucket', oac: true, viewerProtocol: 'redirect-to-https' })
    .config('site-bucket', { policy: 'cloudfront-oac', policyDistributionId: 'site-cdn' })
    .config('www', { aliasTargetId: 'site-cdn' });
}

export const portfolio: Mission = {
  id: 'portfolio',
  stage: 1,
  mode: 'build',
  title: 'The static portfolio',
  client: 'Maya Chen, illustrator',
  users: 'Art directors worldwide, a big audience in Australia',
  brief:
    "I'm a freelance illustrator. My portfolio is a folder of HTML and images. Last month a friend's site got scraped and her S3 bill exploded, so I don't want my bucket open to the world. Half my clients are in Sydney and Melbourne and they say US sites feel sluggish. Make it fast, secure and cheap.",
  requirements: [
    { id: 'r1', text: 'Visitors load www.mayachen.design over HTTPS' },
    { id: 'r2', text: 'The bucket is never directly reachable from the internet' },
    { id: 'r3', text: 'Pages load in under 100 ms for visitors in Sydney', target: { p95Ms: 100 } },
    { id: 'r4', text: 'Bucket locked down: Block Public Access on, only the CDN can read' },
    { id: 'r5', text: 'Stay under $30/month', target: { budget: 30 } },
  ],
  budget: 30,
  usage: { requestsPerMonth: 2_000_000, dataOutGb: 200, s3StorageGb: 2, s3GetRequests: 200_000, s3PutRequests: 1_000, flows: [] },
  defaults: 'helpful',
  layout,
  palette: ['s3', 'cloudfront', 'route53', 'waf'],
  events: [
    { id: 'load', name: 'Visitor loads the site', desc: 'A visitor in Virginia opens https://www.mayachen.design.', domain: 'performant', concepts: ['route53-alias', 'cloudfront-oac'], kind: 'reachability', params: { from: 'internet', to: 'route53', port: 443, expect: 'allow', label: { to: 'a Route 53 record' } }, requirementIds: ['r1'] },
    { id: 'direct', name: 'Scraper hits the bucket URL', desc: 'A bot requests https://site-bucket.s3.amazonaws.com/index.html directly.', domain: 'secure', concepts: ['s3-block-public-access', 's3-bucket-policy'], kind: 'reachability', params: { from: 'internet', to: 's3', port: 443, expect: 'deny', label: { to: 'an S3 bucket' } }, requirementIds: ['r2'] },
    { id: 'sydney', name: 'Latency from Sydney', desc: 'An art director in Sydney loads the home page.', domain: 'performant', concepts: ['cloudfront-edge'], kind: 'reachability', params: { from: 'internet', to: 'route53', port: 443, expect: 'allow', clientCity: 'sydney', maxLatencyMs: 100, label: { to: 'a Route 53 record' } }, requirementIds: ['r3'] },
    { id: 'audit', name: 'Security audit', desc: 'Checks bucket exposure, OAC, HTTPS and encryption.', domain: 'secure', concepts: ['s3-block-public-access', 'cloudfront-oac', 'encryption-at-rest'], kind: 'audit', params: { rules: ['s3BlockPublicAccess', 's3OriginAccessControl', 'httpsOnly', 'encryptionAtRest'] }, requirementIds: ['r2', 'r4'] },
    { id: 'bill', name: 'Monthly bill', desc: '2M requests and 200 GB served per month.', domain: 'cost', concepts: ['data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r5'], passesOnEmptyBoard: true },
  ],
  questions: ['q-pf-1', 'q-pf-2', 'q-pf-3', 'q-pf-4', 'q-pf-5'],
  concepts: ['s3-block-public-access', 's3-bucket-policy', 'cloudfront-oac', 'cloudfront-edge', 'route53-alias', 'encryption-at-rest', 'data-transfer-costs'],
  reference: reference().done(),
  mistakes: [
    {
      name: 'Public bucket website, no CDN',
      board: new BoardBuilder(layout, 'helpful')
        .place('s3', '', { name: 'site-bucket', config: { blockPublicAccess: false, policy: 'public-read', staticWebsite: true } as any })
        .place('route53', '', { name: 'www' })
        .config('www', { aliasTargetId: 'site-bucket' })
        .done(),
      expectFail: ['direct', 'sydney', 'audit'],
    },
    {
      name: 'CloudFront without OAC in front of a private bucket',
      board: reference().config('site-cdn', { oac: false }).config('site-bucket', { policy: 'none', policyDistributionId: null }).done(),
      expectFail: ['load', 'sydney', 'audit'],
    },
    {
      name: 'CloudFront in front of a public bucket',
      board: reference().config('site-cdn', { oac: false }).config('site-bucket', { blockPublicAccess: false, policy: 'public-read', policyDistributionId: null }).done(),
      expectFail: ['direct', 'audit'],
    },
    {
      name: 'Plain HTTP allowed',
      board: reference().config('site-cdn', { viewerProtocol: 'allow-all' }).done(),
      expectFail: ['audit'],
    },
  ],
  keywords: ['static website', 'global users / low latency → CloudFront', 'restrict access to S3 to CloudFront only → OAC', 'least operational overhead'],
  hints: ['A bucket for the files', 'A CDN in front of it', 'A DNS record pointing at the CDN'],
};

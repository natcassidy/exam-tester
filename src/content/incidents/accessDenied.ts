import type { Mission } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import { ACCOUNT, incidentBase, serverlessLayout } from './shared';

const TABLE = `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/orders`;
const trust = doc({ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' });
const readOnly = doc({ Sid: 'OrdersTable', Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query'], Resource: TABLE });

function start(): BoardBuilder {
  return new BoardBuilder(serverlessLayout, 'helpful')
    .place('apigw', '', { name: 'orders-api' })
    .place('lambda', '', { name: 'orders-fn' })
    .place('dynamodb', '', { name: 'orders' })
    .place('dynamodb', '', { name: 'payments' })
    .config('orders-api', { integration: { kind: 'lambda', targetId: 'orders-fn' } })
    .config('orders-fn', { timeoutSec: 10 })
    .role({ name: 'orders-fn-role', kind: 'role', policies: [{ name: 'orders-table-access', doc: readOnly }], trust })
    .attachRole('orders-fn', 'orders-fn-role');
}

const startingBoard = start().done();
const b = start();
const orders = b.id('orders');
const payments = b.id('payments');
const roleId = b.roleId('orders-fn-role');

export const accessDeniedIncident: Mission = {
  ...incidentBase(),
  id: 'inc-denied',
  title: 'AccessDenied at 2 a.m.',
  client: 'Dropshop on-call',
  users: 'Every checkout since the 01:58 deploy',
  brief:
    "Pager at 02:03: checkout returns 502 for everyone. The 01:58 release changed the order function to write orders straight to DynamoDB instead of calling the old orders service. Reading orders still works. Roll forward, not back: the old service is being switched off tonight.",
  requirements: [
    { id: 'r1', text: 'The function can save orders again' },
    { id: 'r2', text: 'It can still read orders' },
    { id: 'r3', text: 'Least privilege: no access to other tables, no table administration' },
  ],
  layout: serverlessLayout,
  startingBoard,
  events: [
    { id: 'write', name: 'Save an order', desc: 'orders-fn calls dynamodb:PutItem on the orders table.', domain: 'secure', concepts: ['iam-policy-evaluation', 'iam-roles'], kind: 'iamAccess', params: { principal: 'lambda:api', action: 'dynamodb:PutItem', resource: orders, expect: 'allow' }, requirementIds: ['r1'] },
    { id: 'read', name: 'Read an order', desc: 'orders-fn calls dynamodb:GetItem on the orders table.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda:api', action: 'dynamodb:GetItem', resource: orders, expect: 'allow' }, requirementIds: ['r2'] },
    { id: 'drop-table', name: 'A bug calls DeleteTable', desc: 'A bad deploy (or an attacker with code execution) tries dynamodb:DeleteTable on orders.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda:api', action: 'dynamodb:DeleteTable', resource: orders, expect: 'deny' }, requirementIds: ['r3'] },
    { id: 'other-table', name: 'Write to the payments table', desc: 'orders-fn tries dynamodb:PutItem on payments, which it has no business touching.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda:api', action: 'dynamodb:PutItem', resource: payments, expect: 'deny' }, requirementIds: ['r3'] },
  ],
  incident: {
    alert: { title: 'Checkout: HTTP 502 for 100% of requests', detail: 'orders-api 5XXError 100% since 02:00 · orders-fn Errors 1,240 · Duration p50 38 ms' },
    budget: 6,
    par: 2,
    logs: [
      {
        id: 'app',
        kind: 'app',
        title: 'CloudWatch Logs (/aws/lambda/orders-fn)',
        lines: [
          'START RequestId: 7c1e… Version: $LATEST',
          `[ERROR] AccessDeniedException: User: arn:aws:sts::${ACCOUNT}:assumed-role/orders-fn-role/orders-fn is not authorized to perform: dynamodb:PutItem on resource: ${TABLE} because no identity-based policy allows the dynamodb:PutItem action`,
          'END RequestId: 7c1e…',
          'REPORT RequestId: 7c1e… Duration: 38.12 ms Billed Duration: 39 ms Memory Size: 512 MB',
        ],
      },
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail (data events are enabled for the orders table)',
        lines: [
          `02:00:41Z PutItem  assumed-role/orders-fn-role/orders-fn  ${TABLE}  errorCode: AccessDenied`,
          `02:00:42Z GetItem  assumed-role/orders-fn-role/orders-fn  ${TABLE}  (success)`,
          '01:58:12Z UpdateFunctionCode  role/deploy-pipeline  orders-fn  "v42: write orders directly to DynamoDB"',
        ],
      },
      {
        id: 'apigw',
        kind: 'alb',
        title: 'API Gateway access log (orders-api)',
        lines: ['02:00:41Z POST /checkout 502 "Internal server error" integrationStatus=200 integrationError="Lambda function error"', '02:00:43Z GET /orders/91 200'],
      },
    ],
    rootCause: `policy:${roleId}`,
    rootCauseExplain:
      "orders-fn runs as orders-fn-role, whose only policy allows dynamodb:GetItem and dynamodb:Query on the orders table. The new code calls PutItem, which nothing allows, so it is implicitly denied. The function throws, and API Gateway turns the Lambda error into a 502. Add exactly dynamodb:PutItem on the orders table ARN.",
    symptomEvents: ['write'],
    allowedChanges: [`policy:${roleId}`],
    wrongFixes: [
      {
        name: 'Allow dynamodb:* on every resource',
        board: start().rolePolicy('orders-fn-role', 'orders-table-access', doc({ Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' })).done(),
        expectFail: ['drop-table', 'other-table'],
        collateral: true,
      },
      {
        name: 'Add PutItem on the wrong ARN (table/order)',
        board: start().rolePolicy('orders-fn-role', 'orders-table-access', doc({ Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem'], Resource: `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/order` })).done(),
        expectFail: ['write', 'read'],
        collateral: false,
      },
      {
        name: 'Allow dynamodb:Put* on all tables',
        board: start().rolePolicy('orders-fn-role', 'orders-table-access', doc({ Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Put*'], Resource: `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/*` })).done(),
        expectFail: ['other-table'],
        collateral: false,
      },
    ],
  },
  questions: ['q-inc5-1', 'q-inc5-2', 'q-inc5-3'],
  concepts: ['iam-policy-evaluation', 'iam-roles', 'cloudtrail'],
  reference: start().rolePolicy('orders-fn-role', 'orders-table-access', doc({ Sid: 'OrdersTable', Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem'], Resource: TABLE })).done(),
  keywords: ['AccessDeniedException', 'execution role', 'least privilege', 'no identity-based policy allows'],
  hints: ['The error message names the principal, the action and the resource. Which policy should allow it?'],
};

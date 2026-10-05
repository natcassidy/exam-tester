// IAM types. Pure TypeScript: no React or DOM imports.

export type StringOrList = string | string[];

export type PolicyPrincipal = '*' | { AWS?: StringOrList; Service?: StringOrList };

/** Condition block: { Operator: { conditionKey: value | values } }. */
export type ConditionBlock = Record<string, Record<string, StringOrList | boolean>>;

export interface Statement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Principal?: PolicyPrincipal;
  Action?: StringOrList;
  NotAction?: StringOrList;
  Resource?: StringOrList;
  NotResource?: StringOrList;
  Condition?: ConditionBlock;
}

export interface PolicyDocument {
  Version: '2012-10-17' | '2008-10-17';
  Id?: string;
  Statement: Statement[];
}

export interface NamedPolicy {
  name: string;
  doc: PolicyDocument;
}

/** An IAM role (assumed by EC2, Lambda or people) or an IAM user. */
export interface IamPrincipalDef {
  id: string;
  name: string;
  kind: 'role' | 'user';
  description?: string;
  policies: NamedPolicy[];
  boundary?: PolicyDocument | null;
  /** Role trust policy (who may call sts:AssumeRole). Users have none. */
  trust?: PolicyDocument | null;
}

export interface KmsKey {
  id: string;
  alias: string;
  policy: PolicyDocument;
}

export interface IamState {
  accountId: string;
  /** Set when the account belongs to an AWS Organization; SCPs then apply. */
  orgId?: string;
  roles: Record<string, IamPrincipalDef>;
  keys: Record<string, KmsKey>;
  scps: NamedPolicy[];
}

/** Request context values available to Condition blocks. Keys are matched case-insensitively. */
export type RequestContext = Record<string, string | boolean | undefined>;

export type IamStepKind =
  | 'explicit-deny'
  | 'scp'
  | 'resource-policy'
  | 'endpoint-policy'
  | 'boundary'
  | 'identity'
  | 'implicit-deny'
  | 'key-policy'
  | 'trust-policy'
  | 'decision';

export interface PolicyRef {
  /** Who holds the policy: a role/user id, component id, key id, or 'scp'. */
  holder: string;
  holderKind: 'role' | 'component' | 'key' | 'scp' | 'endpoint';
  policyName: string;
  statementIndex?: number;
  sid?: string;
}

export interface IamStep {
  kind: IamStepKind;
  result: 'allow' | 'deny' | 'info' | 'skip';
  ref?: PolicyRef;
  explain: string;
}

export interface IamDecision {
  action: string;
  resource: string;
  principalArn: string;
  decision: 'allow' | 'deny';
  reason: 'explicit-deny' | 'implicit-deny' | 'allowed';
  steps: IamStep[];
  /** The statement that decided the outcome (deny or the winning allow), for "Fix it". */
  decisive?: PolicyRef;
}

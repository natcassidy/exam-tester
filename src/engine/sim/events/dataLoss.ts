// Data loss: accidental deletion, a malicious insider with admin credentials, an attempt to delete
// records under retention, losing a whole Region, or corruption discovered late. Reports what was
// recoverable and to what point in time.

import type { Board, Component, ConfigOf } from '../../model';
import { accountOf, componentsOfType, regionOf } from '../../board';
import { resolveRef } from '../../select';
import { EventHandler, fmtSec, result } from './context';

export type DataLossScenario = 'accidental-delete' | 'malicious-delete' | 'early-delete' | 'region-loss' | 'corruption';

export interface DataLossParams {
  scenario: DataLossScenario;
  /** Ref of the data store (default: the first S3 bucket). */
  target?: string;
  /** Required recovery point. */
  rpoSec?: number;
  /** early-delete: records must be undeletable for this many days. */
  retentionDays?: number;
  /** corruption: how long after the bad write it is discovered. */
  discoveredAfterHours?: number;
  label?: string;
}

interface Way {
  ok: boolean;
  rpoSec: number;
  line: string;
}

function backupsOf(board: Board, c: Component) {
  return componentsOfType(board, 'backup').filter((b) => b.config.resourceIds.includes(c.id));
}

function s3Ways(board: Board, b: Component & { config: ConfigOf<'s3'> }, p: DataLossParams): Way[] {
  const cfg = b.config;
  const ways: Way[] = [];
  const lock = cfg.objectLock?.mode ?? 'none';
  const dest = cfg.replication?.destId ? board.components[cfg.replication.destId] : undefined;
  const home = regionOf(board, b);
  const backups = backupsOf(board, b);

  switch (p.scenario) {
    case 'accidental-delete':
      ways.push(
        cfg.versioning
          ? { ok: true, rpoSec: 0, line: 'Versioning: a DELETE only adds a delete marker. Removing the markers brings every object back exactly as it was.' }
          : { ok: false, rpoSec: Infinity, line: 'No versioning: a DELETE removes the object permanently.' },
      );
      if (dest) ways.push({ ok: !cfg.replication!.replicateDeletes, rpoSec: 60, line: cfg.replication!.replicateDeletes ? `Replication to ${dest.name} copies the delete markers too (delete marker replication is on), so the replica looks deleted as well; older versions are still there but have to be dug out.` : `${dest.name} still holds the objects: replication does not copy deletes unless delete marker replication is turned on.` });
      for (const bk of backups) ways.push({ ok: true, rpoSec: bk.config.frequencyHours * 3600, line: `${bk.name}: restore from the last recovery point (up to ${bk.config.frequencyHours} h old).` });
      break;
    case 'malicious-delete': {
      if (lock === 'compliance') ways.push({ ok: true, rpoSec: 0, line: `Object Lock in compliance mode: no one, not even the root user, can delete a locked version or shorten its retention (${cfg.objectLock!.retentionDays} days).` });
      else if (lock === 'governance') ways.push({ ok: false, rpoSec: Infinity, line: 'Object Lock in governance mode: an administrator with s3:BypassGovernanceRetention can delete locked versions, and the stolen credentials have it.' });
      if (cfg.mfaDelete) ways.push({ ok: true, rpoSec: 0, line: 'MFA Delete: permanently deleting a version needs the root user\'s MFA code. Stolen IAM admin credentials can only add delete markers.' });
      if (lock === 'none' && !cfg.mfaDelete) ways.push({ ok: false, rpoSec: Infinity, line: cfg.versioning ? 'Versioning alone does not stop an administrator from deleting every version by version ID.' : 'No versioning: the objects are gone.' });
      if (dest) {
        const other = accountOf(board, dest) !== accountOf(board, b);
        ways.push(
          other
            ? { ok: true, rpoSec: 60, line: `${dest.name} is in a separate account (${accountOf(board, dest)}). Deleting a specific version is never replicated, and the stolen credentials can't touch the other account.` }
            : { ok: false, rpoSec: Infinity, line: `${dest.name} is in the same account, so the same administrator deletes its versions too.` },
        );
      }
      for (const bk of backups) {
        const safe = bk.config.vaultLock === 'compliance' || bk.config.copyToOtherAccount;
        ways.push({
          ok: safe,
          rpoSec: bk.config.frequencyHours * 3600,
          line: safe
            ? `${bk.name}: ${bk.config.vaultLock === 'compliance' ? 'Vault Lock in compliance mode stops anyone deleting recovery points' : 'recovery points are copied to a vault in a separate account'}, so a restore works (up to ${bk.config.frequencyHours} h old).`
            : `${bk.name}: an administrator can delete the recovery points in the vault (no compliance-mode Vault Lock, no copy in another account).`,
        });
      }
      break;
    }
    case 'early-delete': {
      const need = p.retentionDays ?? 365 * 7;
      if (lock === 'compliance' && cfg.objectLock!.retentionDays >= need) ways.push({ ok: true, rpoSec: 0, line: `Object Lock compliance mode with ${cfg.objectLock!.retentionDays} days of default retention: the delete is refused (AccessDenied), whoever asks.` });
      else if (lock === 'compliance') ways.push({ ok: false, rpoSec: Infinity, line: `Object Lock compliance mode is on, but default retention is only ${cfg.objectLock!.retentionDays} days; the records must be protected for ${need}.` });
      else if (lock === 'governance') ways.push({ ok: false, rpoSec: Infinity, line: 'Governance mode can be bypassed by users with s3:BypassGovernanceRetention. Regulators asking for WORM storage need compliance mode.' });
      else ways.push({ ok: false, rpoSec: Infinity, line: cfg.versioning ? 'Versioning keeps old versions, but anyone with s3:DeleteObjectVersion can still remove them. Nothing enforces write-once-read-many.' : 'Nothing stops the delete.' });
      break;
    }
    case 'region-loss': {
      if (dest && regionOf(board, dest) !== home) ways.push({ ok: true, rpoSec: 60, line: `Cross-Region Replication keeps a copy in ${dest.name} (${regionOf(board, dest)}). Most objects replicate within seconds (Replication Time Control: 99.99% within 15 minutes).` });
      else if (dest) ways.push({ ok: false, rpoSec: Infinity, line: `${dest.name} is in the same Region (Same-Region Replication), so it is lost too.` });
      for (const bk of backups)
        ways.push(bk.config.copyRegion && bk.config.copyRegion !== home ? { ok: true, rpoSec: bk.config.frequencyHours * 3600, line: `${bk.name} copies recovery points to ${bk.config.copyRegion}.` } : { ok: false, rpoSec: Infinity, line: `${bk.name} keeps its recovery points in ${home} only.` });
      if (!ways.length) ways.push({ ok: false, rpoSec: Infinity, line: `Every copy lives in ${home}. S3 is durable across AZs, but a single Region is still a single Region.` });
      break;
    }
    case 'corruption':
      ways.push(cfg.versioning ? { ok: true, rpoSec: 0, line: 'Versioning: every overwrite keeps the previous version, so the good copies can be restored.' } : { ok: false, rpoSec: Infinity, line: 'No versioning: overwritten objects are gone.' });
      break;
  }
  return ways;
}

function dbWays(board: Board, db: Component, p: DataLossParams): Way[] {
  const cfg = db.config;
  const ways: Way[] = [];
  const hours = p.discoveredAfterHours ?? 6;
  if (p.scenario === 'corruption' || p.scenario === 'accidental-delete') {
    if (cfg.type === 'rds' || cfg.type === 'aurora') {
      if (cfg.backupRetentionDays * 24 >= hours) ways.push({ ok: true, rpoSec: 300, line: `Point-in-time restore: ${cfg.backupRetentionDays} day(s) of backups and transaction logs let you restore to the second before the bad write (${hours} h ago) into a new instance.` });
      else ways.push({ ok: false, rpoSec: Infinity, line: cfg.backupRetentionDays === 0 ? 'Automated backups are off: there is nothing to restore from.' : `Backups only reach back ${cfg.backupRetentionDays} day(s), but the damage is ${hours} h old.` });
      if ((cfg.type === 'rds' && (cfg.multiAz || cfg.readReplicas)) || (cfg.type === 'aurora' && cfg.readers)) ways.push({ ok: false, rpoSec: Infinity, line: 'Standbys and replicas copied the bad write within seconds: replication is for availability, not for undoing mistakes.' });
    }
    if (cfg.type === 'dynamodb')
      ways.push(cfg.pitr ? { ok: true, rpoSec: 1, line: 'Point-in-time recovery: restore the table to any second in the last 35 days.' } : { ok: false, rpoSec: Infinity, line: 'Point-in-time recovery is off.' });
  }
  for (const bk of backupsOf(board, db)) {
    const ok = bk.config.retentionDays * 24 >= hours && (p.scenario !== 'malicious-delete' || bk.config.vaultLock === 'compliance' || bk.config.copyToOtherAccount);
    ways.push({ ok, rpoSec: bk.config.frequencyHours * 3600, line: `${bk.name}: recovery points every ${bk.config.frequencyHours} h, kept ${bk.config.retentionDays} days.` });
  }
  return ways;
}

const SCENARIO_LABEL: Record<DataLossScenario, string> = {
  'accidental-delete': 'Accidental deletion',
  'malicious-delete': 'Insider with stolen admin credentials deletes everything',
  'early-delete': 'Someone tries to delete records still under retention',
  'region-loss': 'The whole Region is lost',
  corruption: 'Bad data written; discovered later',
};

export const dataLoss: EventHandler = (board, ev) => {
  const p = ev.params as DataLossParams;
  const target = resolveRef(board, p.target ?? 's3');
  if (!target) return result(ev, { status: 'fail', summary: `Nothing to protect: ${p.label ?? p.target ?? 'the bucket'} isn't on the board yet.`, lesson: 'Place the data store first.', highlight: [] });
  const ways = target.config.type === 's3' ? s3Ways(board, target as Component & { config: ConfigOf<'s3'> }, p) : dbWays(board, target, p);
  const good = ways.filter((w) => w.ok).sort((a, b) => a.rpoSec - b.rpoSec);
  const best = good[0];
  const rpoOk = !!best && best.rpoSec <= (p.rpoSec ?? Infinity);
  const ok = !!best && rpoOk;
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: `${SCENARIO_LABEL[p.scenario]} on ${target.name}: ${best ? `recoverable, to ${best.rpoSec === 0 ? 'the exact moment before' : `within ${fmtSec(best.rpoSec)} of`} the event${rpoOk ? '' : ` (requirement ≤ ${fmtSec(p.rpoSec!)})`}` : 'not recoverable'}.`,
    detail: { lines: ways.map((w) => ({ label: w.ok ? 'Recoverable' : 'Does not help', value: w.line, status: w.ok ? 'pass' : 'fail' })) },
    lesson: ok ? best.line : (ways.find((w) => !w.ok)?.line ?? 'Nothing protects this data.'),
    highlight: ok ? [] : [target.id],
    fixTarget: target.id,
    metrics: { rpoSec: best?.rpoSec ?? Infinity },
  });
};

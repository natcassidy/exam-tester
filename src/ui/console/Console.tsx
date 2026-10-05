import { useEffect, useState } from 'react';
import * as ops from '../../engine/board';
import { SERVICES } from '../../content/services';
import { manualTitle } from '../../content/manual';
import { useGame } from '../../store/game';
import { Abbr } from '../shell/Abbr';
import { ConfigPanel } from './ConfigPanel';
import { ComponentNetworking, NaclEditor, RouteTableEditor, SgEditor, SubnetPanel } from './NetworkPanels';
import { findSubnet } from '../../engine/net/routing';
import { iamOf } from '../../engine/iam/access';
import { ComponentPermissions, hasPermissionsTab, IamOverview, KeyView, RoleView, ScpView } from '../iam/PermissionsPanel';

function NameEditor({ id, name }: { id: string; name: string }) {
  const apply = useGame((s) => s.apply);
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  return (
    <input
      type="text"
      value={v}
      aria-label="Name"
      style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, background: 'transparent', border: '1px solid transparent', padding: '0 4px', width: '100%' }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== name && apply((b) => ops.renameComponent(b, id, v)) === false && setV(name)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Console() {
  const sel = useGame((s) => s.selection);
  const board = useGame((s) => s.board());
  const tab = useGame((s) => s.consoleTab);
  const setTab = useGame((s) => s.setTab);
  const select = useGame((s) => s.select);
  const apply = useGame((s) => s.apply);
  const openManual = useGame((s) => s.openManual);
  const active = useGame((s) => s.activeTrace);
  const openTrace = useGame((s) => s.openTrace);
  if (!sel) return null;

  const close = (
    <button className="btn ghost small" onClick={() => select(null)} aria-label="Close console">
      ✕
    </button>
  );
  const back = active && (
    <button className="btn small" onClick={() => openTrace(true)}>
      ← Back to trace
    </button>
  );

  if (sel.kind === 'component') {
    const c = board.components[sel.id];
    if (!c) return null;
    const info = SERVICES[c.type];
    return (
      <>
        <div className="panel-head">
          <Abbr type={c.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <NameEditor id={c.id} name={c.name} />
            <div className="sub">
              {info.name} · <span className="mono">{c.id}</span>
            </div>
          </div>
          {close}
        </div>
        <div className="tabs" role="tablist">
          {(['config', 'networking', 'permissions', 'notes'] as const)
            .filter((t) => t !== 'permissions' || hasPermissionsTab(c))
            .map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'config' ? 'Config' : t === 'networking' ? 'Networking' : t === 'permissions' ? 'Permissions' : 'Exam notes'}
              </button>
            ))}
        </div>
        <div className="panel-body">
          {back}
          {tab === 'config' && <ConfigPanel c={c} />}
          {tab === 'networking' && <ComponentNetworking c={c} />}
          {tab === 'permissions' && hasPermissionsTab(c) && <ComponentPermissions c={c} />}
          {tab === 'notes' && (
            <div className="notes">
              <ul>
                {info.examNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="section">
                <h4>Field Manual</h4>
                {info.concepts.map((id) => (
                  <div key={id}>
                    <button className="btn ghost small" onClick={() => openManual(id)}>
                      → {manualTitle(id)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <button
              className="btn small danger"
              onClick={() => {
                if (apply((b) => ops.removeComponent(b, c.id), `${c.name} deleted.`)) select(null);
              }}
            >
              Delete {c.name}
            </button>
            {(c.type === 'nat' || c.type === 'igw') && <p className="hint">Routes pointing at it stay behind as blackholes, exactly like in AWS.</p>}
          </div>
        </div>
      </>
    );
  }

  if (sel.kind === 'iam' || sel.kind === 'role' || sel.kind === 'key' || sel.kind === 'scp') {
    const iam = iamOf(board);
    const role = sel.kind === 'role' ? iam.roles[sel.id] : null;
    const heading = sel.kind === 'iam' ? 'Permissions (IAM)' : sel.kind === 'role' ? `${role?.kind === 'user' ? 'IAM user' : 'IAM role'} ${role?.name ?? sel.id}` : sel.kind === 'key' ? `KMS key ${iam.keys[sel.id]?.alias ?? sel.id}` : 'Service control policies';
    const manual = sel.kind === 'key' ? 'kms-key-policies' : sel.kind === 'scp' ? 'scps' : sel.kind === 'role' ? 'iam-roles' : 'iam-policy-evaluation';
    return (
      <>
        <div className="panel-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{heading}</h2>
            {sel.kind !== 'iam' && (
              <button className="btn ghost small" onClick={() => select({ kind: 'iam' })}>
                ← All roles and keys
              </button>
            )}
          </div>
          {close}
        </div>
        <div className="panel-body">
          {back}
          {sel.kind === 'iam' && <IamOverview />}
          {sel.kind === 'role' && <RoleView id={sel.id} />}
          {sel.kind === 'key' && <KeyView id={sel.id} />}
          {sel.kind === 'scp' && <ScpView />}
          <div className="section">
            <button className="btn ghost small" onClick={() => openManual(manual)}>
              → Field Manual: {manualTitle(manual)}
            </button>
          </div>
        </div>
      </>
    );
  }

  const title =
    sel.kind === 'subnet'
      ? `Subnet ${findSubnet(board, sel.id)?.subnet.name ?? sel.id}`
      : sel.kind === 'sg'
        ? `Security group ${board.securityGroups[sel.id]?.name ?? sel.id}`
        : sel.kind === 'nacl'
          ? `Network ACL ${board.nacls[sel.id]?.name ?? sel.id}`
          : `Route table ${board.routeTables[sel.id]?.name ?? sel.id}`;
  const sub = sel.kind === 'subnet' ? `${findSubnet(board, sel.id)?.subnet.cidr} · ${findSubnet(board, sel.id)?.subnet.azId}` : sel.id;
  return (
    <>
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <h2>{title}</h2>
          <div className="sub mono">{sub}</div>
        </div>
        {close}
      </div>
      <div className="panel-body">
        {back}
        {sel.kind === 'subnet' && <SubnetPanel subnetId={sel.id} />}
        {sel.kind === 'sg' && <SgEditor sgId={sel.id} ruleRef={sel.ruleRef} />}
        {sel.kind === 'nacl' && <NaclEditor naclId={sel.id} ruleRef={sel.ruleRef} />}
        {sel.kind === 'routeTable' && <RouteTableEditor rtId={sel.id} ruleRef={sel.ruleRef} />}
        <div className="section">
          <button className="btn ghost small" onClick={() => openManual(sel.kind === 'sg' ? 'security-groups' : sel.kind === 'nacl' ? 'nacls' : 'vpc-public-private')}>
            → Field Manual: {manualTitle(sel.kind === 'sg' ? 'security-groups' : sel.kind === 'nacl' ? 'nacls' : 'vpc-public-private')}
          </button>
        </div>
      </div>
    </>
  );
}

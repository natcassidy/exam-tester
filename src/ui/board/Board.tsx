import { useDndContext, useDroppable } from '@dnd-kit/core';
import type { CSSProperties, ReactNode } from 'react';
import type { Board as BoardT, Component, Placement, Region, ServiceType, Subnet, Vpc } from '../../engine/model';
import { accountOf, subnetsOf, validatePlacement } from '../../engine/board';
import { subnetPublicStatus } from '../../engine/net/routing';
import { SERVICES } from '../../content/services';
import { useGame } from '../../store/game';
import { Abbr } from '../shell/Abbr';
import { nodeSubtitle } from './describe';
import { TraceOverlay } from '../trace/TraceOverlay';
import { useBoardView } from './context';

export function zoneId(z: Placement): string {
  return `${z.kind}:${z.refId}`;
}

export function parseZoneId(id: string): Placement {
  const i = id.indexOf(':');
  return { kind: id.slice(0, i) as Placement['kind'], refId: id.slice(i + 1) };
}

function useDragType(): ServiceType | null {
  const { active } = useDndContext();
  return (active?.data.current?.type as ServiceType | undefined) ?? null;
}

function Zone({ zone, className, children, label, style }: { zone: Placement; className?: string; children: ReactNode; label: string; style?: CSSProperties }) {
  const { board, readOnly, idPrefix } = useBoardView();
  const placing0 = useGame((s) => s.placing);
  const place = useGame((s) => s.place);
  const dragType0 = useDragType();
  const { setNodeRef, isOver } = useDroppable({ id: idPrefix + zoneId(zone), disabled: readOnly });
  const placing = readOnly ? null : placing0;
  const dragType = readOnly ? null : dragType0;
  const pending = dragType ?? placing;
  const valid = pending ? validatePlacement(board, pending, zone) === null : false;
  const cls = [className, pending && valid ? 'drop-ok' : '', isOver && valid ? 'drop-over' : '', placing ? 'tappable' : ''].filter(Boolean).join(' ');
  return (
    <div
      ref={setNodeRef}
      className={cls}
      style={style}
      aria-label={label}
      onClick={(e) => {
        if (!placing) return;
        e.stopPropagation();
        place(placing, zone);
      }}
    >
      {children}
    </div>
  );
}

function Node({ c, span }: { c: Component; span?: string }) {
  const { board, selection, select, readOnly } = useBoardView();
  const highlight0 = useGame((s) => s.highlight);
  const placing0 = useGame((s) => s.placing);
  const highlight = readOnly ? [] : highlight0;
  const placing = readOnly ? null : placing0;
  const selected = selection?.kind === 'component' && selection.id === c.id;
  return (
    <button
      className={`node ${selected ? 'selected' : ''} ${highlight.includes(c.id) ? 'bad' : ''}`}
      data-node-id={readOnly ? undefined : c.id}
      onClick={(e) => {
        if (placing) return;
        e.stopPropagation();
        select({ kind: 'component', id: c.id });
      }}
      aria-label={`${SERVICES[c.type].name} ${c.name}`}
    >
      <Abbr type={c.type} />
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span className="nm">{c.name}</span>
        <span className="sub">{nodeSubtitle(board, c)}</span>
      </span>
      {span && <span className="span-label">{span}</span>}
    </button>
  );
}

function SubnetCell({ s, col, children }: { s: Subnet; col: number; children: ReactNode }) {
  const { board, selection, select, readOnly } = useBoardView();
  const placing0 = useGame((st) => st.placing);
  const placing = readOnly ? null : placing0;
  const status = subnetPublicStatus(board, s);
  const selected = selection?.kind === 'subnet' && selection.id === s.id;
  // The subnet spans both tier rows as a subgrid: its own content sizes row 1,
  // and components spanning several AZs sit in row 2 inside its border.
  return (
    <Zone
      zone={{ kind: 'subnet', refId: s.id }}
      className={`subnet ${status.isPublic ? 'public' : ''} ${selected ? 'selected' : ''}`}
      label={`Subnet ${s.name}`}
      style={{ gridColumn: col, gridRow: '1 / 3' }}
    >
      <div data-subnet-id={readOnly ? undefined : s.id} style={{ minWidth: 0 }}>
        <button
          className="subnet-head"
          onClick={(e) => {
            if (placing) return;
            e.stopPropagation();
            select({ kind: 'subnet', id: s.id });
          }}
          title={status.reason}
        >
          <span className="name">{s.name}</span>
          <span className="mono">{s.cidr}</span>
          <span className={`tag ${status.isPublic ? 'public' : 'private'}`}>{status.isPublic ? 'Public' : 'Private'}</span>
        </button>
        <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>{status.reason}</div>
        <div className="subnet-body">{children}</div>
      </div>
    </Zone>
  );
}

function VpcView({ board, vpc }: { board: BoardT; vpc: Vpc }) {
  const nAz = vpc.azs.length;
  const tiers: string[] = [];
  for (const az of vpc.azs) for (const s of az.subnets) if (!tiers.includes(s.tier)) tiers.push(s.tier);
  const cols = `repeat(${nAz}, minmax(0, 1fr))`;
  const attachments = vpc.attachments.map((id) => board.components[id]).filter(Boolean);
  // Peering connections live in the requester VPC; show them on the accepter side too.
  const peeredIn = Object.values(board.components).filter((c) => c.config.type === 'pcx' && c.config.peerVpcId === vpc.id);
  const multiAccount = new Set(board.regions.flatMap((r) => r.vpcs).map((v) => accountOf(board, v))).size > 1;
  return (
    <div className="vpc">
      <div className="zone-head">
        <h4>{vpc.name ? `VPC ${vpc.name}` : 'VPC'}</h4>
        <span className="mono">
          {vpc.id} · {vpc.cidr}
          {multiAccount ? ` · account ${accountOf(board, vpc)}` : ''}
        </span>
      </div>
      <Zone zone={{ kind: 'vpcAttach', refId: vpc.id }} className="zone" label={`Attachments of ${vpc.name ?? vpc.id}`}>
        <div className="zone-head">
          <h4>Attachments</h4>
          <span className="hint">internet gateway, endpoints, VPN gateway, peering</span>
        </div>
        <div className="strip">
          {attachments.length ? attachments.map((c) => <Node key={c.id} c={c} />) : !peeredIn.length && <span className="empty-note">Nothing attached</span>}
          {peeredIn.map((c) => (
            <span key={c.id} className="ghost-node" title="Peering connections are created in the requester VPC and accepted here">
              ⇄ {c.name} (accepter)
            </span>
          ))}
        </div>
      </Zone>
      <div className="az-head" style={{ gridTemplateColumns: cols, display: 'grid', marginTop: 10 }}>
        {vpc.azs.map((a) => (
          <div key={a.id}>{a.name}</div>
        ))}
      </div>
      {tiers.map((tier) => {
        const cells = vpc.azs.map((az) => az.subnets.find((s) => s.tier === tier) ?? null);
        const inTier = new Set(cells.filter(Boolean).flatMap((s) => s!.components));
        const comps = [...inTier].map((id) => board.components[id]).filter(Boolean);
        const spanning: { c: Component; from: number; to: number }[] = [];
        const single: Record<string, Component[]> = {};
        for (const c of comps) {
          const cols = cells.map((s, i) => (s && subnetsOf(c).includes(s.id) ? i : -1)).filter((i) => i >= 0);
          if (cols.length > 1) spanning.push({ c, from: Math.min(...cols), to: Math.max(...cols) });
          else {
            const sid = cells[cols[0]]!.id;
            (single[sid] ??= []).push(c);
          }
        }
        return (
          <div key={tier} className="tier" style={{ gridTemplateColumns: cols }}>
            {cells.map((s, i) =>
              s ? (
                <SubnetCell key={s.id} s={s} col={i + 1}>
                  {(single[s.id] ?? []).map((c) => (
                    <Node key={c.id} c={c} />
                  ))}
                </SubnetCell>
              ) : (
                <div key={i} style={{ gridColumn: i + 1, gridRow: '1 / 3' }} />
              ),
            )}
            {spanning.length > 0 &&
              (() => {
                // Group spanning components by column range so equal spans stack.
                const groups: Record<string, typeof spanning> = {};
                for (const sp of spanning) (groups[`${sp.from}-${sp.to}`] ??= []).push(sp);
                return Object.entries(groups).map(([k, g]) => (
                  <div key={k} className="span-row" style={{ gridColumn: `${g[0].from + 1} / ${g[0].to + 2}`, gridRow: 2 }}>
                    {g.map(({ c, from, to }) => (
                      <Node key={c.id} c={c} span={`spans ${to - from + 1} AZs`} />
                    ))}
                  </div>
                ));
              })()}
          </div>
        );
      })}
    </div>
  );
}

function RegionView({ board, region, first }: { board: BoardT; region: Region; first: boolean }) {
  const { readOnly } = useBoardView();
  const regional = region.regionalServices.map((id) => board.components[id]).filter(Boolean);
  return (
    <div className="zone region-zone" style={{ borderStyle: 'solid' }}>
      <div className="zone-head">
        <h4>Region</h4>
        <span className="mono">
          {region.id} · {region.name}
        </span>
      </div>
      <Zone zone={{ kind: 'region', refId: region.id }} className="zone" label={`Regional services in ${region.id}`}>
        <div className="zone-head" data-node-id={readOnly || !first ? undefined : 'svc'}>
          <h4>Regional services</h4>
          <span className="hint">S3 · SQS · Lambda · API Gateway · DynamoDB · Kinesis · Transit Gateway · Backup</span>
        </div>
        <div className="strip">{regional.length ? regional.map((c) => <Node key={c.id} c={c} />) : <span className="empty-note">Drop regional services here</span>}</div>
      </Zone>
      {region.vpcs.map((v) => (
        <div key={v.id} style={{ marginTop: 10 }}>
          <VpcView board={board} vpc={v} />
        </div>
      ))}
    </div>
  );
}

function OnPremView({ board }: { board: BoardT }) {
  const { readOnly } = useBoardView();
  const op = board.onprem!;
  const comps = op.components.map((id) => board.components[id]).filter(Boolean);
  return (
    <Zone zone={{ kind: 'onprem', refId: 'onprem' }} className="zone onprem-zone" label="On-premises data centre">
      <div className="zone-head" data-node-id={readOnly ? undefined : 'onprem'}>
        <h4>On-premises · {op.name}</h4>
        <span className="mono">
          {op.cidr} · {op.internetMbps.toLocaleString()} Mbps internet
        </span>
      </div>
      <div className="hint" style={{ fontSize: 11 }}>Customer gateway · Site-to-Site VPN · Direct Connect · Snowball · DataSync</div>
      <div className="strip">{comps.length ? comps.map((c) => <Node key={c.id} c={c} />) : <span className="empty-note">Drop hybrid services here</span>}</div>
    </Zone>
  );
}

export function Board() {
  const { board, select, readOnly } = useBoardView();
  const placing0 = useGame((s) => s.placing);
  const placing = readOnly ? null : placing0;
  const setPlacing = useGame((s) => s.setPlacing);
  const edge = board.edge.map((id) => board.components[id]).filter(Boolean);
  return (
    <div className={`board ${placing ? 'placing-mode' : ''} ${readOnly ? 'read-only' : ''}`} onClick={() => !placing && select(null)}>
      {placing && (
        <div className="placing-banner" onClick={(e) => e.stopPropagation()}>
          <span>
            Placing <b>{SERVICES[placing].name}</b>: tap a highlighted zone ({SERVICES[placing].zoneHint}).
          </span>
          <button className="btn small" onClick={() => setPlacing(null)} style={{ marginLeft: 'auto' }}>
            Cancel
          </button>
        </div>
      )}
      <div className="internet-anchor" data-node-id={readOnly ? undefined : 'internet'}>
        <span className="dot" /> Internet (users, attackers, patch servers)
      </div>
      <Zone zone={{ kind: 'edge', refId: 'global' }} className="zone" label="Global edge">
        <div className="zone-head">
          <h4>Global edge</h4>
          <span className="hint">CloudFront · Route 53 · WAF</span>
        </div>
        <div className="strip">{edge.length ? edge.map((c) => <Node key={c.id} c={c} />) : <span className="empty-note">Drop global services here</span>}</div>
      </Zone>
      {board.regions.map((r, i) => (
        <RegionView key={r.id} board={board} region={r} first={i === 0} />
      ))}
      {board.onprem && <OnPremView board={board} />}
      {!readOnly && <TraceOverlay />}
    </div>
  );
}

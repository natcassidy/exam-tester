// Fluent board builder for mission content and tests. Uses the same operations as the UI,
// so reference boards obey the same validation the player does. Throws on any AWS error.

import type { Board, ComponentId, NaclRule, Placement, RouteTarget, ServiceConfig, ServiceType, SgRule, VpcLayout } from './model';
import * as ops from './board';

export class BoardBuilder {
  board: Board;
  private names: Record<string, ComponentId> = {};

  constructor(layout: VpcLayout, private defaults: ops.Defaults = 'helpful') {
    this.board = ops.createBoardFromLayout(layout);
    for (const c of Object.values(this.board.components)) this.names[c.name] = c.id;
  }

  static from(board: Board, defaults: ops.Defaults = 'helpful'): BoardBuilder {
    const b = Object.create(BoardBuilder.prototype) as BoardBuilder;
    b.board = ops.clone(board);
    b.defaults = defaults;
    b.names = {};
    for (const c of Object.values(b.board.components)) b.names[c.name] = c.id;
    return b;
  }

  private apply(r: ops.OpResult): string | undefined {
    if (!r.ok) throw new Error(r.error);
    this.board = r.board;
    return r.id;
  }

  /** Component id by name. */
  id(name: string): ComponentId {
    const id = this.names[name];
    if (!id) throw new Error(`No component named ${name}`);
    return id;
  }

  sgOf(name: string): string {
    const c = this.board.components[this.id(name)];
    return c.securityGroupIds![0];
  }

  place(type: ServiceType, where: string, opts: ops.PlaceOptions & { name: string }): this {
    const kind = ops.ZONE_FOR[type];
    const zone: Placement = kind === 'subnet' ? { kind, refId: where } : kind === 'vpcAttach' ? { kind, refId: where } : { kind, refId: kind === 'region' ? this.board.regions[0].id : 'global' };
    const id = this.apply(ops.placeComponent(this.board, type, zone, this.defaults, opts))!;
    this.names[opts.name] = id;
    return this;
  }

  config(name: string, patch: Partial<ServiceConfig> | Record<string, unknown>): this {
    // Allow references by name for id-valued fields.
    const p: Record<string, unknown> = { ...patch };
    for (const k of ['targetId', 'originId', 'aliasTargetId', 'associatedId', 'eventSourceId', 'dlqId', 'policyDistributionId']) {
      if (typeof p[k] === 'string' && this.names[p[k] as string]) p[k] = this.names[p[k] as string];
    }
    if (p.integration && typeof (p.integration as any).targetId === 'string') {
      const t = (p.integration as any).targetId;
      p.integration = { ...(p.integration as object), targetId: this.names[t] ?? t };
    }
    this.apply(ops.updateConfig(this.board, this.id(name), p as Partial<ServiceConfig>));
    return this;
  }

  subnets(name: string, subnets: string[]): this {
    this.apply(ops.setSubnets(this.board, this.id(name), subnets));
    return this;
  }

  remove(name: string): this {
    this.apply(ops.removeComponent(this.board, this.id(name)));
    delete this.names[name];
    return this;
  }

  /** Add an SG rule. `source` may be { sgOf: componentName }. */
  sgRule(component: string, direction: 'inbound' | 'outbound', rule: Omit<SgRule, 'source'> & { source: SgRule['source'] | { sgOf: string } }): this {
    const src = 'sgOf' in rule.source ? { sg: this.sgOf((rule.source as { sgOf: string }).sgOf) } : rule.source;
    this.apply(ops.addSgRule(this.board, this.sgOf(component), direction, { ...rule, source: src } as SgRule));
    return this;
  }

  clearSg(component: string, direction: 'inbound' | 'outbound'): this {
    const sg = this.board.securityGroups[this.sgOf(component)];
    sg[direction] = [];
    return this;
  }

  naclRule(naclId: string, direction: 'inbound' | 'outbound', rule: NaclRule): this {
    this.apply(ops.addNaclRule(this.board, naclId, direction, rule));
    return this;
  }

  route(rtId: string, dest: string, target: RouteTarget | { natName: string } | { igwName: string }): this {
    let t: RouteTarget = target as RouteTarget;
    if (typeof target === 'object' && 'natName' in target) t = { nat: this.id(target.natName) };
    if (typeof target === 'object' && 'igwName' in target) t = { igw: this.id(target.igwName) };
    const existing = this.board.routeTables[rtId]?.routes.find((r) => r.dest === dest);
    if (existing) this.apply(ops.setRouteTarget(this.board, rtId, dest, t));
    else this.apply(ops.addRoute(this.board, rtId, { dest, target: t }));
    return this;
  }

  removeRoute(rtId: string, dest: string): this {
    this.apply(ops.removeRoute(this.board, rtId, dest));
    return this;
  }

  done(): Board {
    return ops.clone(this.board);
  }
}

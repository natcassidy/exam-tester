# Security group chaining

## What it is
Each tier's security group allows traffic only **from the security group of the tier in front of it**, instead of from IP ranges.

## How it actually works
```
Internet ──443──▶ alb-sg ──443──▶ app-sg ──3306──▶ db-sg
           0.0.0.0/0      source: alb-sg     source: app-sg
```
- An SG-referencing rule matches any network interface that carries the referenced group, whatever its IP.
- Auto Scaling can add and remove instances freely; the rules never change.
- If an attacker compromises something else in the VPC, it still can't reach the database unless it carries `app-sg`.

## Common exam traps
- Allowing the database from the **ALB's** group is wrong: the ALB never connects to the database; the app servers do.
- Allowing from the VPC CIDR "works" but lets anything in the VPC in.
- Referenced groups must be in the same VPC (or a peered VPC in the same Region).

## Related
[[security-groups]] · [[alb]]

# Savings Plans and Reserved Instances

## What it is
Discounts on steady usage in exchange for a **1- or 3-year commitment**. The commitment is billed every hour whether you use it or not.

## How it actually works
- **Compute Savings Plan:** commit to a $/hour spend. Applies to **any** EC2 instance family, size, OS, tenancy or Region, and to **AWS Fargate and Lambda**. The most flexible commitment.
- **EC2 Instance Savings Plan:** commit to a $/hour spend on **one instance family in one Region** (any size, OS, AZ). Bigger discount, less flexibility.
- **Standard Reserved Instances:** reserve a number of instances of one type; regional Linux RIs are **size-flexible within the family** (one m5.xlarge = two m5.large). You can't change the family.
- **Convertible Reserved Instances:** smaller discount, but can be **exchanged** for another family, OS or tenancy. EC2 only, not Lambda or Fargate.
- Payment options: All Upfront, Partial Upfront, No Upfront. More upfront and 3 years give the biggest discount.
- Savings Plans apply automatically to the usage with the highest discount first. Usage above the commitment is billed On-Demand.

## Numbers that matter
- Up to ~66% off (Compute SP), up to ~72% (EC2 Instance SP and Standard RIs), up to ~66% (Convertible RIs), for 3-year All Upfront.
- This game uses approximate No Upfront rates: Compute SP 28% (1 y) / 50% (3 y); EC2 Instance SP and Standard RI 37% / 57%; Convertible RI 31% / 52%.

## Common exam traps
- "Workload will move to Lambda / Fargate / another instance family or Region" → **Compute Savings Plan**.
- "Steady, unchanging fleet of one family, maximum discount" → EC2 Instance Savings Plan or Standard RIs (3-year).
- Commit to the **baseline you are sure of**, not the peak. Peaks belong to On-Demand or Spot.
- Capacity reservation: only zonal RIs and On-Demand Capacity Reservations reserve capacity; Savings Plans are a billing discount.

## Related
[[ec2-spot]] · [[db-right-sizing]] · [[data-transfer-costs]]

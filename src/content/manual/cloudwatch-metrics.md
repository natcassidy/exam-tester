# CloudWatch metrics for troubleshooting

## What it is
Numeric time series from every service. In an incident they tell you *what* is happening and *since when*; logs and traces tell you *why*.

## How it actually works
Key metrics for a web tier:

| Metric | Namespace | Tells you |
|---|---|---|
| HealthyHostCount / UnHealthyHostCount | AWS/ApplicationELB | Target health per target group and AZ |
| HTTPCode_ELB_5XX_Count vs. HTTPCode_Target_5XX_Count | AWS/ApplicationELB | The load balancer vs. the app is failing |
| TargetResponseTime | AWS/ApplicationELB | Latency the targets add |
| GroupInServiceInstances | AWS/AutoScaling | What Auto Scaling thinks is running |
| StatusCheckFailed | AWS/EC2 | Instance or system impairment |
| CPUUtilization | AWS/EC2 | Busy or idle (idle + errors = not a capacity problem) |

- EC2 memory and disk usage need the CloudWatch agent: they are not default metrics.
- Alarms turn metrics into actions (scaling, SNS, EC2 recovery).

## Numbers that matter
- Basic monitoring: 5-minute EC2 metrics; detailed monitoring: 1 minute.

## Common exam traps
- "Monitor memory utilization" → install the CloudWatch agent.
- InService instances but UnHealthyHostCount > 0 for days → the group isn't using ELB health checks.

## Related
[[asg-health-checks]] · [[alb-error-codes]] · [[cloudtrail]]

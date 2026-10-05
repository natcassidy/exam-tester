# Containers: ECS, EKS and Fargate

## What it is
**Amazon ECS** (AWS's container orchestrator) and **Amazon EKS** (managed Kubernetes) run containers. **AWS Fargate** runs them without servers to manage; the **EC2 launch type** runs them on instances you manage.

## How it actually works
- ECS **task definition**: images, CPU/memory, ports, **task IAM role** (permissions for the app) and **task execution role** (to pull images and write logs).
- An ECS **service** keeps N tasks running behind a load balancer and scales them with Service Auto Scaling.
- **Fargate:** pay per vCPU and GB per second for each task; no patching, no cluster capacity planning. **Fargate Spot** runs interruptible tasks at a discount.
- **EC2 launch type:** cheaper at steady, high utilisation, supports GPUs and custom AMIs; you manage the instances (capacity providers can scale them).
- EKS when the team already uses Kubernetes or needs portability; ECS for the simplest AWS-native option.
- Lambda vs. containers: Lambda for event-driven work under 15 minutes; containers for long-running services and anything over 15 minutes.

## Common exam traps
- "Run containers with the least operational overhead" → ECS (or EKS) on **Fargate**.
- "Already on Kubernetes / migrate Kubernetes workloads" → EKS.
- "Job runs longer than 15 minutes" → not Lambda: ECS/Fargate task or AWS Batch.
- Compute Savings Plans cover Fargate; EC2 Instance Savings Plans do not.

## Related
[[lambda-concurrency]] · [[ec2-purchase-options]] · [[ec2-spot]]

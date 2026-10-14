// Course Labs: 1-3 hands-on scenarios per section of the SAA-C03 video course, to test each
// section right after watching it. Some start from a broken board to fix, some from a half-built
// one to finish, some from nothing.

import type { Mission } from '../../engine/model';
import { guardrailsLab, reportServerLab, tooMuchPowerLab } from './iam';
import { firstServerLab, publicIpLab, spotLab, timeoutsLab } from './ec2';
import { healthChecksLab, httpsLab, scaleOutLab } from './ha';
import { dbPortLab, multiAzLab, readReplicaLab } from './databases';
import { kmsBucketLab, lifecycleLab, objectLockLab, photoArchiveLab, staticSiteLab } from './s3';
import { cdnAlbLab, oacLab, snowLab } from './edge';
import { kinesisLab, sqsLab } from './messaging';
import { analyticsLab, concurrencyLab, menuApiLab, todoLab } from './serverless';
import { naclLab, peeringLab, pentestLab, vpcBuildLab } from './network';
import { backupLab, dmsLab } from './dr';
import { failoverLab, latencyLab, myClothesLab, whatsTheTimeLab } from './dns';

export interface CourseSection {
  n: number;
  title: string;
  /** Why the section has no labs (an intro, or services the simulator doesn't model). */
  skip?: string;
}

export const COURSE_SECTIONS: CourseSection[] = [
  { n: 1, title: 'Course introduction', skip: 'Account setup, nothing to architect.' },
  { n: 2, title: 'Slides and code download', skip: 'Downloads only.' },
  { n: 3, title: 'AWS Cloud overview: Regions and AZs', skip: 'Covered by every lab that spans two AZs.' },
  { n: 4, title: 'IAM and the AWS CLI' },
  { n: 5, title: 'EC2 fundamentals' },
  { n: 6, title: 'EC2: Solutions Architect level' },
  { n: 7, title: 'EC2 instance storage: EBS, AMI, EFS', skip: 'EBS, AMIs and EFS are not modelled on the board yet.' },
  { n: 8, title: 'High availability and scalability: ELB and ASG' },
  { n: 9, title: 'RDS, Aurora and ElastiCache' },
  { n: 10, title: 'Route 53' },
  { n: 11, title: 'Classic solutions architecture' },
  { n: 12, title: 'Amazon S3 introduction' },
  { n: 13, title: 'Advanced Amazon S3' },
  { n: 14, title: 'Amazon S3 security' },
  { n: 15, title: 'CloudFront and Global Accelerator' },
  { n: 16, title: 'AWS storage extras' },
  { n: 17, title: 'Decoupling: SQS, SNS, Kinesis, MQ' },
  { n: 18, title: 'Containers on AWS', skip: 'ECS, EKS and Fargate are not modelled on the board yet.' },
  { n: 19, title: 'Serverless overview' },
  { n: 20, title: 'Serverless solutions architecture' },
  { n: 21, title: 'Databases in AWS', skip: 'A recap of earlier sections: the RDS, Aurora, DynamoDB and S3 labs cover it.' },
  { n: 22, title: 'Data and analytics' },
  { n: 23, title: 'Machine learning', skip: 'The ML services are API calls, not architecture you build on a board.' },
  { n: 24, title: 'Monitoring and audit', skip: 'CloudWatch, CloudTrail and Config are not modelled as components (the Incident Room uses their logs).' },
  { n: 25, title: 'IAM advanced' },
  { n: 26, title: 'Security and encryption' },
  { n: 27, title: 'Networking: VPC' },
  { n: 28, title: 'Disaster recovery and migrations' },
  { n: 29, title: 'More solution architectures', skip: 'A tour of patterns already built in earlier labs: event processing (17), caching (15, 20), HA with ALB and ASG (8). Blocking single IPs and HPC are not modelled.' },
  { n: 30, title: 'Other services', skip: 'Mostly one-line services; the cost tools are covered by the Refactor missions.' },
  { n: 31, title: 'Whitepapers and architectures', skip: 'Reading, not building.' },
  { n: 32, title: 'Exam preparation', skip: 'Use the practice exam (Exam in the top bar).' },
  { n: 33, title: 'Certification paths', skip: 'Nothing to build.' },
];

/** Every lab, in course order. */
export const COURSE: Mission[] = [
  reportServerLab,
  tooMuchPowerLab,
  firstServerLab,
  timeoutsLab,
  spotLab,
  publicIpLab,
  healthChecksLab,
  scaleOutLab,
  httpsLab,
  multiAzLab,
  readReplicaLab,
  dbPortLab,
  failoverLab,
  latencyLab,
  whatsTheTimeLab,
  myClothesLab,
  staticSiteLab,
  photoArchiveLab,
  lifecycleLab,
  kmsBucketLab,
  objectLockLab,
  oacLab,
  cdnAlbLab,
  snowLab,
  sqsLab,
  kinesisLab,
  menuApiLab,
  concurrencyLab,
  todoLab,
  analyticsLab,
  guardrailsLab,
  pentestLab,
  vpcBuildLab,
  naclLab,
  peeringLab,
  backupLab,
  dmsLab,
].sort((a, b) => a.course!.section - b.course!.section);

export const sectionOf = (m: Mission) => COURSE_SECTIONS.find((s) => s.n === m.course?.section);

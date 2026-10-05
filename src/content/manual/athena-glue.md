# Athena, Glue and the data lake

## What it is
**Athena** runs serverless SQL directly on data in S3, billed per TB scanned. **AWS Glue** provides the Data Catalog (table schemas), crawlers and serverless ETL jobs. Together with S3 they form a data lake; **Lake Formation** adds fine-grained permissions.

## How it actually works
- A Glue crawler infers schemas and partitions and writes them to the Data Catalog, which Athena (and EMR, Redshift Spectrum) use.
- Athena scans only what it must: **columnar formats (Parquet/ORC)**, compression and **partitioning** (e.g. by date) cut the bytes scanned, and the bill, by 90%+.
- Glue ETL (Spark) transforms and converts data; Glue DataBrew for no-code prep.
- Redshift is the data warehouse for complex, repeated BI queries; QuickSight for dashboards; EMR for big Hadoop/Spark clusters.

## Numbers that matter
- Athena ≈ $5 per TB scanned (10 MB minimum per query).

## Common exam traps
- "Ad hoc SQL on data in S3, serverless, least effort" → Athena.
- "Reduce Athena cost" → Parquet + partitioning + compression.
- "Discover schema of data in S3" → Glue crawler.

## Related
[[kinesis-firehose]] · [[s3-storage-classes]] · [[kinesis-data-streams]]

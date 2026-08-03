# Serverless S3 Sync [![npm](https://img.shields.io/npm/v/serverless-s3-sync-v2.svg)](https://www.npmjs.com/package/serverless-s3-sync-v2)

> Actively maintained fork of [serverless-s3-sync](https://github.com/k1LoW/serverless-s3-sync). A plugin to sync local directories and S3 prefixes for Serverless Framework :zap:.

## Migration from serverless-s3-sync

The original [serverless-s3-sync](https://github.com/k1LoW/serverless-s3-sync) project is archived and no longer receives updates. The npm package name `serverless-s3-sync` remains reserved on npm to prevent a third party from publishing malicious replacements. Use **serverless-s3-sync-v2** for continued maintenance, security fixes, and Serverless Framework compatibility.

### Steps

1. Replace the npm package:

```sh
$ npm uninstall serverless-s3-sync
$ npm install --save serverless-s3-sync-v2
```

2. Update the plugin name in `serverless.yml`:

```yaml
plugins:
  - serverless-s3-sync-v2 # was: serverless-s3-sync
```

3. Keep your existing `custom.s3Sync` configuration — bucket rules, hooks, CLI flags (`--nos3sync`), and the `sls s3sync` command work the same way.

### Requirements

- **Node.js**: `serverless-s3-sync-v2` requires Node **≥ 20**.
- **Serverless Framework**: see [Compatibility with Serverless Framework](#compatibility-with-serverless-framework) below.

## Use Case

- Static Website ( `serverless-s3-sync` ) & Contact form backend ( `serverless` ) .
- SPA ( `serverless` ) & assets ( `serverless-s3-sync` ) .

## Install

Run `npm install` in your Serverless project.

```sh
$ npm install --save serverless-s3-sync-v2
```

Add the plugin to your serverless.yml file

```yaml
plugins:
  - serverless-s3-sync-v2
```

### Compatibility with Serverless Framework

Version 2.0.0 is compatible with Serverless Framework v3, but it uses the legacy logging interface. Version 3.0.0 and later uses the [new logging interface](https://www.serverless.com/framework/docs/guides/plugins/cli-output).

| serverless-s3-sync-v2 | Serverless Framework |
| --------------------- | -------------------- |
| v1.x                  | v3.x, v4.x           |

## Setup

```yaml
custom:
  s3Sync:
    # A simple configuration for copying static assets
    - bucketName: my-static-site-assets # required
      bucketPrefix: assets/ # optional
      localDir: dist/assets # required

    # An example of possible configuration options
    - bucketName: my-other-site
      localDir: path/to/other-site
      deleteRemoved: true # optional, indicates whether sync deletes files no longer present in localDir. Defaults to 'true'
      acl: public-read # optional
      followSymlinks: true # optional
      defaultContentType: text/html # optional
      params: # optional
        - index.html:
            CacheControl: 'no-cache'
        - '*.js':
            CacheControl: 'public, max-age=31536000'
      bucketTags: # optional, these are appended to existing S3 bucket tags (overwriting tags with the same key)
        tagKey1: tagValue1
        tagKey2: tagValue2

    # This references bucket name from the output of the current stack
    - bucketNameKey: AnotherBucketNameOutputKey
      localDir: path/to/another

    # ... but can also reference it from the output of another stack,
    # see https://www.serverless.com/framework/docs/providers/aws/guide/variables#reference-cloudformation-outputs
    - bucketName: ${cf:another-cf-stack-name.ExternalBucketOutputKey}
      localDir: path

    # Setting the optional enabled field to false will disable this rule.
    # Referencing other variables allows this rule to become conditional
    - bucketName: DisabledSync
      localDir: path
      enabled: false

resources:
  Resources:
    AssetsBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: my-static-site-assets
    OtherSiteBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: my-other-site
        AccessControl: PublicRead
        WebsiteConfiguration:
          IndexDocument: index.html
          ErrorDocument: error.html
    AnotherBucket:
      Type: AWS::S3::Bucket
  Outputs:
    AnotherBucketNameOutputKey:
      Value: !Ref AnotherBucket
```

## Usage

Run `sls deploy`, local directories and S3 prefixes are synced.

Run `sls remove`, S3 objects in S3 prefixes are removed.

Run `sls deploy --nos3sync`, deploy your serverless stack without syncing local directories and S3 prefixes.

Run `sls remove --nos3sync`, remove your serverless stack without removing S3 objects from the target S3 buckets.

### `sls s3sync`

Sync local directories and S3 prefixes.

### Offline usage

If also using the plugins `serverless-offline` and `serverless-s3-local`, sync can be supported during development by placing the bucket configuration(s) into the `buckets` object and specifying the alterate `endpoint` (see below).

```yaml
custom:
  s3Sync:
    # an alternate s3 endpoint
    endpoint: http://localhost:4569
    buckets:
      # A simple configuration for copying static assets
      - bucketName: my-static-site-assets # required
        bucketPrefix: assets/ # optional
        localDir: dist/assets # required
# ...
```

As per [serverless-s3-local's instructions](https://github.com/ar90n/serverless-s3-local#triggering-aws-events-offline), once a local credentials profile is configured, run `sls offline start --aws-profile s3local` to sync to the local s3 bucket instead of Amazon AWS S3

> `bucketNameKey` will not work in offline mode and can only be used in conjunction with valid AWS credentials, use `bucketName` instead.

run `sls deploy` for normal deployment

### Always disable auto sync

```yaml
custom:
  s3Sync:
    # Disable sync when sls deploy and sls remove
    noSync: true
    buckets:
      # A simple configuration for copying static assets
      - bucketName: my-static-site-assets # required
        bucketPrefix: assets/ # optional
        localDir: dist/assets # required
# ...
```

### Sync on other hooks

```yaml
custom:
  s3Sync:
    hooks:
      # This hook will run after the deploy:finalize hook
      - after:deploy:finalize
    buckets:
      # A simple configuration for copying static assets
      - bucketName: my-static-site-assets # required
        bucketPrefix: assets/ # optional
        localDir: dist/assets # required
# ...
```

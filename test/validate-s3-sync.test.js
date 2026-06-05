const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateS3Sync } = require('../lib/validate-s3-sync');

describe('validateS3Sync', () => {
  it('accepts an empty object configuration', () => {
    assert.doesNotThrow(() => validateS3Sync({}));
  });

  it('accepts a root array of bucket entries', () => {
    assert.doesNotThrow(() => validateS3Sync([
      {
        bucketName: 'my-bucket',
        localDir: 'dist/assets',
      },
    ]));
  });

  it('accepts an object configuration with buckets and top-level options', () => {
    assert.doesNotThrow(() => validateS3Sync({
      endpoint: 'http://localhost:4569',
      noSync: true,
      hooks: ['after:deploy:finalize'],
      buckets: [
        {
          bucketName: 'my-bucket',
          bucketPrefix: 'assets/',
          localDir: 'dist/assets',
          deleteRemoved: true,
          acl: 'public-read',
          followSymlinks: true,
          defaultContentType: 'text/html',
          enabled: false,
          preCommand: 'npm run build',
          params: [
            {
              'index.html': {
                CacheControl: 'no-cache',
                OnlyForEnv: 'prod',
              },
            },
          ],
          bucketTags: {
            Environment: 'prod',
          },
        },
      ],
    }));
  });

  it('accepts bucketNameKey instead of bucketName', () => {
    assert.doesNotThrow(() => validateS3Sync([
      {
        bucketNameKey: 'AssetsBucketName',
        localDir: 'dist/assets',
      },
    ]));
  });

  it('rejects bucket entries without bucketName or bucketNameKey', () => {
    assert.throws(
      () => validateS3Sync([
        {
          localDir: 'dist/assets',
        },
      ]),
      /Invalid custom\.s3Sync configuration/,
    );
  });

  it('rejects unknown bucket properties', () => {
    assert.throws(
      () => validateS3Sync([
        {
          bucketName: 'my-bucket',
          localDir: 'dist/assets',
          unknownOption: true,
        },
      ]),
      /must NOT have additional properties/,
    );
  });

  it('rejects a non-array buckets property', () => {
    assert.throws(
      () => validateS3Sync({
        buckets: 'invalid',
      }),
      /Invalid custom\.s3Sync configuration/,
    );
  });

  it('rejects invalid bucketTags values', () => {
    assert.throws(
      () => validateS3Sync([
        {
          bucketName: 'my-bucket',
          localDir: 'dist/assets',
          bucketTags: {
            Environment: 123,
          },
        },
      ]),
      /must be string/,
    );
  });

  it('rejects invalid noSync values', () => {
    assert.throws(
      () => validateS3Sync({
        noSync: 'yes',
      }),
      /Invalid custom\.s3Sync configuration/,
    );
  });
});

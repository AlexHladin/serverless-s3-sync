const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const resolveStackOutput = require('../resolveStackOutput');

describe('resolveStackOutput', () => {
  it('returns the matching CloudFormation output value', async () => {
    const plugin = {
      serverless: {
        getProvider: () => ({
          getRegion: () => 'us-east-1',
          getCredentials: () => ({
            region: 'us-east-1',
            credentials: {
              accessKeyId: 'key',
              secretAccessKey: 'secret',
            },
          }),
          naming: {
            getStackName: () => 'my-stack',
          },
          sdk: {
            CloudFormation: function () {
              return {
                describeStacks: () => ({
                  promise: () => Promise.resolve({
                    Stacks: [{
                      Outputs: [
                        { OutputKey: 'BucketName', OutputValue: 'my-bucket' },
                      ],
                    }],
                  }),
                }),
              };
            },
          },
        }),
      },
    };

    const value = await resolveStackOutput(plugin, 'BucketName');
    assert.equal(value, 'my-bucket');
  });

  it('throws when the output key is not found', async () => {
    const plugin = {
      serverless: {
        getProvider: () => ({
          getRegion: () => 'us-east-1',
          getCredentials: () => ({
            region: 'us-east-1',
            credentials: {
              accessKeyId: 'key',
              secretAccessKey: 'secret',
            },
          }),
          naming: {
            getStackName: () => 'my-stack',
          },
          sdk: {
            CloudFormation: function () {
              return {
                describeStacks: () => ({
                  promise: () => Promise.resolve({
                    Stacks: [{ Outputs: [] }],
                  }),
                }),
              };
            },
          },
        }),
      },
    };

    await assert.rejects(
      () => resolveStackOutput(plugin, 'MissingOutput'),
      /Failed to resolve stack Output 'MissingOutput'/,
    );
  });
});

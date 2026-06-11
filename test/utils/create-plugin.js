const ServerlessS3Sync = require('../../index')

function createLogging () {
  return {
    log: {
      error: () => {},
      verbose: () => {},
      success: () => {},
      notice: () => {}
    },
    progress: {
      create: () => ({
        update: () => {},
        remove: () => {}
      })
    }
  }
}

function createPlugin ({ serverless = {}, options = {}, logging } = {}) {
  const defaultServerless = {
    service: {
      custom: {
        s3Sync: {}
      },
      serverless: {
        config: {
          servicePath: '/tmp/service'
        }
      }
    },
    getProvider: () => ({
      getRegion: () => 'us-east-1',
      getCredentials: () => ({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'key',
          secretAccessKey: 'secret'
        }
      }),
      naming: {
        getStackName: () => 'test-stack'
      },
      sdk: {
        CloudFormation: function () {
          return {
            describeStacks: () => ({
              promise: () => Promise.resolve({ Stacks: [{ Outputs: [] }] })
            })
          }
        },
        Endpoint: (url) => url,
        S3: function () {
          return { shouldDisableBodySigning: () => true }
        }
      }
    })
  }

  return new ServerlessS3Sync(
    { ...defaultServerless, ...serverless },
    options,
    logging || createLogging()
  )
}

module.exports = {
  createLogging,
  createPlugin
}

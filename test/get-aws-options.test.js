const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const getAwsOptions = require('../getAwsOptions')

describe('getAwsOptions', () => {
  it('uses cached credentials when session credentials are present', () => {
    const provider = {
      getRegion: () => 'eu-west-1',
      cachedCredentials: {
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
        sessionToken: 'token'
      }
    }

    assert.deepEqual(getAwsOptions(provider), {
      region: 'eu-west-1',
      credentials: {
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
        sessionToken: 'token'
      }
    })
  })

  it('falls back to provider credentials', () => {
    const provider = {
      getRegion: () => 'ap-southeast-1',
      getCredentials: () => ({
        region: 'ap-southeast-1',
        credentials: {
          accessKeyId: 'KEY',
          secretAccessKey: 'SECRET'
        }
      })
    }

    assert.deepEqual(getAwsOptions(provider), {
      region: 'ap-southeast-1',
      credentials: {
        accessKeyId: 'KEY',
        secretAccessKey: 'SECRET'
      }
    })
  })
})

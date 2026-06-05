const {
  describe, it, beforeEach, afterEach
} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createPlugin } = require('./utils/create-plugin')

describe('ServerlessS3Sync', () => {
  const originalIsOffline = process.env.IS_OFFLINE

  afterEach(() => {
    if (originalIsOffline === undefined) {
      delete process.env.IS_OFFLINE
    } else {
      process.env.IS_OFFLINE = originalIsOffline
    }
  })

  describe('getNoSync', () => {
    it('returns true when nos3sync option is set', () => {
      const plugin = createPlugin({ options: { nos3sync: true } })
      assert.equal(plugin.getNoSync(), true)
    })

    it('returns true when custom.s3Sync.noSync is TRUE', () => {
      const plugin = createPlugin({
        serverless: {
          service: {
            custom: { s3Sync: { noSync: 'TRUE' } },
            serverless: { config: { servicePath: '/tmp' } }
          }
        }
      })
      assert.equal(plugin.getNoSync(), true)
    })

    it('returns false by default', () => {
      const plugin = createPlugin()
      assert.equal(plugin.getNoSync(), false)
    })
  })

  describe('getCustomHooks', () => {
    it('returns configured hooks', () => {
      const plugin = createPlugin({
        serverless: {
          service: {
            custom: { s3Sync: { hooks: ['after:deploy:deploy'] } },
            serverless: { config: { servicePath: '/tmp' } }
          }
        }
      })
      assert.deepEqual(plugin.getCustomHooks(), ['after:deploy:deploy'])
    })

    it('returns an empty array when hooks are not configured', () => {
      const plugin = createPlugin()
      assert.deepEqual(plugin.getCustomHooks(), [])
    })
  })

  describe('isOffline', () => {
    it('returns true when setOffline was called', () => {
      const plugin = createPlugin()
      plugin.setOffline()
      assert.equal(plugin.isOffline(), true)
    })

    it('returns truthy when IS_OFFLINE env var is set', () => {
      process.env.IS_OFFLINE = 'true'
      const plugin = createPlugin()
      assert.ok(plugin.isOffline())
    })
  })

  describe('mergeTags', () => {
    it('updates existing tag values and appends new tags', () => {
      const plugin = createPlugin()
      const tagSet = [{ Key: 'Env', Value: 'dev' }]

      plugin.mergeTags(tagSet, [
        { Key: 'Env', Value: 'prod' },
        { Key: 'Team', Value: 'platform' }
      ])

      assert.deepEqual(tagSet, [
        { Key: 'Env', Value: 'prod' },
        { Key: 'Team', Value: 'platform' }
      ])
    })
  })

  describe('extractMetaParams', () => {
    it('merges nested param objects from glob config', () => {
      const plugin = createPlugin()
      const params = plugin.extractMetaParams({
        '*.html': {
          CacheControl: 'no-cache',
          ContentType: 'text/html'
        }
      })

      assert.deepEqual(params, {
        CacheControl: 'no-cache',
        ContentType: 'text/html'
      })
    })
  })

  describe('getBucketName', () => {
    it('resolves bucketName directly', async () => {
      const plugin = createPlugin()
      const name = await plugin.getBucketName({ bucketName: 'my-bucket' })
      assert.equal(name, 'my-bucket')
    })

    it('rejects when bucket configuration is missing', async () => {
      const plugin = createPlugin()
      await assert.rejects(
        () => plugin.getBucketName({}),
        /Unable to find bucketName/
      )
    })
  })

  describe('getLocalFiles', () => {
    let tempDir

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-sync-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('returns file paths recursively', () => {
      const nested = path.join(tempDir, 'nested')
      fs.mkdirSync(nested)
      fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root')
      fs.writeFileSync(path.join(nested, 'child.txt'), 'child')

      const plugin = createPlugin()
      const files = plugin.getLocalFiles(tempDir, [])

      assert.equal(files.length, 2)
      assert.ok(files.some((file) => file.endsWith('root.txt')))
      assert.ok(files.some((file) => file.endsWith(path.join('nested', 'child.txt'))))
    })

    it('returns the input list when directory is missing', () => {
      const plugin = createPlugin()
      const files = plugin.getLocalFiles(path.join(tempDir, 'missing'), ['seed'])
      assert.deepEqual(files, ['seed'])
    })
  })

  describe('sync', () => {
    it('throws when s3Sync config fails schema validation', () => {
      assert.throws(
        () => createPlugin({
          serverless: {
            service: {
              custom: { s3Sync: { buckets: 'invalid' } },
              serverless: { config: { servicePath: '/tmp' } }
            }
          }
        }),
        /Invalid custom\.s3Sync configuration/
      )
    })

    it('resolves when s3Sync buckets array is empty', async () => {
      const plugin = createPlugin({
        serverless: {
          service: {
            custom: { s3Sync: { buckets: [] } },
            serverless: { config: { servicePath: '/tmp' } }
          }
        }
      })

      await assert.doesNotReject(() => plugin.sync())
    })
  })
})

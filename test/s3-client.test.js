const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3')
const S3SyncClient = require('../lib/s3-client')

function waitForEmitter (emitter, event = 'end') {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve)
    emitter.once('error', reject)
  })
}

function createMockS3Client (handlers = {}) {
  const calls = []

  return {
    calls,
    send: async command => {
      calls.push(command)
      const handler = handlers[command.constructor.name] || handlers.default

      if (!handler) {
        throw new Error(`Unexpected command: ${command.constructor.name}`)
      }

      return handler(command)
    }
  }
}

async function drainBody (command) {
  const { Body } = command.input

  if (Body && typeof Body.on === 'function') {
    await new Promise((resolve, reject) => {
      Body.on('end', resolve)
      Body.on('error', reject)
      Body.resume()
    })
  }
}

async function mockPutObject (command) {
  await drainBody(command)
  return {}
}

function getCommands (calls, CommandClass) {
  return calls.filter(command => command instanceof CommandClass)
}

describe('S3SyncClient static helpers', () => {
  describe('ensureSlash', () => {
    it('returns an empty string for falsy values', () => {
      assert.equal(S3SyncClient.ensureSlash(''), '')
      assert.equal(S3SyncClient.ensureSlash(undefined), '')
    })

    it('appends a trailing slash when missing', () => {
      assert.equal(S3SyncClient.ensureSlash('assets'), 'assets/')
    })

    it('keeps an existing trailing slash', () => {
      assert.equal(S3SyncClient.ensureSlash('assets/'), 'assets/')
    })
  })

  describe('cleanETag', () => {
    it('removes surrounding quotes from an ETag', () => {
      assert.equal(S3SyncClient.cleanETag('"abc123"'), 'abc123')
    })
  })

  describe('collectLocalFiles', () => {
    let tempDir

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-client-test-'))
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('returns sorted relative file paths', () => {
      fs.writeFileSync(path.join(tempDir, 'b.txt'), 'b')
      fs.writeFileSync(path.join(tempDir, 'a.txt'), 'a')
      const nested = path.join(tempDir, 'nested')
      fs.mkdirSync(nested)
      fs.writeFileSync(path.join(nested, 'c.txt'), 'c')

      const files = S3SyncClient.collectLocalFiles(tempDir, false)

      assert.deepEqual(
        files.map(file => file.relativePath),
        ['a.txt', 'b.txt', 'nested/c.txt']
      )
    })
  })

  describe('getS3ParamsAsync', () => {
    it('resolves callback results', async () => {
      const result = await S3SyncClient.getS3ParamsAsync(
        (_localFile, _stat, cb) => cb(null, { CacheControl: 'no-cache' }),
        '/tmp/file.txt',
        { size: 1 }
      )

      assert.deepEqual(result, { CacheControl: 'no-cache' })
    })

    it('rejects callback errors', async () => {
      await assert.rejects(
        () =>
          S3SyncClient.getS3ParamsAsync(
            (_localFile, _stat, cb) => cb(new Error('params failed')),
            '/tmp/file.txt',
            { size: 1 }
          ),
        /params failed/
      )
    })
  })

  describe('getFileMd5Hex', () => {
    let tempDir
    let filePath

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-client-md5-'))
      filePath = path.join(tempDir, 'file.txt')
      fs.writeFileSync(filePath, 'hello')
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('returns the MD5 hash for a file', async () => {
      const md5 = await S3SyncClient.getFileMd5Hex(filePath)
      assert.equal(md5, '5d41402abc4b2a76b9719d911017c592')
    })
  })

  describe('mapWithConcurrency', () => {
    it('processes all items without exceeding concurrency', async () => {
      let active = 0
      let maxActive = 0
      const processed = []

      await S3SyncClient.mapWithConcurrency([1, 2, 3, 4], 2, async item => {
        active += 1
        maxActive = Math.max(maxActive, active)
        processed.push(item)
        await new Promise(resolve => setTimeout(resolve, 10))
        active -= 1
      })

      assert.deepEqual(processed.sort(), [1, 2, 3, 4])
      assert.ok(maxActive <= 2)
    })
  })
})

describe('S3SyncClient instance methods', () => {
  let tempDir

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-client-instance-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe('listAllObjects', () => {
    it('paginates through all object listings', async () => {
      let listCalls = 0
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => {
          listCalls += 1

          if (listCalls === 1) {
            return {
              IsTruncated: true,
              NextContinuationToken: 'token-2',
              Contents: [{ Key: 'assets/a.txt' }]
            }
          }

          return {
            IsTruncated: false,
            Contents: [{ Key: 'assets/b.txt' }]
          }
        }
      })
      const client = new S3SyncClient(mockS3)

      const objects = await client.listAllObjects('my-bucket', 'assets/')

      assert.equal(listCalls, 2)
      assert.deepEqual(
        objects.map(object => object.Key),
        ['assets/a.txt', 'assets/b.txt']
      )
    })
  })

  describe('shouldUploadFile', () => {
    it('returns true when the object does not exist', async () => {
      const filePath = path.join(tempDir, 'missing-on-s3.txt')
      fs.writeFileSync(filePath, 'data')
      const stat = fs.statSync(filePath)
      const mockS3 = createMockS3Client({
        HeadObjectCommand: () => {
          const err = new Error('NotFound')
          err.name = 'NotFound'
          throw err
        }
      })
      const client = new S3SyncClient(mockS3)

      const shouldUpload = await client.shouldUploadFile(
        'my-bucket',
        'missing-on-s3.txt',
        { fullPath: filePath, stat }
      )

      assert.equal(shouldUpload, true)
    })

    it('returns false when size and MD5 match', async () => {
      const filePath = path.join(tempDir, 'same.txt')
      fs.writeFileSync(filePath, 'same')
      const stat = fs.statSync(filePath)
      const md5 = await S3SyncClient.getFileMd5Hex(filePath)
      const mockS3 = createMockS3Client({
        HeadObjectCommand: () => ({
          ContentLength: stat.size,
          ETag: `"${md5}"`
        })
      })
      const client = new S3SyncClient(mockS3)

      const shouldUpload = await client.shouldUploadFile(
        'my-bucket',
        'same.txt',
        { fullPath: filePath, stat }
      )

      assert.equal(shouldUpload, false)
    })

    it('returns false for multipart ETags when size matches', async () => {
      const filePath = path.join(tempDir, 'multipart.txt')
      fs.writeFileSync(filePath, 'multipart')
      const stat = fs.statSync(filePath)
      const mockS3 = createMockS3Client({
        HeadObjectCommand: () => ({
          ContentLength: stat.size,
          ETag: '"abc123-2"'
        })
      })
      const client = new S3SyncClient(mockS3)

      const shouldUpload = await client.shouldUploadFile(
        'my-bucket',
        'multipart.txt',
        { fullPath: filePath, stat }
      )

      assert.equal(shouldUpload, false)
    })
  })

  describe('uploadLocalFile', () => {
    it('uploads with detected content type and extra params', async () => {
      const filePath = path.join(tempDir, 'index.html')
      fs.writeFileSync(filePath, '<html></html>')
      const stat = fs.statSync(filePath)
      const mockS3 = createMockS3Client({
        PutObjectCommand: mockPutObject
      })
      const client = new S3SyncClient(mockS3)

      await client.uploadLocalFile(
        { fullPath: filePath, stat },
        'my-bucket',
        'site/index.html',
        { ACL: 'public-read' },
        undefined
      )

      assert.equal(getCommands(mockS3.calls, PutObjectCommand).length, 1)
      const command = getCommands(mockS3.calls, PutObjectCommand)[0]
      assert.equal(command.input.Bucket, 'my-bucket')
      assert.equal(command.input.Key, 'site/index.html')
      assert.equal(command.input.ACL, 'public-read')
      assert.equal(command.input.ContentType, 'text/html')
      assert.equal(command.input.ContentLength, stat.size)
    })
  })

  describe('copyObject', () => {
    it('emits end after a successful copy', async () => {
      const mockS3 = createMockS3Client({
        CopyObjectCommand: () => ({})
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.copyObject({
        Bucket: 'my-bucket',
        Key: 'dest.txt',
        CopySource: 'my-bucket/source.txt'
      })

      await waitForEmitter(emitter)

      assert.equal(getCommands(mockS3.calls, CopyObjectCommand).length, 1)
    })

    it('emits error when the copy fails', async () => {
      const mockS3 = createMockS3Client({
        CopyObjectCommand: () => {
          throw new Error('copy failed')
        }
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.copyObject({
        Bucket: 'my-bucket',
        Key: 'dest.txt',
        CopySource: 'my-bucket/source.txt'
      })

      await assert.rejects(() => waitForEmitter(emitter), /copy failed/)
    })
  })

  describe('deleteDir', () => {
    it('deletes all listed objects in batches', async () => {
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => ({
          IsTruncated: false,
          Contents: [{ Key: 'assets/a.txt' }, { Key: 'assets/b.txt' }]
        }),
        DeleteObjectsCommand: () => ({})
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.deleteDir({
        Bucket: 'my-bucket',
        Prefix: 'assets/'
      })

      await waitForEmitter(emitter)

      assert.equal(getCommands(mockS3.calls, DeleteObjectsCommand).length, 1)
      const deleteCommand = getCommands(mockS3.calls, DeleteObjectsCommand)[0]
      assert.deepEqual(deleteCommand.input.Delete.Objects, [
        { Key: 'assets/a.txt' },
        { Key: 'assets/b.txt' }
      ])
      assert.equal(emitter.progressTotal, 2)
      assert.equal(emitter.progressAmount, 2)
    })
  })

  describe('uploadDir', () => {
    it('uploads new local files under the configured prefix', async () => {
      fs.writeFileSync(path.join(tempDir, 'new.txt'), 'new file')
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => ({
          IsTruncated: false,
          Contents: []
        }),
        HeadObjectCommand: () => {
          const err = new Error('NotFound')
          err.name = 'NotFound'
          throw err
        },
        PutObjectCommand: mockPutObject
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.uploadDir({
        localDir: tempDir,
        s3Params: {
          Bucket: 'my-bucket',
          Prefix: 'assets',
          ACL: 'private'
        }
      })

      await waitForEmitter(emitter)

      const putCommands = getCommands(mockS3.calls, PutObjectCommand)
      assert.equal(putCommands.length, 1)
      assert.equal(putCommands[0].input.Key, 'assets/new.txt')
      assert.equal(putCommands[0].input.Bucket, 'my-bucket')
      assert.equal(emitter.progressTotal, 1)
      assert.equal(emitter.progressAmount, 1)
    })

    it('skips upload when the remote object already matches', async () => {
      const filePath = path.join(tempDir, 'existing.txt')
      fs.writeFileSync(filePath, 'existing')
      const md5 = await S3SyncClient.getFileMd5Hex(filePath)
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => ({
          IsTruncated: false,
          Contents: [
            {
              Key: 'assets/existing.txt',
              ETag: `"${md5}"`,
              Size: fs.statSync(filePath).size
            }
          ]
        }),
        HeadObjectCommand: () => ({
          ContentLength: fs.statSync(filePath).size,
          ETag: `"${md5}"`
        })
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.uploadDir({
        localDir: tempDir,
        s3Params: {
          Bucket: 'my-bucket',
          Prefix: 'assets/'
        }
      })

      await waitForEmitter(emitter)

      assert.equal(getCommands(mockS3.calls, PutObjectCommand).length, 0)
      assert.equal(emitter.progressTotal, 1)
      assert.equal(emitter.progressAmount, 1)
    })

    it('deletes remote-only objects when deleteRemoved is enabled', async () => {
      fs.writeFileSync(path.join(tempDir, 'keep.txt'), 'keep')
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => ({
          IsTruncated: false,
          Contents: [
            { Key: 'assets/keep.txt', Size: 4, ETag: '"other"' },
            { Key: 'assets/remove.txt', Size: 1, ETag: '"x"' }
          ]
        }),
        HeadObjectCommand: () => ({
          ContentLength: 4,
          ETag: '"other"'
        }),
        PutObjectCommand: mockPutObject,
        DeleteObjectsCommand: () => ({})
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.uploadDir({
        localDir: tempDir,
        deleteRemoved: true,
        s3Params: {
          Bucket: 'my-bucket',
          Prefix: 'assets/'
        }
      })

      await waitForEmitter(emitter)

      const deleteCommands = getCommands(mockS3.calls, DeleteObjectsCommand)
      assert.equal(deleteCommands.length, 1)
      assert.deepEqual(deleteCommands[0].input.Delete.Objects, [
        { Key: 'assets/remove.txt' }
      ])
    })

    it('skips files when getS3Params returns null', async () => {
      fs.writeFileSync(path.join(tempDir, 'skip.txt'), 'skip')
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => ({
          IsTruncated: false,
          Contents: []
        })
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.uploadDir({
        localDir: tempDir,
        getS3Params: (_localFile, _stat, cb) => cb(null, null),
        s3Params: {
          Bucket: 'my-bucket',
          Prefix: 'assets/'
        }
      })

      await waitForEmitter(emitter)

      assert.equal(getCommands(mockS3.calls, PutObjectCommand).length, 0)
      assert.equal(getCommands(mockS3.calls, HeadObjectCommand).length, 0)
      assert.equal(emitter.progressTotal, 1)
      assert.equal(emitter.progressAmount, 1)
    })

    it('emits error when listing objects fails', async () => {
      fs.writeFileSync(path.join(tempDir, 'fail.txt'), 'fail')
      const mockS3 = createMockS3Client({
        ListObjectsV2Command: () => {
          throw new Error('list failed')
        }
      })
      const client = new S3SyncClient(mockS3)
      const emitter = client.uploadDir({
        localDir: tempDir,
        s3Params: {
          Bucket: 'my-bucket',
          Prefix: 'assets/'
        }
      })

      await assert.rejects(() => waitForEmitter(emitter), /list failed/)
    })
  })
})
